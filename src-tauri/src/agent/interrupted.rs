//! Telling the model which turns were cut off.
//!
//! Nothing here resumes anything. The turn that died is gone; what survives is
//! the record of where it stopped, and the model is the only thing in a
//! position to decide what that means for the work — whether the file it was
//! writing needs checking, whether the command it ran needs to be looked up
//! rather than repeated.
//!
//! Delivered on the user's next message rather than on startup, so nothing the
//! user did not ask for reaches a provider.
//!
//! Which makes delivery a thing that can fail, and therefore a thing that has
//! to be written down. Reading the record is not telling anyone: a turn can
//! read it and then die on a missing key without sending a byte. Nor is sending
//! it — a provider can answer 200 and refuse over SSE, having processed
//! nothing. Only a reply read to the end settles anything, and until one is,
//! every turn still owed an explanation keeps being owed it.

use diesel::sqlite::SqliteConnection;

use crate::db::models::turn::{Turn, TurnPhase, TurnStatus};
use crate::turn::TurnCoordinator;

/// Whether a recorded turn is one that stopped without finishing.
///
/// `status` alone cannot answer this. A turn writes `running` when it starts
/// and overwrites it when it reaches an ending, so anything that never reached
/// one — a kill, a panic, a task dropped at shutdown — leaves the row saying
/// `running` forever. Startup reconciliation rewrites those, but only at
/// startup: a turn that panicked a minute ago still says `running` and would
/// otherwise read as a turn still in progress.
///
/// The coordinator settles it. It is the live register of what is actually
/// running, so a `running` row it does not hold is a turn that is not running,
/// whatever the row says. Startup reconciliation is then just the degenerate
/// case of the same rule — an empty coordinator — persisted so the conclusion
/// does not have to be re-derived forever.
fn was_cut_off(turn: &Turn, coordinator: &TurnCoordinator) -> bool {
    match turn.status() {
        Some(TurnStatus::Interrupted) => true,
        Some(TurnStatus::Running) => !coordinator.holds(&turn.conversation_id, &turn.id),
        // Done, cancelled and failed all reached an ending. A status this build
        // does not recognise is not one to invent an interruption from.
        _ => false,
    }
}

/// How many cut-off turns one message may describe.
///
/// Reached only by crashing repeatedly without a single request getting out in
/// between, so it bounds a pathology rather than normal use. Nothing beyond it
/// is discarded: an unreported turn stays unreported and comes back on the next
/// message. What the cap must not do is let a newer interruption bury an older,
/// more dangerous one — see `choose`.
const AT_MOST: usize = 3;

/// How far back a single read looks for turns still owed an explanation.
///
/// Only a hard stop on the query. Beyond it the same rule applies as beyond
/// `AT_MOST`: still owed, told later.
const WINDOW: i64 = 20;

/// What the model is told, and which turns it settles.
///
/// The two travel together because they must be decided together: telling the
/// model is what makes a turn reported, and a turn is only reported if the
/// telling actually left the machine.
pub(crate) struct Report {
    text: String,
    turns: Vec<String>,
}

impl Report {
    pub(crate) fn text(&self) -> &str {
        &self.text
    }
}

/// What to tell the model about turns that stopped without finishing.
///
/// `asking` is the turn being assembled, which by now has a record of its own
/// and must not be mistaken for one of the ones that came before it.
///
/// Reading this settles nothing. The turn that reads it may itself die before
/// reaching a provider — on a missing key, an unreadable config, a context that
/// will not build — and then nobody has been told anything. Only
/// `confirm_delivered`, called once a reply has been read to the end, writes
/// that down.
pub(crate) fn block(
    conn: &mut SqliteConnection,
    coordinator: &TurnCoordinator,
    conversation_id: &str,
    asking: Option<&str>,
) -> Option<Report> {
    let candidates =
        crate::db::ops::turn::unreported_for_conversation(conn, conversation_id, asking, WINDOW)
            .ok()?;
    // Newest first, the order the query returns.
    let cut_off: Vec<&Turn> = candidates.iter().filter(|t| was_cut_off(t, coordinator)).collect();
    let picked = choose(&cut_off);
    if picked.is_empty() {
        return None;
    }
    Some(Report {
        text: describe(&picked),
        turns: picked.iter().map(|t| t.id.clone()).collect(),
    })
}

/// Which of the turns still owed an explanation this message carries, oldest
/// first.
///
/// `cut_off` arrives newest first. Recency is the obvious way to cap it and the
/// wrong one on its own: the turn that matters is the one that may have left a
/// file half-written, and that is a property of what it was doing, not of when
/// it happened. A newer interruption is not evidence about an older one and
/// must not be allowed to push it out of the message — so anything caught
/// inside a tool is taken first, and only then is the rest of the room filled
/// by recency.
///
/// Whatever does not fit is not dropped. It is still unreported, so the next
/// message asks the same question and gets it.
fn choose<'a>(cut_off: &[&'a Turn]) -> Vec<&'a Turn> {
    let risky = |t: &Turn| matches!(t.phase(), Some(TurnPhase::RunningTool));
    let mut chosen: Vec<usize> =
        (0..cut_off.len()).filter(|&i| risky(cut_off[i])).take(AT_MOST).collect();
    for i in 0..cut_off.len() {
        if chosen.len() >= AT_MOST {
            break;
        }
        if !chosen.contains(&i) {
            chosen.push(i);
        }
    }
    // Indices count backwards through time, so descending is the order the
    // interruptions actually happened in.
    chosen.sort_unstable_by(|a, b| b.cmp(a));
    chosen.into_iter().map(|i| cut_off[i]).collect()
}

/// Async wrapper for the runners, which hold a pool rather than a connection.
pub(crate) async fn load_block(
    pool: &crate::db::DbPool,
    coordinator: &std::sync::Arc<TurnCoordinator>,
    conversation_id: &str,
    asking: &str,
) -> Option<Report> {
    let pool = pool.clone();
    let coordinator = std::sync::Arc::clone(coordinator);
    let conv = conversation_id.to_string();
    let asking = asking.to_string();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().ok()?;
        block(&mut conn, &coordinator, &conv, Some(&asking))
    })
    .await
    .ok()
    .flatten()
}

/// Record that these turns have now been described to the model.
///
/// Called at the one moment that proves it: a reply read to the end. Not when
/// the block is read — a turn can read it and die on the way — nor when the
/// stream opens, because a provider that answers 200 and then refuses over SSE
/// processed none of it. And not when the turn ends either, because by then it
/// may have ended badly for reasons that have nothing to do with whether the
/// model saw this.
///
/// Every way of getting it wrong is therefore a repeated warning rather than a
/// lost one, including a write that fails. That is the direction to fail in:
/// saying twice that a tool may be half-run costs a paragraph, saying it zero
/// times costs whatever the model does next.
pub(crate) async fn confirm_delivered(pool: &crate::db::DbPool, report: Report) {
    let pool = pool.clone();
    let turns = report.turns;
    let written = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        crate::db::ops::turn::mark_reported(&mut conn, &turns, crate::util::now_ms())
            .map_err(|e| e.to_string())
    })
    .await;
    match written {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => tracing::warn!(error = %e, "could not record that an interruption was reported"),
        Err(e) => tracing::warn!(error = %e, "recording a reported interruption panicked"),
    }
}

fn describe(turns: &[&Turn]) -> String {
    let each: Vec<String> = turns.iter().map(|t| what_happened(t)).collect();
    // Says that it stopped, not why. The rule that gets a turn here — running,
    // and nobody holding it — is met by a process that was killed, by a task
    // that panicked, and by one dropped at shutdown, and the record cannot tell
    // them apart. Naming a cause the record does not have would be a guess
    // dressed as context, and the model has no way to check it.
    //
    // What is always true is that it never reached an ending. A turn that
    // failed, or that the loop guard stopped, did reach one — and said so in
    // the transcript the model can already see.
    let body = match each.as_slice() {
        [only] => format!(
            "A turn in this conversation was cut off before it finished, and nothing recorded \
             why. {only}"
        ),
        many => format!(
            "Several turns in this conversation were cut off before they finished, and nothing \
             recorded why. Oldest first.\n{}",
            many.iter().map(|w| format!("- {w}")).collect::<Vec<_>>().join("\n")
        ),
    };
    format!("<interrupted_turn>\n{body}\n</interrupted_turn>")
}

fn what_happened(turn: &Turn) -> String {
    let tool = turn.phase_tool.as_deref().unwrap_or("a tool");
    match turn.phase() {
        // The dangerous one: the call had started, so whatever it does may
        // already be done. Saying "it failed" would be as wrong as saying it
        // succeeded, and either would have the model act on a guess.
        Some(TurnPhase::RunningTool) => format!(
            "It had started running {tool} and never recorded the result, so that call may have \
             taken effect, may have half-taken effect, or may not have run at all. Do not assume \
             either way — check the current state before doing anything that depends on it, and \
             do not simply repeat the call if repeating it would not be safe."
        ),
        // The safe one, and worth saying so plainly.
        Some(TurnPhase::AwaitingApproval) => format!(
            "It was waiting for the user to approve {tool} when it stopped. That call did not run. \
             Ask again if it is still what you need."
        ),
        Some(TurnPhase::Compacting) => "It was summarising this conversation's history when it \
             stopped, so the history you can see may be missing a summary it was about to write. \
             Nothing was lost; there may just be more of it than usual."
            .to_string(),
        Some(TurnPhase::Streaming) | None => {
            "It stopped part way through writing a reply. Anything it had begun to say is \
             incomplete."
                .to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::turn::ERROR_LOOP_DETECTED;
    use crate::db::ops::conversation::create_conversation;
    use crate::db::ops::turn;
    use crate::db::test_db;
    use crate::turn::TurnOrigin;
    use std::sync::Arc;

    fn setup() -> (crate::db::DbPool, Arc<TurnCoordinator>) {
        let pool = test_db();
        {
            let mut conn = pool.get().unwrap();
            create_conversation(&mut conn, "c1", Some("t"), None, None, 1).unwrap();
        }
        (pool, Arc::new(TurnCoordinator::new()))
    }

    fn latest(pool: &crate::db::DbPool, coordinator: &TurnCoordinator) -> Option<Report> {
        let mut conn = pool.get().unwrap();
        block(&mut conn, coordinator, "c1", None)
    }

    /// What the real caller looks like: a turn that has already opened its own
    /// record asking about the ones before it. Without the exclusion it would
    /// find itself — running, and held — and report nothing.
    fn asked_by(
        pool: &crate::db::DbPool,
        coordinator: &TurnCoordinator,
        asking: &str,
    ) -> Option<Report> {
        let mut conn = pool.get().unwrap();
        block(&mut conn, coordinator, "c1", Some(asking))
    }

    /// The other half of a real caller: the request got out, so what it carried
    /// is now on record as told.
    fn delivered(pool: &crate::db::DbPool, report: Report, at: i64) {
        let mut conn = pool.get().unwrap();
        turn::mark_reported(&mut conn, &report.turns, at).unwrap();
    }

    #[test]
    fn a_conversation_with_no_turns_says_nothing() {
        let (pool, c) = setup();
        assert!(latest(&pool, &c).is_none());
    }

    #[test]
    fn a_turn_that_finished_says_nothing() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        turn::finish(&mut conn, "t1", TurnStatus::Done, None, 1500).unwrap();
        drop(conn);

        assert!(latest(&pool, &c).is_none());
    }

    /// Reconciliation only runs at startup, so a turn that died in this process
    /// still says `running`. Trusting the column would miss it entirely.
    #[test]
    fn a_turn_still_marked_running_but_held_by_nobody_was_cut_off() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        turn::set_phase(&mut conn, "t1", TurnPhase::RunningTool, Some("edit_file"), 1001).unwrap();
        drop(conn);

        let told = latest(&pool, &c).expect("a turn nobody is running was cut off");
        assert!(told.text().contains("edit_file"));
        assert!(told.text().contains("may have taken effect"));
    }

    /// The other half of the same rule: a turn the coordinator really is
    /// running is not an interruption, and saying so would be a lie told to the
    /// model about work still in progress.
    #[test]
    fn a_turn_that_is_actually_running_is_not_an_interruption() {
        let (pool, c) = setup();
        let lease = c.try_acquire_turn_as("c1", TurnOrigin::Desktop, "t1".into()).unwrap();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        drop(conn);

        assert!(latest(&pool, &c).is_none());

        // And once it goes away without finishing, it is.
        drop(lease);
        assert!(latest(&pool, &c).is_some());
    }

    /// The coordinator is keyed by conversation, so holding *a* turn is not
    /// holding *this* turn — a new turn running on the same conversation must
    /// not make the dead one before it look alive.
    #[test]
    fn a_newer_turn_does_not_vouch_for_an_older_one() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "dead", "c1", TurnOrigin::Desktop, 1000).unwrap();
        drop(conn);
        let _live = c.try_acquire_turn_as("c1", TurnOrigin::Desktop, "live".into()).unwrap();

        // `dead` is still the most recent recorded turn, and it is not the one
        // being held.
        assert!(latest(&pool, &c).is_some());
    }

    /// The shape every real call has: the asking turn has already recorded
    /// itself, so it is the newest unfinished row on the conversation and would
    /// otherwise be an answer to its own question.
    ///
    /// Two independent things keep it out — the exclusion, and the coordinator
    /// holding it — and the test pins both, because each covers a case the
    /// other does not. The exclusion holds even for a turn the coordinator has
    /// already let go of; the coordinator holds even for a caller that passes
    /// no exclusion at all, which the token estimator does.
    #[test]
    fn a_turn_asking_about_the_one_before_it_does_not_find_itself() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "dead", "c1", TurnOrigin::Desktop, 1000).unwrap();
        turn::set_phase(&mut conn, "dead", TurnPhase::RunningTool, Some("edit_file"), 1001)
            .unwrap();
        drop(conn);

        // The new turn takes the conversation and opens its record, exactly as
        // the runner does before assembling its request.
        let _live = c.try_acquire_turn_as("c1", TurnOrigin::Desktop, "live".into()).unwrap();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "live", "c1", TurnOrigin::Desktop, 2000).unwrap();
        drop(conn);

        let told = asked_by(&pool, &c, "live").expect("the turn before this one was cut off");
        assert_eq!(told.turns, ["dead"]);
        assert!(told.text().contains("edit_file"));

        // Without the exclusion the asking turn is a candidate row, and only
        // the coordinator keeps it out.
        let unfiltered = latest(&pool, &c).expect("the dead turn is still reported");
        assert_eq!(unfiltered.turns, ["dead"], "a turn being run is not a turn that was cut off");
    }

    #[test]
    fn the_startup_verdict_is_believed_without_asking_again() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        turn::set_phase(&mut conn, "t1", TurnPhase::AwaitingApproval, Some("run_command"), 1001)
            .unwrap();
        turn::reconcile_interrupted(&mut conn, 2000).unwrap();
        drop(conn);

        let told = latest(&pool, &c).expect("a reconciled turn is still an interrupted one");
        assert!(told.text().contains("run_command"));
        assert!(
            told.text().contains("did not run"),
            "an approval that was never given ran nothing",
        );
    }

    #[test]
    fn each_phase_says_something_different() {
        let (pool, c) = setup();
        for (phase, tool, expect) in [
            (TurnPhase::Streaming, None, "part way through writing a reply"),
            (TurnPhase::Compacting, None, "summarising this conversation"),
            (TurnPhase::AwaitingApproval, Some("run_command"), "did not run"),
            (TurnPhase::RunningTool, Some("edit_file"), "may have taken effect"),
        ] {
            let mut conn = pool.get().unwrap();
            let id = format!("t-{}", phase.as_str());
            turn::begin(&mut conn, &id, "c1", TurnOrigin::Desktop, 1000).unwrap();
            turn::set_phase(&mut conn, &id, phase, tool, 1001).unwrap();
            drop(conn);

            let told = latest(&pool, &c).expect("cut off");
            assert!(told.text().contains(expect), "{}: {}", phase.as_str(), told.text());
            // Settle it, so the next phase is read on its own rather than
            // alongside everything before it.
            delivered(&pool, told, 1002);
        }
    }

    /// A turn that failed, or that the loop guard stopped, reached an ending —
    /// and said so where the model can already see it: the error bubble, or the
    /// loop guard's own message sitting in the transcript as a tool result.
    /// This block is only for turns that never got to say anything.
    #[test]
    fn a_turn_that_ended_badly_is_not_an_interruption() {
        let (pool, c) = setup();
        for (id, error) in [
            ("looped", Some(ERROR_LOOP_DETECTED)),
            ("broke", Some("API Key not set")),
        ] {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, id, "c1", TurnOrigin::Desktop, 1000).unwrap();
            turn::finish(&mut conn, id, TurnStatus::Failed, error, 1500).unwrap();
            drop(conn);

            assert!(latest(&pool, &c).is_none(), "{id} ended, badly but definitely");
        }
    }

    /// Stopping is a decision the user made and watched happen.
    #[test]
    fn a_turn_the_user_stopped_is_not_an_interruption() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        turn::finish(&mut conn, "t1", TurnStatus::Cancelled, None, 1500).unwrap();
        drop(conn);

        assert!(latest(&pool, &c).is_none());
    }

    /// A turn that took the notice to a provider settles it, and it does not
    /// come back.
    #[test]
    fn a_turn_that_carried_the_notice_clears_it() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "dead", "c1", TurnOrigin::Desktop, 1000).unwrap();
        drop(conn);

        // The good turn opens its record, reads the notice, and gets its
        // request away.
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "good", "c1", TurnOrigin::Desktop, 2000).unwrap();
        drop(conn);
        let told = asked_by(&pool, &c, "good").expect("the turn before it was cut off");
        assert!(told.text().contains("cut off"));
        delivered(&pool, told, 2100);

        let mut conn = pool.get().unwrap();
        turn::finish(&mut conn, "good", TurnStatus::Done, None, 2500).unwrap();
        drop(conn);

        assert!(latest(&pool, &c).is_none());
    }

    /// The hole the "just look at the most recent turn" version had.
    ///
    /// A turn that dies before reaching a provider carries nothing, so it
    /// cannot have settled anything — but it *is* the most recent turn, and
    /// under the old rule that alone was enough to make the warning stop. The
    /// one warning that says a tool may have half-run then disappeared without
    /// the model ever having seen it.
    #[test]
    fn a_turn_that_died_before_reaching_the_provider_settles_nothing() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "dead", "c1", TurnOrigin::Desktop, 1000).unwrap();
        turn::set_phase(&mut conn, "dead", TurnPhase::RunningTool, Some("edit_file"), 1001)
            .unwrap();
        drop(conn);

        // The next turn reads the warning and then falls over on its way out —
        // a missing key, an unreadable config. It never sent anything.
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "stillborn", "c1", TurnOrigin::Desktop, 2000).unwrap();
        drop(conn);
        assert!(
            asked_by(&pool, &c, "stillborn").is_some(),
            "it read the warning, which is not the same as delivering it",
        );
        let mut conn = pool.get().unwrap();
        turn::finish(&mut conn, "stillborn", TurnStatus::Failed, Some("API Key not set"), 2100)
            .unwrap();
        drop(conn);

        // The turn after it still has to be told.
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "next", "c1", TurnOrigin::Desktop, 3000).unwrap();
        drop(conn);
        let told = asked_by(&pool, &c, "next").expect("nobody has told the model yet");
        assert!(told.text().contains("edit_file"));
        assert!(told.text().contains("may have taken effect"));
        assert_eq!(told.turns, ["dead"], "the failed turn is an ending, not an interruption");
    }

    /// Crashing twice without a request getting out in between owes two
    /// explanations, and the dangerous one is the older of them — so it cannot
    /// be left for a later message.
    #[test]
    fn every_turn_still_owed_an_explanation_gets_one() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        turn::begin(&mut conn, "first", "c1", TurnOrigin::Desktop, 1000).unwrap();
        turn::set_phase(&mut conn, "first", TurnPhase::RunningTool, Some("edit_file"), 1001)
            .unwrap();
        turn::begin(&mut conn, "second", "c1", TurnOrigin::Desktop, 2000).unwrap();
        turn::set_phase(&mut conn, "second", TurnPhase::Compacting, None, 2001).unwrap();
        drop(conn);

        let told = latest(&pool, &c).expect("both are still owed");
        assert_eq!(told.turns, ["first", "second"], "oldest first, as they happened");
        let at = |needle: &str| told.text().find(needle).unwrap_or(usize::MAX);
        assert!(at("edit_file") < at("summarising"), "{}", told.text());
        assert!(told.text().contains("Several turns"));

        delivered(&pool, told, 3000);
        assert!(latest(&pool, &c).is_none());
    }

    /// Nothing beyond the cap is thrown away — it is only deferred, and the
    /// newest are the ones that go first because they are the ones with a
    /// bearing on what happens next.
    #[test]
    fn more_wrecks_than_fit_are_deferred_rather_than_dropped() {
        let (pool, c) = setup();
        {
            let mut conn = pool.get().unwrap();
            for n in 0..(AT_MOST as i64 + 1) {
                turn::begin(&mut conn, &format!("t{n}"), "c1", TurnOrigin::Desktop, 1000 + n)
                    .unwrap();
            }
        }

        let told = latest(&pool, &c).expect("four wrecks");
        assert_eq!(told.turns, ["t1", "t2", "t3"]);
        delivered(&pool, told, 5000);

        let rest = latest(&pool, &c).expect("the oldest one is still owed");
        assert_eq!(rest.turns, ["t0"]);
        delivered(&pool, rest, 5001);
        assert!(latest(&pool, &c).is_none());
    }

    /// The cap must not let recency decide what matters. Three later
    /// interruptions say nothing at all about a tool that was mid-execution
    /// before them, so they cannot be the reason the model is not told about it.
    #[test]
    fn a_newer_wreck_cannot_bury_an_older_one_that_was_inside_a_tool() {
        let (pool, c) = setup();
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "wrote-a-file", "c1", TurnOrigin::Desktop, 1000).unwrap();
            turn::set_phase(
                &mut conn,
                "wrote-a-file",
                TurnPhase::RunningTool,
                Some("edit_file"),
                1001,
            )
            .unwrap();
            for n in 0..(AT_MOST as i64) {
                turn::begin(&mut conn, &format!("later{n}"), "c1", TurnOrigin::Desktop, 2000 + n)
                    .unwrap();
            }
        }

        let told = latest(&pool, &c).expect("four wrecks, one of them dangerous");
        assert!(
            told.turns.contains(&"wrote-a-file".to_string()),
            "the tool that may have taken effect went first: {:?}",
            told.turns,
        );
        assert_eq!(told.turns[0], "wrote-a-file", "and it is still told oldest first");
        assert!(told.text().contains("edit_file"));
        assert_eq!(told.turns.len(), AT_MOST);
    }

    /// Turns belong to their conversation; one that died elsewhere is not this
    /// conversation's business.
    #[test]
    fn another_conversations_wreck_is_not_reported_here() {
        let (pool, c) = setup();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c2", Some("t"), None, None, 1).unwrap();
        turn::begin(&mut conn, "t1", "c2", TurnOrigin::Desktop, 1000).unwrap();
        drop(conn);

        assert!(latest(&pool, &c).is_none());
    }
}
