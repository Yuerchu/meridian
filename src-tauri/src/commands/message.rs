use diesel::Connection;
use tauri::Manager;

use crate::db;
use crate::db::models::message::Message;
use crate::state::{AppDb, AppTurns};
use crate::agent::extract_tool_calls_from_blocks;

/// The active path, the summary that applies to it, and where it can be paged.
///
/// Returned as one snapshot so the caller never renders a half-applied state:
/// fetching the messages and the branch points separately would leave a frame
/// where the pagers describe a path that is no longer on screen.
#[derive(serde::Serialize)]
pub struct MessageTree {
    /// The summary, when one applies, is appended rather than placed in order —
    /// the front end picks it out by `is_compact_summary` and draws it as a
    /// boundary marker, not as part of the transcript.
    pub messages: Vec<Message>,
    pub head_message_id: Option<String>,
    pub branches: Vec<db::ops::message::BranchPoint>,
}

fn read_tree_with_conversation(
    conn: &mut db::PooledConn,
    conversation_id: &str,
) -> Result<(db::models::conversation::Conversation, MessageTree), String> {
    let conv = db::ops::conversation::get_conversation(conn, conversation_id)
        .map_err(|e| e.to_string())?;
    let history = db::ops::message::list_messages(conn, conversation_id)
        .map_err(|e| e.to_string())?;
    let ctx = db::ops::message::active_context(&history, conv.head_message_id.as_deref());
    let branches = db::ops::message::branch_points(&history, &ctx.path);
    let head_message_id = ctx.head_id.clone();
    let mut messages = ctx.path;
    messages.extend(ctx.summary);
    Ok((conv, MessageTree { messages, head_message_id, branches }))
}

/// A turn as the transcript needs it: how it ended, and what it was doing.
///
/// `status` is not the stored column. A turn that stopped without recording an
/// ending leaves `running` behind, and reconciliation only rewrites those at
/// startup, so the row alone would have a turn that ended an hour ago read as
/// one still in progress. The coordinator decides, and the answer arrives
/// already decided — the front end has no way to ask.
///
/// What it does not say is why. The rule is "no recorded ending, and not being
/// run", which the application being killed satisfies and so does a task that
/// panicked while it carried on.
#[derive(serde::Serialize)]
pub struct TurnView {
    pub id: String,
    pub status: String,
    pub phase: Option<String>,
    pub phase_tool: Option<String>,
    pub error: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

/// Everything one conversation needs to be drawn, as of one moment.
#[derive(serde::Serialize)]
pub struct ConversationSnapshot {
    pub conversation: db::models::conversation::Conversation,
    pub tree: MessageTree,
    pub turns: Vec<TurnView>,
    pub pending_approvals: Vec<crate::commands::approval::PendingApprovalInfo>,
}

/// One conversation, read as one state rather than assembled from several.
///
/// Replaces three parallel commands. Those could interleave with a running
/// turn — the tree read before a tool result landed, the turns read after —
/// and the front end would draw a conversation that was never true at any
/// instant, with a turn recorded as finished above a transcript that stops
/// mid-tool.
///
/// Three reads, and neither ordering of the first two is safe on its own:
///
/// 1. **The coordinator, then the database, then the coordinator again.**
///    Reading the register first and trusting it lets a turn start in the gap:
///    the register says nobody is running, the transaction then reads that
///    turn's fresh `running` row, and a live turn is reported as one that
///    crashed. Reading it afterwards has the mirror fault — a turn that
///    finished cleanly in the gap leaves its row read as `running` and its
///    lease already gone. So the register is read on both sides and the pass is
///    only believed if it did not move; `Observed` carries a revision because
///    comparing the held id would miss "nobody, then a short turn, then nobody
///    again", which is the sequence that produces exactly this.
/// 2. **The database, in one transaction.** WAL gives a deferred transaction a
///    consistent view from its first read, so the head, the messages and the
///    turns all describe the same instant. Without it a row written between two
///    of the queries produces a state that never existed.
/// 3. **The approval registry, last.** It is memory, not rows, so it cannot
///    join the transaction — but read after the tree, every approval belonging
///    to a row that was read is visible. Read first, one registered in between
///    would be missing while its row was present, and a live card would draw as
///    orphaned. The other way round, an approval for a row not in the tree
///    matches nothing and is dropped, which costs nothing.
#[tauri::command]
pub async fn conversation_snapshot(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<ConversationSnapshot, String> {
    let coordinator = app.state::<AppTurns>().0.clone();
    let pool = app.state::<AppDb>().0.clone();

    let mut settled = None;
    for attempt in 0..SNAPSHOT_ATTEMPTS {
        let seen = coordinator.observe(&conversation_id);
        let read = read_off_thread(&pool, &conversation_id, Live::Holding(seen.held())).await?;
        if coordinator.unchanged_since(&seen) {
            settled = Some(read);
            break;
        }
        tracing::debug!(
            conversation_id = %conversation_id,
            attempt,
            "a turn started or ended mid-snapshot; reading again",
        );
    }

    let (conversation, tree, turns) = match settled {
        Some(read) => read,
        // Turns are starting and stopping faster than the conversation can be
        // read. Rather than pick one of the passes and hope, this one refuses to
        // call anything interrupted: a crash that really happened is still there
        // at the next open, whereas a live turn labelled as crashed is a lie the
        // user reads now.
        None => {
            tracing::warn!(
                conversation_id = %conversation_id,
                "could not read this conversation and its turns as one state",
            );
            read_off_thread(&pool, &conversation_id, Live::Unsettled).await?
        }
    };

    let pending_approvals = crate::commands::approval::pending_for(&app, &conversation_id);
    Ok(ConversationSnapshot { conversation, tree, turns, pending_approvals })
}

/// How many passes before the snapshot gives up on pinning the coordinator down.
///
/// Occupancy changes once when a turn starts and once when it ends, not per
/// token, so a second pass is already unusual and a fourth means something is
/// hammering this process.
const SNAPSHOT_ATTEMPTS: usize = 4;

type SnapshotRead = (db::models::conversation::Conversation, MessageTree, Vec<TurnView>);

async fn read_off_thread(
    pool: &db::DbPool,
    conversation_id: &str,
    live: Live<'_>,
) -> Result<SnapshotRead, String> {
    let pool = pool.clone();
    let conv_id = conversation_id.to_string();
    let live = live.owned();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        read_snapshot(&mut conn, &conv_id, live.borrowed())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What the coordinator had to say about this conversation, or that it would
/// not hold still long enough to say anything.
#[derive(Clone)]
enum Live<'a> {
    /// The turn it was holding, `None` for none at all.
    Holding(Option<&'a str>),
    /// It kept moving. No row is called interrupted on this pass.
    Unsettled,
}

/// The same thing, minus the borrow, for crossing into `spawn_blocking`.
#[derive(Clone)]
enum OwnedLive {
    Holding(Option<String>),
    Unsettled,
}

impl Live<'_> {
    fn owned(&self) -> OwnedLive {
        match self {
            Live::Holding(id) => OwnedLive::Holding(id.map(str::to_string)),
            Live::Unsettled => OwnedLive::Unsettled,
        }
    }
}

impl OwnedLive {
    fn borrowed(&self) -> Live<'_> {
        match self {
            OwnedLive::Holding(id) => Live::Holding(id.as_deref()),
            OwnedLive::Unsettled => Live::Unsettled,
        }
    }
}

/// The database half, in one transaction.
///
/// The transaction is the point. WAL gives a deferred one a consistent view
/// from its first read, so the head this returns, the rows it selected and the
/// turns it judged all describe the same instant. Read without it, a turn
/// appending a tool result between two of these queries yields a conversation
/// that was never true: a turn recorded as finished sitting above a transcript
/// that stops mid-tool, or a message belonging to a turn the caller has no
/// record of.
fn read_snapshot(
    conn: &mut db::PooledConn,
    conversation_id: &str,
    live: Live<'_>,
) -> Result<SnapshotRead, String> {
    conn.transaction::<_, diesel::result::Error, _>(|conn| {
        let (conversation, tree) = read_tree_with_conversation(conn, conversation_id)
            .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
        let turns = db::ops::turn::list_for_conversation(conn, conversation_id)?
            .into_iter()
            .map(|t| TurnView {
                status: effective_status(&t, &live),
                id: t.id,
                phase: t.phase,
                phase_tool: t.phase_tool,
                error: t.error,
                started_at: t.started_at,
                ended_at: t.ended_at,
            })
            .collect();
        Ok((conversation, tree, turns))
    })
    .map_err(|e| e.to_string())
}

/// What the row says, unless the coordinator says otherwise.
///
/// Kept as the stored string rather than a typed enum so a status written by a
/// later build travels through unrecognised instead of being flattened into
/// something this one happens to know.
fn effective_status(turn: &db::models::turn::Turn, live: &Live<'_>) -> String {
    match live {
        Live::Holding(held) if crate::agent::interrupted::was_cut_off(turn, *held) => {
            db::models::turn::TurnStatus::Interrupted.as_str().to_string()
        }
        _ => turn.status.clone(),
    }
}

// `load_messages` was here: the same read as the tree, minus the head and the
// branch points, and nothing had called it since the front end started needing
// all three together. `conversation_snapshot` is the only way in now, and a
// second entrance that answers a third of the question is how the two drift.

/// Make `message_id`'s branch the active one, landing on its most recent tip.
///
/// Refused while a turn is running: the head this moves is the same one the
/// turn's next `append_message` sets, so the switch would be silently undone a
/// moment later.
///
/// Returns nothing. It used to hand back the new tree, which the caller then
/// threw away — a conversation is read with `conversation_snapshot` now, and a
/// tree without the turns and approvals that belong to it is exactly the
/// half-answer that command exists to replace.
#[tauri::command]
pub async fn switch_branch(
    app: tauri::AppHandle,
    conversation_id: String,
    message_id: String,
) -> Result<(), String> {
    let _lease = app.state::<AppTurns>().0.clone()
        .try_acquire_mutation(&conversation_id, "a branch switch")
        .map_err(|busy| busy.to_string())?;
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::switch_branch(&mut conn, &conversation_id, &message_id)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

// `update_message_content` was here. It took only a message id, so it could not
// name the conversation it was about to rewrite — and therefore could not take
// a mutation lease before doing it. That made it the one write path left that
// could edit a row out from under a running turn. Nothing called it, so it is
// gone rather than fixed; anything that needs it back has to arrive with a
// conversation id and take a lease like every other writer.

/// Delete a message together with everything that followed from it.
///
/// Replaces the single-row delete, which could not be made safe: dropping an
/// assistant row left its tool results behind, and dropping a question left the
/// model reading an answer to nothing.
///
/// Refused while a turn is running, and this is the dangerous one. The row it
/// removes may be the very one the turn's `parent_cursor` points at; `parent_id`
/// carries no foreign key (migration 21), so the next append succeeds and hangs
/// the rest of the turn off a node that no longer exists. `path_to_head` stops
/// at the missing id, and the turn's entire output — still in the table —
/// becomes unreachable.
///
/// Returns nothing, like `switch_branch` and for the same reason: the tree it
/// used to hand back was thrown away by its only caller, and a tree on its own
/// is not a state anything can be drawn from.
#[tauri::command]
pub async fn delete_message(
    app: tauri::AppHandle,
    conversation_id: String,
    id: String,
) -> Result<(), String> {
    let _lease = app.state::<AppTurns>().0.clone()
        .try_acquire_mutation(&conversation_id, "a delete")
        .map_err(|busy| busy.to_string())?;
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::delete_subtree(&mut conn, &conversation_id, &id)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rate_message(app: tauri::AppHandle, id: String, rating: Option<i32>) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::update_rating(&mut conn, &id, rating).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_conversation(app: tauri::AppHandle, conversation_id: String, format: String, output_path: Option<String>) -> Result<String, String> {
    let pool = app.state::<AppDb>().0.clone();
    let result: String = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let conv = db::ops::conversation::get_conversation(&mut conn, &conversation_id)
            .map_err(|e| e.to_string())?;
        let history = db::ops::message::list_messages(&mut conn, &conversation_id)
            .map_err(|e| e.to_string())?;
        // The active path only. Exporting every branch would interleave rival
        // answers to the same question into one transcript, and the DPO pairing
        // below walks backwards for a prompt — across a fork it would pick up a
        // question that belongs to a different branch.
        //
        // Unlike the chat path this keeps everything from the root, compacted or
        // not: a summary is a token-budget device, and the rows it stands in for
        // are exactly the training data being exported.
        let ctx = db::ops::message::active_context(&history, conv.head_message_id.as_deref());
        let messages: Vec<Message> = ctx.path;
        let system_prompt = conv.assistant_id.as_deref()
            .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok())
            .map(|a| a.system_prompt)
            .unwrap_or_default();

        fn msg_to_openai(m: &Message, all_msgs: &[Message]) -> serde_json::Value {
            let mut obj = serde_json::json!({ "role": m.role });
            match m.role.as_str() {
                "assistant" => {
                    if !m.content.is_empty() {
                        obj["content"] = serde_json::json!(m.content);
                    } else {
                        obj["content"] = serde_json::Value::Null;
                    }
                    // Hidden reasoning is intentionally excluded: exports must
                    // only contain the final visible answer.
                    if let Some(ref tc_json) = m.tool_calls {
                        if m.schema_version >= 2 {
                            if let Ok(tcs) = serde_json::from_str::<Vec<serde_json::Value>>(tc_json) {
                                if !tcs.is_empty() { obj["tool_calls"] = serde_json::json!(tcs); }
                            }
                        } else {
                            let tool_calls = extract_tool_calls_from_blocks(tc_json);
                            if !tool_calls.is_empty() {
                                obj["tool_calls"] = serde_json::json!(
                                    tool_calls.iter().map(|tc| serde_json::json!({
                                        "id": tc.id, "type": "function",
                                        "function": { "name": tc.name, "arguments": tc.arguments }
                                    })).collect::<Vec<_>>()
                                );
                            }
                        }
                    }
                }
                "tool" => {
                    obj["content"] = serde_json::json!(m.content);
                    if let Some(ref cid) = m.tool_call_id {
                        obj["tool_call_id"] = serde_json::json!(cid);
                    }
                }
                _ => {
                    obj["content"] = serde_json::json!(m.content);
                }
            }
            obj
        }

        match format.as_str() {
            "sft" => {
                let mut openai_msgs: Vec<serde_json::Value> = Vec::new();
                if !system_prompt.is_empty() {
                    openai_msgs.push(serde_json::json!({"role": "system", "content": system_prompt}));
                }
                for m in &messages {
                    openai_msgs.push(msg_to_openai(m, &messages));
                }
                serde_json::to_string(&serde_json::json!({"messages": openai_msgs}))
                    .map_err(|e| e.to_string())
            }
            "dpo" => {
                let mut lines = Vec::new();
                // Build context prefix (system + user messages up to each rated assistant msg)
                for (i, m) in messages.iter().enumerate() {
                    if m.role != "assistant" || m.rating.is_none() { continue; }
                    // Find the user message that prompted this response
                    let prompt_msgs: Vec<serde_json::Value> = {
                        let mut p = Vec::new();
                        if !system_prompt.is_empty() {
                            p.push(serde_json::json!({"role": "system", "content": system_prompt}));
                        }
                        // Walk backwards from this assistant message to find the preceding user message
                        let user_idx = messages[..i].iter().rposition(|m| m.role == "user");
                        if let Some(ui) = user_idx {
                            p.push(serde_json::json!({"role": "user", "content": messages[ui].content}));
                        }
                        p
                    };
                    let response = msg_to_openai(m, &messages);
                    let rating = m.rating.unwrap_or(0);
                    lines.push(serde_json::json!({
                        "prompt": prompt_msgs,
                        "response": [response],
                        "rating": rating,
                    }));
                }
                let result: Vec<String> = lines.iter()
                    .map(|l| serde_json::to_string(l).unwrap_or_default())
                    .collect();
                Ok(result.join("\n"))
            }
            _ => Err(format!("Unknown export format: {format}")),
        }
    }).await.map_err(|e| e.to_string())??;

    if let Some(ref path) = output_path {
        std::fs::write(path, &result).map_err(|e| e.to_string())?;
    }
    Ok(result)
}

#[tauri::command]
pub async fn upload_file(app: tauri::AppHandle, conversation_id: String, file_path: String) -> Result<serde_json::Value, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Android: handle content:// URIs from SAF file picker
    #[cfg(target_os = "android")]
    if file_path.starts_with("content://") {
        let stat = crate::android_bridge::content_stat(&file_path).await?;
        let original_name = stat.name.unwrap_or_else(|| "file".to_string());
        let ext = original_name.rsplit('.').next()
            .filter(|e| e.len() <= 10 && !e.contains('/'))
            .unwrap_or("bin");
        let (dest_path, uri) = crate::files::alloc_dest(&app_data_dir, &conversation_id, ext)?;
        crate::android_bridge::content_copy(&file_path, dest_path.to_str().ok_or("invalid path")?).await?;
        let mime = stat.mime.unwrap_or_else(|| {
            mime_guess::from_path(&original_name).first_or_octet_stream().to_string()
        });
        let content_part = if mime.starts_with("image/") {
            serde_json::json!({
                "type": "image_url",
                "image_url": { "url": uri }
            })
        } else {
            serde_json::json!({
                "type": "file",
                "file": { "url": uri, "mime_type": mime, "name": original_name }
            })
        };
        return Ok(content_part);
    }

    let src = std::path::Path::new(&file_path);
    let uri = crate::files::store_file(&app_data_dir, &conversation_id, src)?;

    let mime = mime_guess::from_path(src).first_or_octet_stream().to_string();
    let name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();

    let content_part = if mime.starts_with("image/") {
        serde_json::json!({
            "type": "image_url",
            "image_url": { "url": uri }
        })
    } else {
        serde_json::json!({
            "type": "file",
            "file": { "url": uri, "mime_type": mime, "name": name }
        })
    };

    Ok(content_part)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::turn::{TurnPhase, TurnStatus};
    use crate::db::ops::turn;
    use crate::db::test_db;
    use crate::turn::TurnOrigin;

    fn seed(pool: &crate::db::DbPool) {
        let mut conn = pool.get().unwrap();
        crate::db::ops::conversation::create_conversation(&mut conn, "c1", Some("t"), None, None, 1)
            .unwrap();
    }

    fn snapshot(pool: &crate::db::DbPool, held: Option<&str>) -> Vec<TurnView> {
        let mut conn = pool.get().unwrap();
        read_snapshot(&mut conn, "c1", Live::Holding(held)).unwrap().2
    }

    /// When the coordinator will not hold still, nothing is called interrupted.
    /// A crash that really happened is still on record at the next open; a live
    /// turn labelled as crashed is a lie the user reads now.
    fn unsettled(pool: &crate::db::DbPool) -> Vec<TurnView> {
        let mut conn = pool.get().unwrap();
        read_snapshot(&mut conn, "c1", Live::Unsettled).unwrap().2
    }

    /// The whole reason the status is decided here rather than in the front
    /// end. A killed turn leaves `running` behind, and reconciliation only
    /// rewrites those at startup — so the column alone would have a turn that
    /// died an hour ago read as one still in progress.
    #[test]
    fn a_running_turn_nobody_holds_is_reported_as_interrupted() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
            turn::set_phase(&mut conn, "t1", TurnPhase::RunningTool, Some("edit_file"), 1001)
                .unwrap();
        }

        let dead = snapshot(&pool, None);
        assert_eq!(dead[0].status, "interrupted");
        assert_eq!(dead[0].phase.as_deref(), Some("running_tool"));
        assert_eq!(dead[0].phase_tool.as_deref(), Some("edit_file"));

        // And the same row, while it really is running, is not.
        let live = snapshot(&pool, Some("t1"));
        assert_eq!(live[0].status, "running");
    }

    /// The coordinator is per conversation, so holding *a* turn is not holding
    /// *this* one — a new turn must not vouch for the dead one before it.
    #[test]
    fn a_newer_turn_does_not_vouch_for_an_older_one() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "dead", "c1", TurnOrigin::Desktop, 1000).unwrap();
            turn::begin(&mut conn, "live", "c1", TurnOrigin::Desktop, 2000).unwrap();
        }

        let turns = snapshot(&pool, Some("live"));
        assert_eq!(turns.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(), [
            "interrupted",
            "running"
        ]);
        assert_eq!(turns[0].id, "dead", "oldest first, as the transcript reads");
    }

    /// A turn that reached an ending said so, and the coordinator has no
    /// opinion to add.
    #[test]
    fn a_finished_turn_keeps_the_ending_it_recorded() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            for (id, status, error) in [
                ("done", TurnStatus::Done, None),
                ("stopped", TurnStatus::Cancelled, None),
                ("broke", TurnStatus::Failed, Some("API Key not set")),
            ] {
                turn::begin(&mut conn, id, "c1", TurnOrigin::Desktop, 1000).unwrap();
                turn::finish(&mut conn, id, status, error, 1500).unwrap();
            }
        }

        let turns = snapshot(&pool, None);
        assert_eq!(turns.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(), [
            "done",
            "cancelled",
            "failed"
        ]);
        assert_eq!(turns[2].error.as_deref(), Some("API Key not set"));
        assert!(turns.iter().all(|t| t.ended_at == Some(1500)));
    }

    /// A status from a later build travels through as it was written. Deciding
    /// it is not this build's business, and flattening it into something known
    /// would be inventing an answer.
    #[test]
    fn a_status_this_build_does_not_know_is_passed_along() {
        use diesel::prelude::*;
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
            diesel::update(crate::db::schema::turns::table.find("t1"))
                .set(crate::db::schema::turns::status.eq("from_the_future"))
                .execute(&mut conn)
                .unwrap();
        }

        assert_eq!(snapshot(&pool, None)[0].status, "from_the_future");
    }

    /// The pass the retry loop throws away, and what it falls back to.
    ///
    /// A turn that started after the coordinator was read has a `running` row
    /// and no lease as far as this pass knows, which is indistinguishable from
    /// one that stopped without saying so. The revision check is what catches
    /// it; this is what the read looks like once it has been caught and cannot
    /// be settled.
    #[test]
    fn an_unsettled_read_calls_nothing_interrupted() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
            turn::begin(&mut conn, "t2", "c1", TurnOrigin::Desktop, 2000).unwrap();
            turn::finish(&mut conn, "t2", TurnStatus::Done, None, 2500).unwrap();
        }

        // Believed, `t1` reads as interrupted.
        assert_eq!(snapshot(&pool, None)[0].status, "interrupted");
        // Unsettled, it reads as what the row says and nothing is invented.
        let turns = unsettled(&pool);
        assert_eq!(turns.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(), [
            "running", "done"
        ]);
    }

    /// One read, one state: the turns are the turns of the tree that came back
    /// with them, and the head names a row that is in it.
    #[test]
    fn the_tree_and_the_turns_describe_the_same_conversation() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
            crate::db::ops::message::append_message(
                &mut conn,
                &crate::db::models::message::NewMessage {
                    id: "m1",
                    conversation_id: "c1",
                    role: "user",
                    content: "hi",
                    provider_id: None,
                    model_id: None,
                    input_tokens: None,
                    output_tokens: None,
                    tool_calls: None,
                    tool_call_id: None,
                    sort_order: 0,
                    created_at: 1,
                    reasoning_content: None,
                    rating: None,
                    schema_version: 2,
                    is_compact_summary: 0,
                    sender_id: None,
                    parent_id: None,
                    compact_anchor_id: None,
                    source: None,
                    turn_id: Some("t1"),
                    tool_outcome: None,
                },
                None,
            )
            .unwrap();
        }

        let mut conn = pool.get().unwrap();
        let (conv, tree, turns) =
            read_snapshot(&mut conn, "c1", Live::Holding(Some("t1"))).unwrap();

        assert_eq!(conv.id, "c1");
        assert_eq!(tree.messages.len(), 1);
        assert_eq!(tree.messages[0].turn_id.as_deref(), Some("t1"));
        assert_eq!(tree.head_message_id.as_deref(), Some(tree.messages[0].id.as_str()));
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].id, "t1");
    }
}
