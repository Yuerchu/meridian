//! Delivering the prompt queue.
//!
//! `db::ops::queue` decides *what* may go next; this decides *when*, and hands
//! it to whichever runner owns the conversation. One function does the work
//! ([`pump`]) and everything else here is about when it is allowed to run.
//!
//! **Nothing pumps at startup, and that is the rule the whole module is shaped
//! around.** A queue is a list of instructions a person wrote for an agent they
//! were watching; finding one on disk says only that the app died before it was
//! finished. Delivering it into an empty room — where the next thing that
//! happens is a tool call nobody approved — is the failure this feature must not
//! have. So there are exactly two things that make the queue move, and both are
//! somebody being there: an item being added, and a turn reaching its ending.
//!
//! Only hosted sessions deliver so far. A native turn already has the port for
//! it — `engine::ports::Steering`, drained between rounds — but the desktop
//! passes `None` for it, and connecting that is its own step.

use crate::db::models::queue::{Delivery, QueuedPrompt};
use crate::services::Services;
use crate::util::{get_conn, now_ms};

/// Deliver whatever the queue owes this conversation, if anything can go now.
///
/// Returns without doing anything at all when there is nothing to deliver,
/// which is the ordinary case: this runs after every turn of every hosted
/// conversation, and most of them have an empty queue.
pub async fn pump(services: &Services, conversation_id: &str) {
    // A session is a child process, so Android has none and this is the whole
    // of what a pump can do there until the native path is connected.
    #[cfg(not(target_os = "android"))]
    hosted::pump(services, conversation_id).await;
    #[cfg(target_os = "android")]
    let _ = (services, conversation_id);
}

/// The same, later and elsewhere.
///
/// For callers inside the thing they are pumping — a turn that has just ended
/// is still inside `prompt`, and the next item wants a `prompt` of its own,
/// with the turn lease this one has not finished dropping.
pub fn pump_later(services: &Services, conversation_id: &str) {
    let services = services.clone();
    let conversation_id = conversation_id.to_string();
    tokio::spawn(async move { pump(&services, &conversation_id).await });
}

/// Stop the queue, because the turn in front of it did not finish.
///
/// Everything still waiting, not just the head: the instructions were written
/// as a sequence and the ones after a failure rest on the same assumption the
/// failed step broke.
pub async fn hold(services: &Services, conversation_id: &str) {
    let pool = services.db.clone();
    let id = conversation_id.to_string();
    let held = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        crate::db::ops::queue::hold_all(&mut conn, &id, now_ms()).map_err(|e| e.to_string())
    })
    .await;

    match held {
        Ok(Ok(0)) => {}
        Ok(Ok(count)) => {
            tracing::info!(
                count,
                conversation_id,
                "the queue is held: the turn before it did not finish"
            );
            announce(services, conversation_id);
        }
        Ok(Err(e)) => tracing::warn!(error = %e, conversation_id, "could not hold the queue"),
        Err(e) => tracing::warn!(error = %e, conversation_id, "could not hold the queue (the write panicked)"),
    }
}

/// Tell the window the queue has moved. It reads the rows back rather than the
/// event, so this carries nothing but which conversation to re-read.
pub fn announce(services: &Services, conversation_id: &str) {
    let _ = services.events.emit(
        "queue-updated",
        serde_json::json!({ "conversation_id": conversation_id }),
    );
}

/// How many doubtful items one message may describe.
///
/// Rarely more than one — an in-doubt item stops the queue, so a second can
/// only appear after somebody released it — and nothing beyond the cap is
/// dropped. It stays unreported and comes back on the next message, exactly as
/// an unreported turn does.
const AT_MOST: usize = 3;

/// What the agent is told about queued messages that may or may not have
/// reached it, and which items that settles.
///
/// The same shape as `interrupted::Report`, and settled by the same rule:
/// reading it is not telling anyone, so the two travel together and only a
/// reply read to the end writes anything down.
pub struct Doubtful {
    text: String,
    ids: Vec<String>,
}

impl Doubtful {
    pub fn text(&self) -> &str {
        &self.text
    }
}

/// What to tell the agent about queued messages whose delivery is unknown.
///
/// Reading this settles nothing — see [`confirm_reported`].
pub async fn owed(services: &Services, conversation_id: &str) -> Option<Doubtful> {
    let pool = services.db.clone();
    let id = conversation_id.to_string();
    let items = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().ok()?;
        crate::db::ops::queue::unreported_in_doubt(&mut conn, &id).ok()
    })
    .await
    .ok()
    .flatten()?;

    let items: Vec<QueuedPrompt> = items.into_iter().take(AT_MOST).collect();
    if items.is_empty() {
        return None;
    }
    Some(Doubtful {
        text: describe(&items),
        ids: items.into_iter().map(|i| i.id).collect(),
    })
}

/// Record that the agent has now been told about these.
///
/// Called at the one moment that proves it, for the same reason
/// `interrupted::confirm_delivered` is: reading the record is not telling
/// anyone, and a turn can read it and then die before a byte leaves. Every way
/// of getting this wrong repeats the warning rather than losing it, including a
/// failed write, and that is the direction to fail in.
pub async fn confirm_reported(services: &Services, report: Doubtful) {
    let pool = services.db.clone();
    let written = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        crate::db::ops::queue::mark_reported(&mut conn, &report.ids, now_ms()).map_err(|e| e.to_string())
    })
    .await;
    match written {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => tracing::warn!(error = %e, "could not record that a queued message was reported"),
        Err(e) => tracing::warn!(error = %e, "recording a reported queue item panicked"),
    }
}

/// Says what is not known, and says plainly that it will not be retried.
///
/// The temptation is to have the agent re-do the instruction to be safe, and
/// that is precisely the failure this design exists to prevent: the message may
/// have been "delete the old migration", and doing it twice is not the same as
/// doing it once. So the text asks for the state to be checked rather than for
/// the work to be repeated, and it never says which of the two happened —
/// because nothing here knows.
fn describe(items: &[QueuedPrompt]) -> String {
    // Verbatim, in a tag of its own. A queued message is the user's own words
    // and gets the same treatment an ordinary prompt does — quoting it into one
    // line would fold a multi-line instruction into `\n`s and escaped quotes,
    // which is worse to read and no safer.
    let quoted: Vec<String> = items
        .iter()
        .map(|i| format!("<message>\n{}\n</message>", i.content))
        .collect();
    let opening = match items.len() {
        1 => "A message you had queued was sent to you and never acknowledged, so it may have \
              reached you or may not have. It said:"
            .to_string(),
        n => format!(
            "{n} messages you had queued were sent to you and never acknowledged, so they may \
             have reached you or may not have. Oldest first:"
        ),
    };
    format!(
        "<undelivered_queue>\n{opening}\n{}\n\nThey have not been sent again. If one did arrive, \
         you may already have acted on it, and doing the work a second time is not the same as \
         doing it once. Check the current state before assuming either way, and say what you find \
         rather than silently repeating anything.\n</undelivered_queue>",
        quoted.join("\n")
    )
}

/// The next item, asked for the way the runner's state allows.
///
/// `steerable` narrows to interjections; idle takes the front of the queue
/// whatever mode it is in, because with no turn to interrupt the distinction
/// has nothing to refer to.
// Android has no runner to deliver to: a hosted session is a child process, and
// the native path is not connected yet.
#[cfg_attr(target_os = "android", allow(dead_code, reason = "nothing delivers there yet"))]
async fn read(services: &Services, conversation_id: &str, steerable: bool) -> Option<QueuedPrompt> {
    let pool = services.db.clone();
    let id = conversation_id.to_string();
    let found = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        if steerable {
            crate::db::ops::queue::next_deliverable(&mut conn, &id, Delivery::Interject).map_err(|e| e.to_string())
        } else {
            crate::db::ops::queue::next_pending(&mut conn, &id).map_err(|e| e.to_string())
        }
    })
    .await;

    match found {
        Ok(Ok(item)) => item,
        Ok(Err(e)) => {
            tracing::warn!(error = %e, conversation_id, "could not read the queue");
            None
        }
        Err(e) => {
            tracing::warn!(error = %e, conversation_id, "could not read the queue (it panicked)");
            None
        }
    }
}

/// One small write against the queue, off the async runtime.
// Android has no runner to deliver to: a hosted session is a child process, and
// the native path is not connected yet.
#[cfg_attr(target_os = "android", allow(dead_code, reason = "nothing delivers there yet"))]
async fn write<F>(services: &Services, id: String, f: F) -> Result<(), String>
where
    F: FnOnce(&mut diesel::SqliteConnection, String) -> diesel::QueryResult<()> + Send + 'static,
{
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        f(&mut conn, id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doubtful(content: &str) -> QueuedPrompt {
        QueuedPrompt {
            id: format!("q-{content}"),
            conversation_id: "c1".into(),
            content: content.into(),
            delivery: "interject".into(),
            position: 0,
            created_at: 0,
            dispatched_at: Some(1),
            dispatched_turn_id: Some("t1".into()),
            settled_at: None,
            settled_message_id: None,
            held_at: None,
            reported_at: None,
        }
    }

    /// The one thing this text must not do is ask for the work to be redone.
    /// "It may not have arrived, so do it again" is how a queue deletes a
    /// migration twice — and the agent cannot check the claim, because nothing
    /// here knows which of the two happened.
    #[test]
    fn the_warning_asks_for_the_state_to_be_checked_not_for_a_retry() {
        let text = describe(&[doubtful("delete the old migration")]);
        assert!(text.contains("delete the old migration"), "it quotes the message");
        assert!(text.contains("may have reached you or may not have"));
        assert!(text.contains("have not been sent again"));
        assert!(text.contains("Check the current state"));
    }

    /// A queued message is often several lines, and it has to survive as
    /// several lines: an instruction folded into escaped `\n`s is harder to
    /// read and no safer, since these are the user's own words either way.
    #[test]
    fn a_multi_line_message_stays_multi_line() {
        let text = describe(&[doubtful("do this\nthen that")]);
        assert!(text.contains("do this\nthen that"), "{text}");
        assert!(!text.contains("\\n"), "nothing is escaped into one line: {text}");
    }

    /// More than one reads as a list, and says so — a single sentence naming
    /// three messages would read as one message in three parts.
    #[test]
    fn several_are_listed_oldest_first() {
        let text = describe(&[doubtful("first"), doubtful("second")]);
        assert!(text.contains("2 messages"));
        assert!(text.contains("Oldest first"));
        assert!(text.find("first") < text.find("second"));
    }
}

/// Delivering into a session running in an adapter, over ACP.
///
/// Separate from the rest because everything in it is a child process, which
/// Android does not have — and because the two delivery modes are two different
/// methods here, where a native turn has one port for both.
#[cfg(not(target_os = "android"))]
mod hosted {
    use std::sync::Arc;

    use super::{announce, read, write};
    use crate::acp::AcpSession;
    use crate::acp::protocol::SteerOutcome;
    use crate::db::models::queue::{Delivery, QueuedPrompt};
    use crate::services::Services;
    use crate::util::now_ms;

    pub(super) async fn pump(services: &Services, conversation_id: &str) {
        // Only a live session. A conversation whose adapter died with the last
        // run of the app is exactly the "empty room" the module header is
        // about: reopening it would start a process and a turn nobody asked
        // for, in a directory nobody has looked at since.
        let Some(session) = services.acp.get(conversation_id).filter(|s| s.is_alive()) else {
            return;
        };

        // Which of the two modes may go depends on whether there is a turn to
        // interject into — and the answer can change under us, which is why
        // nothing below trusts it. A steer that arrives after the turn has
        // ended comes back `promptRequired` and takes the other path in the
        // same call.
        let steerable = session.supports_steering().then(|| session.current_turn_id()).flatten();
        let Some(next) = read(services, conversation_id, steerable.is_some()).await else {
            return;
        };

        if let Some(turn_id) = steerable.filter(|_| next.delivery() == Delivery::Interject) {
            match steer(services, &session, &next, &turn_id).await {
                // Delivered, and the running turn is already adapting.
                // Whatever is behind it waits for that turn to end.
                Steered::Delivered => return,
                // The turn ended in the gap. Fall through and deliver it as a
                // turn of its own, which is what it would have got a moment
                // later anyway.
                Steered::NotTaken => {}
                // In doubt, and the queue is stopped behind it until somebody
                // is told. Retrying is the one thing this design refuses.
                Steered::Unknown => return,
            }
        }

        // A turn of its own. Awaited rather than spawned: the caller is either
        // a command the user is waiting on or an already-detached task, and
        // awaiting is what keeps a second pump from taking an item for a turn
        // the lease is about to refuse.
        if let Err(e) = session.deliver_queued(services, &next).await {
            tracing::warn!(error = %e, conversation_id, "a queued prompt failed as a turn");
        }
    }

    /// What became of a steer, reduced to the three things the caller does
    /// about it. The protocol's outcomes collapse here because `injected`,
    /// `startedNewTurn` and anything newer all mean the agent has it.
    enum Steered {
        Delivered,
        NotTaken,
        Unknown,
    }

    async fn steer(services: &Services, session: &Arc<AcpSession>, item: &QueuedPrompt, turn_id: &str) -> Steered {
        // The record of the attempt goes down *before* the attempt, and this is
        // the whole reason the ledger exists. Killed in the gap, the agent may
        // already have run a command — and a command's effects outlive both
        // this process and the adapter's memory of having asked for it.
        let turn = turn_id.to_string();
        if let Err(e) = write(services, item.id.clone(), move |conn, id| {
            crate::db::ops::queue::mark_dispatched(conn, &id, &turn, now_ms()).map(|_| ())
        })
        .await
        {
            tracing::warn!(error = %e, "could not record a steer before making it");
            return Steered::Unknown;
        }
        announce(services, &session.conversation_id);

        let outcome = session.steer(&item.id, &item.content).await;
        announce(services, &session.conversation_id);

        match outcome {
            // The agent says it did not take the message — evidence about the
            // delivery rather than the absence of it — so the item goes back.
            Ok(SteerOutcome::PromptRequired) => {
                let _ = write(services, item.id.clone(), |conn, id| {
                    crate::db::ops::queue::undispatch(conn, &id).map(|_| ())
                })
                .await;
                Steered::NotTaken
            }
            Ok(outcome) => {
                if outcome == SteerOutcome::StartedNewTurn {
                    // Only reachable from an adapter that ignored the `_meta`
                    // we send. There is now a turn narrating itself into this
                    // session that this app did not open and cannot stop.
                    tracing::warn!(
                        conversation_id = %session.conversation_id,
                        "a steer started a detached turn; this app has no lease on it"
                    );
                }
                let _ = write(services, item.id.clone(), |conn, id| {
                    crate::db::ops::queue::mark_settled(conn, &id, None, now_ms()).map(|_| ())
                })
                .await;
                announce(services, &session.conversation_id);
                Steered::Delivered
            }
            // Left dispatched and unsettled on purpose. It is never delivered
            // again; it is reported to the agent instead.
            Err(e) => {
                tracing::warn!(error = %e, conversation_id = %session.conversation_id, "a steer failed");
                Steered::Unknown
            }
        }
    }
}
