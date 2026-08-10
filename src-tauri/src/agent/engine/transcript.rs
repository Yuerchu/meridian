//! The rows a turn writes as it runs, and the phase it records while it works.
//!
//! Free functions over a `DbPool` rather than a trait. Both runners write the
//! same rows to the same tables in the same order — there is no second
//! implementation for a trait to abstract over, and one with a single impl
//! would be ceremony that also has to be argued past the `Send` bound on the
//! loop's future. If a sub-agent later needs to persist somewhere else, that is
//! the point at which there are two of something.
//!
//! What is worth stating is that these three writes fail in three different
//! ways, on purpose, and each signature says which:
//!
//! | write | database says no | the worker never came back |
//! |---|---|---|
//! | the assistant placeholder | the turn ends | the turn ends |
//! | filling that row in | swallowed | the turn ends |
//! | the tool result row | logged, turn continues | logged, turn continues |
//!
//! The two columns are not the same failure. A refused write is the database
//! having an opinion; a `spawn_blocking` join error means the worker panicked or
//! the runtime is going down, and carrying on from that is not a considered
//! trade — it is not knowing what happened. So only the middle row differs
//! between them, and it differs because that is what it has always done.
//!
//! That swallow is inherited rather than argued for, and it is on the drift
//! list. The third row is deliberate and load-bearing in both columns: by the
//! time it runs the tool has already touched the world, so refusing to carry on
//! would cost more than the row does.

use std::future::Future;

use crate::db::models::message::NewMessage;
use crate::db::models::turn::TurnPhase;
use crate::db::DbPool;
use crate::util::{get_conn, now_ms};

/// Open the row this iteration will stream into, and return its id.
///
/// Hard error, unlike the two below. Nothing downstream works without it: the
/// `message_start` event names it, every chunk is addressed to it, and the tool
/// rows hang off it. A turn that cannot write this one has nowhere to put its
/// answer.
pub(crate) async fn begin_assistant(
    pool: &DbPool,
    conversation_id: &str,
    turn_id: &str,
    model: &str,
    parent: Option<&str>,
) -> Result<String, String> {
    let message_id = uuid::Uuid::new_v4().to_string();
    let pool = pool.clone();
    let conv_id = conversation_id.to_string();
    let msg_id = message_id.clone();
    let model = model.to_string();
    let turn = turn_id.to_string();
    let parent = parent.map(str::to_string);
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        crate::db::ops::message::append_message(
            &mut conn,
            &NewMessage {
                id: &msg_id, conversation_id: &conv_id, role: "assistant", content: "",
                provider_id: None, model_id: Some(&model), input_tokens: None,
                output_tokens: None, tool_calls: None, tool_call_id: None, sort_order: 0,
                created_at: now_ms(), reasoning_content: None, rating: None, schema_version: 2,
                is_compact_summary: 0, sender_id: None,
                parent_id: None, compact_anchor_id: None, source: None,
                turn_id: Some(&turn), tool_outcome: None,
            },
            parent.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(message_id)
}

/// Fill in the row once the model has finished with it.
///
/// Swallows a refused write, which is inherited rather than argued for — see
/// the module note. The consolation is that the turn record makes it
/// diagnosable now: a turn that reached `done` above an assistant row with no
/// content is a write that went missing, and nothing else produces that shape.
///
/// Does *not* swallow a join error. That is the worker having panicked or the
/// runtime shutting down, which says nothing about whether the row was written
/// and is not something to carry on from.
pub(crate) async fn complete_assistant(
    pool: &DbPool,
    message_id: &str,
    content: &str,
    reasoning: Option<&str>,
    tool_calls_json: Option<&str>,
    input_tokens: Option<i32>,
    output_tokens: Option<i32>,
) -> Result<(), String> {
    let pool = pool.clone();
    let msg_id = message_id.to_string();
    let content = content.to_string();
    let reasoning = reasoning.map(str::to_string);
    let tool_calls_json = tool_calls_json.map(str::to_string);
    tokio::task::spawn_blocking(move || {
        if let Ok(mut conn) = pool.get() {
            let _ = crate::db::ops::message::update_assistant_message(
                &mut conn,
                &msg_id,
                &content,
                reasoning.as_deref(),
                tool_calls_json.as_deref(),
                input_tokens,
                output_tokens,
            );
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Record what a tool returned. `None` means it was not written.
///
/// The caller is expected to leave its parent cursor where it was on `None`,
/// so the next row hangs off the last one that did land and the chain stays
/// intact. Aborting instead would be worse than losing the row: the tool has
/// already run by the time this is called, so the world has changed whether or
/// not the transcript says so. The unanswered `tool_call` is stripped from the
/// payload later by `remove_orphan_tool_messages`.
pub(crate) async fn append_tool_result(
    pool: &DbPool,
    conversation_id: &str,
    turn_id: &str,
    call_id: &str,
    content: &str,
    outcome: &'static str,
    parent: Option<&str>,
) -> Option<String> {
    let pool = pool.clone();
    let conv_id = conversation_id.to_string();
    let message_id = uuid::Uuid::new_v4().to_string();
    let msg_id = message_id.clone();
    let call_id = call_id.to_string();
    let content = content.to_string();
    let turn = turn_id.to_string();
    let parent = parent.map(str::to_string);
    let written = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        crate::db::ops::message::append_message(
            &mut conn,
            &NewMessage {
                id: &msg_id, conversation_id: &conv_id, role: "tool",
                content: &content, provider_id: None, model_id: None,
                input_tokens: None, output_tokens: None,
                tool_calls: None, tool_call_id: Some(&call_id),
                sort_order: 0, created_at: now_ms(),
                reasoning_content: None, rating: None, schema_version: 2,
                is_compact_summary: 0, sender_id: None,
                parent_id: None, compact_anchor_id: None, source: None,
                turn_id: Some(&turn),
                // The same word the event carries. Stored so a reload does not
                // turn a refusal into a green tick with the refusal text
                // sitting in it as the result.
                tool_outcome: Some(outcome),
            },
            parent.as_deref(),
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    })
    .await;

    match written {
        Ok(Ok(())) => Some(message_id),
        Ok(Err(e)) => {
            tracing::error!("failed to persist tool result: {e}");
            None
        }
        Err(e) => {
            tracing::error!("tool result write panicked: {e}");
            None
        }
    }
}

/// Run something with the turn recorded as being in a phase, and back to
/// streaming when it returns.
///
/// The phase is written *before* the work, which is the entire point: what is
/// stored when the process dies is where it died. `RunningTool` is the one that
/// matters — it means a call had started and the world outside the database may
/// already have changed.
///
/// Restoring `Streaming` afterwards matters nearly as much. Leaving the phase
/// behind would have a crash a minute later report a tool that finished long
/// ago, or an approval card that is no longer on screen.
pub(crate) async fn in_phase<T>(
    pool: &DbPool,
    turn_id: &str,
    phase: TurnPhase,
    tool: Option<&str>,
    work: impl Future<Output = T>,
) -> T {
    crate::agent::turn_record::note_phase(pool, turn_id, phase, tool).await;
    let out = work.await;
    crate::agent::turn_record::note_phase(pool, turn_id, TurnPhase::Streaming, None).await;
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::turn::TurnStatus;
    use crate::db::test_db;
    use crate::turn::TurnOrigin;
    use diesel::prelude::*;

    fn conversation(pool: &DbPool) {
        let mut conn = pool.get().unwrap();
        crate::db::ops::conversation::create_conversation(&mut conn, "c1", Some("t"), None, None, 1)
            .unwrap();
        crate::db::ops::turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
    }

    fn rows(pool: &DbPool) -> Vec<crate::db::models::message::Message> {
        let mut conn = pool.get().unwrap();
        crate::db::ops::message::list_messages(&mut conn, "c1").unwrap()
    }

    fn head(pool: &DbPool) -> Option<String> {
        let mut conn = pool.get().unwrap();
        crate::db::ops::conversation::get_conversation(&mut conn, "c1").unwrap().head_message_id
    }

    fn phase(pool: &DbPool) -> (Option<TurnPhase>, Option<String>) {
        let mut conn = pool.get().unwrap();
        let t: crate::db::models::turn::Turn =
            crate::db::schema::turns::table.find("t1").first(&mut conn).unwrap();
        (t.phase(), t.phase_tool)
    }

    #[tokio::test]
    async fn an_iteration_opens_a_row_and_then_fills_it_in() {
        let pool = test_db();
        conversation(&pool);

        let id = begin_assistant(&pool, "c1", "t1", "gpt-4.1-mini", None).await.unwrap();
        // Empty until the model has finished, which is what makes a `done` turn
        // above an empty row diagnosable as a lost write.
        assert_eq!(rows(&pool)[0].content, "");
        assert_eq!(head(&pool).as_deref(), Some(id.as_str()));

        complete_assistant(&pool, &id, "the answer", Some("thinking"), None, Some(7), Some(11))
            .await
            .unwrap();

        let row = &rows(&pool)[0];
        assert_eq!(row.content, "the answer");
        assert_eq!(row.reasoning_content.as_deref(), Some("thinking"));
        assert_eq!(row.input_tokens, Some(7));
        assert_eq!(row.turn_id.as_deref(), Some("t1"));
    }

    /// The one write that takes the turn down with it. Everything downstream is
    /// addressed to the row it returns, so there is nothing useful to carry on
    /// with.
    #[tokio::test]
    async fn a_turn_that_cannot_open_a_row_stops() {
        let pool = test_db();
        // No conversation, so the foreign key refuses it.
        assert!(begin_assistant(&pool, "nope", "t1", "m", None).await.is_err());
    }

    /// Filling the row in is the one write that swallows a refused write.
    ///
    /// A refusal has to be real to prove anything: an update against an id that
    /// does not exist matches nothing and returns `Ok(0)`, which is not an
    /// error and would have this test passing on a version that propagated
    /// them. So the database is put into `query_only` and asked to write.
    ///
    /// The pool hands out one connection (`max_size(1)`) and the customizer's
    /// `on_acquire` runs once when it is established, so the pragma survives
    /// being handed back and picked up again inside `complete_assistant`.
    ///
    /// The other half of this function's contract — that a `spawn_blocking`
    /// join error is *not* swallowed — has no test. Inducing one means
    /// panicking a worker, and the only way to reach that from here would be a
    /// hook in production code. It is held by the return type and by the `?` at
    /// both call sites.
    #[tokio::test]
    async fn filling_a_row_in_swallows_a_database_write_error() {
        let pool = test_db();
        conversation(&pool);
        let id = begin_assistant(&pool, "c1", "t1", "m", None).await.unwrap();

        {
            use diesel::connection::SimpleConnection;
            let mut conn = pool.get().unwrap();
            conn.batch_execute("PRAGMA query_only=ON").unwrap();
            // The write really is refused, so what follows is testing something.
            assert!(
                crate::db::ops::message::update_assistant_message(
                    &mut conn, &id, "the answer", None, None, None, None,
                )
                .is_err(),
                "query_only must make this a real failure",
            );
        }

        assert!(
            complete_assistant(&pool, &id, "the answer", None, None, None, None).await.is_ok(),
            "a refused write does not take the turn down with it",
        );

        {
            use diesel::connection::SimpleConnection;
            let mut conn = pool.get().unwrap();
            conn.batch_execute("PRAGMA query_only=OFF").unwrap();
        }
        // And it really did not land — the swallow is a swallow, not a retry.
        assert_eq!(rows(&pool)[0].content, "");
    }

    /// The opposite trade, and the reason it is the opposite: by the time this
    /// runs the tool has already touched the world. Losing the row costs the
    /// transcript a line; aborting costs the model any chance to react to what
    /// its own call just did.
    #[tokio::test]
    async fn a_tool_result_that_cannot_be_written_does_not_stop_the_turn() {
        let pool = test_db();
        conversation(&pool);
        let assistant = begin_assistant(&pool, "c1", "t1", "m", None).await.unwrap();

        let landed = append_tool_result(
            &pool, "c1", "t1", "call-1", "done", "success", Some(&assistant),
        )
        .await;
        assert!(landed.is_some());
        assert_eq!(head(&pool), landed, "the cursor moves onto it");

        // Same call against a conversation that does not exist: refused, and
        // said so without unwinding.
        let lost = append_tool_result(
            &pool, "nope", "t1", "call-2", "done", "success", Some(&assistant),
        )
        .await;
        assert!(lost.is_none(), "None is how the caller knows to leave the cursor alone");
    }

    /// A refusal has to survive a reload, or the card comes back as a green
    /// tick with the refusal text displayed as the tool's output.
    #[tokio::test]
    async fn a_tool_row_records_how_the_call_went() {
        let pool = test_db();
        conversation(&pool);

        for (call, outcome) in [("a", "success"), ("b", "denied"), ("c", "error")] {
            append_tool_result(&pool, "c1", "t1", call, "x", outcome, None).await.unwrap();
        }

        let stored: Vec<Option<String>> = rows(&pool)
            .into_iter()
            .filter(|m| m.role == "tool")
            .map(|m| m.tool_outcome)
            .collect();
        assert_eq!(stored, [
            Some("success".into()),
            Some("denied".into()),
            Some("error".into())
        ]);
    }

    /// Written before the work, not after — whatever is stored when the process
    /// dies is where it died.
    #[tokio::test]
    async fn the_phase_is_recorded_while_the_work_runs_and_given_back_after() {
        let pool = test_db();
        conversation(&pool);

        let seen = in_phase(&pool, "t1", TurnPhase::RunningTool, Some("edit_file"), async {
            phase(&pool)
        })
        .await;

        assert_eq!(seen, (Some(TurnPhase::RunningTool), Some("edit_file".into())));
        assert_eq!(phase(&pool), (Some(TurnPhase::Streaming), None), "and it does not linger");
    }

    /// It brackets an approval the same way, which is a window the process can
    /// sit in for as long as the user takes to answer.
    #[tokio::test]
    async fn the_same_bracket_covers_waiting_on_a_person() {
        let pool = test_db();
        conversation(&pool);

        let seen = in_phase(&pool, "t1", TurnPhase::AwaitingApproval, Some("run_command"), async {
            phase(&pool)
        })
        .await;

        assert_eq!(seen, (Some(TurnPhase::AwaitingApproval), Some("run_command".into())));
    }

    /// A turn that has already ended does not move, so a bracket that outlives
    /// it cannot rewrite how it finished.
    #[tokio::test]
    async fn a_bracket_on_a_finished_turn_changes_nothing() {
        let pool = test_db();
        conversation(&pool);
        {
            let mut conn = pool.get().unwrap();
            crate::db::ops::turn::finish(&mut conn, "t1", TurnStatus::Done, None, 1500).unwrap();
        }

        in_phase(&pool, "t1", TurnPhase::RunningTool, Some("edit_file"), async {}).await;

        assert_eq!(phase(&pool), (Some(TurnPhase::Streaming), None), "as `begin` left it");
    }
}
