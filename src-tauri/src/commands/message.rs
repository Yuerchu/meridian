use diesel::Connection;

use crate::ServicesExt;
use crate::agent::extract_tool_calls_from_blocks;
use crate::db;
use crate::db::models::message::Message;

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
    let conv = db::ops::conversation::get_conversation(conn, conversation_id).map_err(|e| e.to_string())?;
    let history = db::ops::message::list_messages(conn, conversation_id).map_err(|e| e.to_string())?;
    let ctx = db::ops::message::active_context(&history, conv.head_message_id.as_deref());
    let branches = db::ops::message::branch_points(&history, &ctx.path);
    let head_message_id = ctx.head_id.clone();
    let mut messages = ctx.path;
    messages.extend(ctx.summary);
    Ok((
        conv,
        MessageTree {
            messages,
            head_message_id,
            branches,
        },
    ))
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

/// A delegated run as the card on the parent's turn needs it.
///
/// `status` is judged the same way `TurnView`'s is, against the coordinator —
/// but against the *sub-agent's* conversation, not the parent's. The parent's
/// revision does not move when a child's lease is taken or released, so reusing
/// the parent's reading here would leave a sub-agent that died in a panic
/// spinning on the card for ever.
#[derive(serde::Serialize)]
pub struct SubAgentRunView {
    pub conversation_id: String,
    pub spawned_by_message_id: Option<String>,
    pub spawned_by_call_id: Option<String>,
    pub spawned_turn_id: Option<String>,
    pub agent_kind: Option<String>,
    pub title: Option<String>,
    pub steps: i64,
    /// `None` when the delegating turn's row has gone. The card reads that as
    /// "no longer running" rather than inventing an ending.
    pub status: Option<String>,
}

/// Everything one conversation needs to be drawn, as of one moment.
#[derive(serde::Serialize)]
pub struct ConversationSnapshot {
    pub conversation: db::models::conversation::Conversation,
    pub tree: MessageTree,
    pub turns: Vec<TurnView>,
    pub pending_approvals: Vec<crate::commands::approval::PendingApprovalInfo>,
    /// Empty for every conversation that has never delegated.
    pub sub_agent_runs: Vec<SubAgentRunView>,
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
    let services = app.services();
    let coordinator = services.turns.clone();
    let pool = services.db.clone();

    let mut settled = None;
    for attempt in 0..SNAPSHOT_ATTEMPTS {
        // The children have to be named before the coordinator is read, because
        // each of them is a separate entry in it. Reading them after would leave
        // a sub-agent spawned in the gap judged against a reading that never
        // looked at its conversation.
        let children = children_off_thread(&pool, &conversation_id).await?;
        let mut seen = Vec::with_capacity(children.len() + 1);
        seen.push(coordinator.observe(&conversation_id));
        seen.extend(children.iter().map(|c| coordinator.observe(c)));

        let read = read_off_thread(&pool, &conversation_id, Live::Holding(&seen)).await?;

        // Two ways this pass can be unusable: something started or stopped in
        // one of the conversations, or the set of conversations itself changed —
        // a run delegated between naming the children and reading them would be
        // judged against no reading at all.
        let same_children = read
            .3
            .iter()
            .map(|r| r.conversation_id.as_str())
            .eq(children.iter().map(String::as_str));
        if same_children && seen.iter().all(|s| coordinator.unchanged_since(s)) {
            settled = Some(read);
            break;
        }
        tracing::debug!(
            conversation_id = %conversation_id,
            attempt,
            "a turn or a sub-agent started or ended mid-snapshot; reading again",
        );
    }

    let (conversation, tree, turns, sub_agent_runs) = match settled {
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
    Ok(ConversationSnapshot {
        conversation,
        tree,
        turns,
        pending_approvals,
        sub_agent_runs,
    })
}

/// How many passes before the snapshot gives up on pinning the coordinator down.
///
/// Occupancy changes once when a turn starts and once when it ends, not per
/// token, so a second pass is already unusual and a fourth means something is
/// hammering this process.
const SNAPSHOT_ATTEMPTS: usize = 4;

type SnapshotRead = (
    db::models::conversation::Conversation,
    MessageTree,
    Vec<TurnView>,
    Vec<SubAgentRunView>,
);

async fn children_off_thread(pool: &db::DbPool, conversation_id: &str) -> Result<Vec<String>, String> {
    let pool = pool.clone();
    let conv_id = conversation_id.to_string();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::sub_agent_conversation_ids(&mut conn, &conv_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn read_off_thread(pool: &db::DbPool, conversation_id: &str, live: Live<'_>) -> Result<SnapshotRead, String> {
    let pool = pool.clone();
    let conv_id = conversation_id.to_string();
    let live = live.owned();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        read_snapshot(&mut conn, &conv_id, &live)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What the coordinator had to say about the conversations being read, or that
/// it would not hold still long enough to say anything.
///
/// Several conversations, not one: a turn and every sub-agent it delegated to
/// occupy separate entries, and a row is only judged against the reading of its
/// own conversation.
#[derive(Clone)]
enum Live<'a> {
    Holding(&'a [crate::turn::Observed]),
    /// It kept moving. No row is called interrupted on this pass.
    Unsettled,
}

/// The same thing, minus the borrow, for crossing into `spawn_blocking`.
#[derive(Clone)]
enum OwnedLive {
    Holding(std::collections::HashMap<String, Option<String>>),
    Unsettled,
}

impl Live<'_> {
    fn owned(&self) -> OwnedLive {
        match self {
            Live::Holding(seen) => OwnedLive::Holding(
                seen.iter()
                    .map(|o| (o.conversation_id().to_string(), o.held().map(str::to_string)))
                    .collect(),
            ),
            Live::Unsettled => OwnedLive::Unsettled,
        }
    }
}

impl OwnedLive {
    /// Whether this row belongs to a turn that stopped without saying so.
    ///
    /// A conversation nobody read is never judged: `Unsettled` means the whole
    /// pass is untrustworthy, and a missing entry means this reader never looked
    /// at that conversation, which is the same thing for the rows in it.
    fn cut_off(&self, turn: &db::models::turn::Turn) -> bool {
        match self {
            OwnedLive::Holding(held) => match held.get(&turn.conversation_id) {
                Some(h) => crate::agent::interrupted::was_cut_off(turn, h.as_deref()),
                None => false,
            },
            OwnedLive::Unsettled => false,
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
fn read_snapshot(conn: &mut db::PooledConn, conversation_id: &str, live: &OwnedLive) -> Result<SnapshotRead, String> {
    conn.transaction::<_, diesel::result::Error, _>(|conn| {
        let (conversation, tree) = read_tree_with_conversation(conn, conversation_id)
            .map_err(|e| diesel::result::Error::QueryBuilderError(e.into()))?;
        let turns = db::ops::turn::list_for_conversation(conn, conversation_id)?
            .into_iter()
            .map(|t| TurnView {
                status: effective_status(&t, live),
                id: t.id,
                phase: t.phase,
                phase_tool: t.phase_tool,
                error: t.error,
                started_at: t.started_at,
                ended_at: t.ended_at,
            })
            .collect();
        let sub_agent_runs = db::ops::conversation::sub_agent_runs(conn, conversation_id)?
            .into_iter()
            .map(|r| SubAgentRunView {
                status: r.turn.as_ref().map(|t| effective_status(t, live)),
                conversation_id: r.conversation_id,
                spawned_by_message_id: r.spawned_by_message_id,
                spawned_by_call_id: r.spawned_by_call_id,
                spawned_turn_id: r.spawned_turn_id,
                agent_kind: r.agent_kind,
                title: r.title,
                steps: r.steps,
            })
            .collect();
        Ok((conversation, tree, turns, sub_agent_runs))
    })
    .map_err(|e| e.to_string())
}

/// What the row says, unless the coordinator says otherwise.
///
/// Kept as the stored string rather than a typed enum so a status written by a
/// later build travels through unrecognised instead of being flattened into
/// something this one happens to know.
fn effective_status(turn: &db::models::turn::Turn, live: &OwnedLive) -> String {
    if live.cut_off(turn) {
        db::models::turn::TurnStatus::Interrupted.as_str().to_string()
    } else {
        turn.status.clone()
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
pub async fn switch_branch(app: tauri::AppHandle, conversation_id: String, message_id: String) -> Result<(), String> {
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&conversation_id, "a branch switch")
        .map_err(|busy| busy.to_string())?;
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::switch_branch(&mut conn, &conversation_id, &message_id)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
pub async fn delete_message(app: tauri::AppHandle, conversation_id: String, id: String) -> Result<(), String> {
    let services = app.services();
    let _lease = services
        .turns
        .clone()
        .try_acquire_mutation(&conversation_id, "a delete")
        .map_err(|busy| busy.to_string())?;
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::delete_subtree(&mut conn, &conversation_id, &id)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rate_message(app: tauri::AppHandle, id: String, rating: Option<i32>) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::message::update_rating(&mut conn, &id, rating).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What an export may contain: turns somebody took.
///
/// Injected background sits on the active path like everything else, but nobody
/// said it. It has to come off here rather than further down, because
/// `msg_to_openai` ends in a catch-all arm that writes any unrecognised role
/// straight out — so a memory block would become a training example, carrying
/// `<owner_notes>`, which exist on the understanding that they are never even
/// quoted back to the person they are about.
fn exportable(path: Vec<Message>) -> Vec<Message> {
    path.into_iter().filter(|m| m.role != "context").collect()
}

#[tauri::command]
pub async fn export_conversation(
    app: tauri::AppHandle,
    conversation_id: String,
    format: String,
    output_path: Option<String>,
) -> Result<String, String> {
    let services = app.services();
    let pool = services.db.clone();
    let result: String = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let conv = db::ops::conversation::get_conversation(&mut conn, &conversation_id).map_err(|e| e.to_string())?;
        let history = db::ops::message::list_messages(&mut conn, &conversation_id).map_err(|e| e.to_string())?;
        // The active path only. Exporting every branch would interleave rival
        // answers to the same question into one transcript, and the DPO pairing
        // below walks backwards for a prompt — across a fork it would pick up a
        // question that belongs to a different branch.
        //
        // Unlike the chat path this keeps everything from the root, compacted or
        // not: a summary is a token-budget device, and the rows it stands in for
        // are exactly the training data being exported.
        let ctx = db::ops::message::active_context(&history, conv.head_message_id.as_deref());
        let messages: Vec<Message> = exportable(ctx.path);
        let system_prompt = conv
            .assistant_id
            .as_deref()
            .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok())
            .map(|a| a.system_prompt)
            .unwrap_or_default();

        fn msg_to_openai(m: &Message, _all_msgs: &[Message]) -> serde_json::Value {
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
                            if let Ok(tcs) = serde_json::from_str::<Vec<serde_json::Value>>(tc_json)
                                && !tcs.is_empty()
                            {
                                obj["tool_calls"] = serde_json::json!(tcs);
                            }
                        } else {
                            let tool_calls = extract_tool_calls_from_blocks(tc_json);
                            if !tool_calls.is_empty() {
                                obj["tool_calls"] = serde_json::json!(
                                    tool_calls
                                        .iter()
                                        .map(|tc| serde_json::json!({
                                            "id": tc.id, "type": "function",
                                            "function": { "name": tc.name, "arguments": tc.arguments }
                                        }))
                                        .collect::<Vec<_>>()
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
                serde_json::to_string(&serde_json::json!({"messages": openai_msgs})).map_err(|e| e.to_string())
            }
            "dpo" => {
                let mut lines = Vec::new();
                // Build context prefix (system + user messages up to each rated assistant msg)
                for (i, m) in messages.iter().enumerate() {
                    if m.role != "assistant" || m.rating.is_none() {
                        continue;
                    }
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
                let result: Vec<String> = lines
                    .iter()
                    .map(|l| serde_json::to_string(l).unwrap_or_default())
                    .collect();
                Ok(result.join("\n"))
            }
            _ => Err(format!("Unknown export format: {format}")),
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(ref path) = output_path {
        std::fs::write(path, &result).map_err(|e| e.to_string())?;
    }
    Ok(result)
}

#[tauri::command]
pub async fn upload_file(
    app: tauri::AppHandle,
    conversation_id: String,
    file_path: String,
) -> Result<serde_json::Value, String> {
    let services = app.services();
    let app_data_dir = services.paths.data_dir.clone();

    // Android: handle content:// URIs from SAF file picker
    #[cfg(target_os = "android")]
    if file_path.starts_with("content://") {
        let stat = crate::android_bridge::content_stat(&file_path).await?;
        let original_name = stat.name.unwrap_or_else(|| "file".to_string());
        let ext = original_name
            .rsplit('.')
            .next()
            .filter(|e| e.len() <= 10 && !e.contains('/'))
            .unwrap_or("bin");
        let (dest_path, uri) = crate::files::alloc_dest(&app_data_dir, &conversation_id, ext)?;
        crate::android_bridge::content_copy(&file_path, dest_path.to_str().ok_or("invalid path")?).await?;
        let mime = stat.mime.unwrap_or_else(|| {
            mime_guess::from_path(&original_name)
                .first_or_octet_stream()
                .to_string()
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
        crate::db::ops::conversation::create_conversation(&mut conn, "c1", Some("t"), None, None, 1).unwrap();
    }

    fn exported_row(role: &str, content: &str) -> Message {
        Message {
            id: role.into(),
            conversation_id: "c1".into(),
            role: role.into(),
            content: content.into(),
            provider_id: None,
            model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: None,
            sort_order: 0,
            created_at: 0,
            reasoning_content: None,
            rating: None,
            schema_version: 2,
            is_compact_summary: 0,
            sender_id: None,
            parent_id: None,
            compact_anchor_id: None,
            source: None,
            turn_id: None,
            tool_outcome: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            provider_name: None,
        }
    }

    /// An export is training data. Injected background is not a turn anybody
    /// took, and it carries `<owner_notes>` — the one thing in the whole memory
    /// system that is never meant to be repeated anywhere.
    #[test]
    fn injected_background_is_not_exported() {
        let path = vec![
            exported_row("user", "hi"),
            exported_row("context", "<owner_notes>\n- [general] 他在找工作\n</owner_notes>"),
            exported_row("assistant", "hello"),
        ];

        let kept = exportable(path);
        assert_eq!(kept.len(), 2);
        assert!(kept.iter().all(|m| !m.content.contains("找工作")));
        assert!(kept.iter().all(|m| m.role != "context"));
    }

    /// One conversation's reading, in the shape the snapshot carries several of.
    fn holding(conversation_id: &str, held: Option<&str>) -> OwnedLive {
        OwnedLive::Holding(
            [(conversation_id.to_string(), held.map(str::to_string))]
                .into_iter()
                .collect(),
        )
    }

    fn snapshot(pool: &crate::db::DbPool, held: Option<&str>) -> Vec<TurnView> {
        let mut conn = pool.get().unwrap();
        read_snapshot(&mut conn, "c1", &holding("c1", held)).unwrap().2
    }

    /// When the coordinator will not hold still, nothing is called interrupted.
    /// A crash that really happened is still on record at the next open; a live
    /// turn labelled as crashed is a lie the user reads now.
    fn unsettled(pool: &crate::db::DbPool) -> Vec<TurnView> {
        let mut conn = pool.get().unwrap();
        read_snapshot(&mut conn, "c1", &OwnedLive::Unsettled).unwrap().2
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
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
            turn::set_phase(&mut conn, "t1", TurnPhase::RunningTool, Some("edit_file"), 1001).unwrap();
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
            turn::begin(&mut conn, "dead", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
            turn::begin(&mut conn, "live", "c1", TurnOrigin::Desktop, None, 2000).unwrap();
        }

        let turns = snapshot(&pool, Some("live"));
        assert_eq!(
            turns.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(),
            ["interrupted", "running"]
        );
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
                turn::begin(&mut conn, id, "c1", TurnOrigin::Desktop, None, 1000).unwrap();
                turn::finish(&mut conn, id, status, error, 1500).unwrap();
            }
        }

        let turns = snapshot(&pool, None);
        assert_eq!(
            turns.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(),
            ["done", "cancelled", "failed"]
        );
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
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
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
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
            turn::begin(&mut conn, "t2", "c1", TurnOrigin::Desktop, None, 2000).unwrap();
            turn::finish(&mut conn, "t2", TurnStatus::Done, None, 2500).unwrap();
        }

        // Believed, `t1` reads as interrupted.
        assert_eq!(snapshot(&pool, None)[0].status, "interrupted");
        // Unsettled, it reads as what the row says and nothing is invented.
        let turns = unsettled(&pool);
        assert_eq!(
            turns.iter().map(|t| t.status.as_str()).collect::<Vec<_>>(),
            ["running", "done"]
        );
    }

    /// One read, one state: the turns are the turns of the tree that came back
    /// with them, and the head names a row that is in it.
    #[test]
    fn the_tree_and_the_turns_describe_the_same_conversation() {
        let pool = test_db();
        seed(&pool);
        {
            let mut conn = pool.get().unwrap();
            turn::begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, None, 1000).unwrap();
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
                    cache_read_tokens: None,
                    cache_write_tokens: None,
                    provider_name: None,
                },
                None,
            )
            .unwrap();
        }

        let mut conn = pool.get().unwrap();
        let (conv, tree, turns, runs) = read_snapshot(&mut conn, "c1", &holding("c1", Some("t1"))).unwrap();

        assert_eq!(conv.id, "c1");
        assert_eq!(tree.messages.len(), 1);
        assert_eq!(tree.messages[0].turn_id.as_deref(), Some("t1"));
        assert_eq!(tree.head_message_id.as_deref(), Some(tree.messages[0].id.as_str()));
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].id, "t1");
        assert!(runs.is_empty(), "a conversation that never delegated has no runs");
    }

    /// A sub-agent occupies its own conversation, so the parent's revision does
    /// not move when its lease is taken or dropped. Judging the child's row
    /// against the parent's reading would leave a run that died in a panic
    /// spinning on the card for ever.
    #[test]
    fn a_child_that_stopped_without_saying_so_is_judged_against_its_own_conversation() {
        let pool = crate::db::test_db();
        seed(&pool);
        let mut conn = pool.get().unwrap();

        crate::db::ops::conversation::insert(
            &mut conn,
            crate::db::models::conversation::NewConversation {
                id: "child",
                title: Some("look it up"),
                created_at: 10,
                updated_at: 10,
                parent_conversation_id: Some("c1"),
                spawned_by_message_id: Some("m1"),
                spawned_by_call_id: Some("0"),
                spawned_turn_id: Some("t-child"),
                agent_kind: Some("explore"),
                ..Default::default()
            },
        )
        .unwrap();
        crate::db::ops::turn::begin(&mut conn, "t-child", "child", TurnOrigin::SubAgent, None, 10).unwrap();

        // The parent is being read while it holds its own turn. Nobody holds the
        // child's, so the child's `running` row is a run that stopped.
        let live = OwnedLive::Holding(
            [("c1".to_string(), Some("t1".to_string())), ("child".to_string(), None)]
                .into_iter()
                .collect(),
        );
        let runs = read_snapshot(&mut conn, "c1", &live).unwrap().3;
        assert_eq!(runs[0].status.as_deref(), Some("interrupted"));

        // Still held: still running.
        let live = OwnedLive::Holding(
            [
                ("c1".to_string(), None),
                ("child".to_string(), Some("t-child".to_string())),
            ]
            .into_iter()
            .collect(),
        );
        let runs = read_snapshot(&mut conn, "c1", &live).unwrap().3;
        assert_eq!(runs[0].status.as_deref(), Some("running"));

        // And when the coordinator would not hold still, no run is accused.
        let runs = read_snapshot(&mut conn, "c1", &OwnedLive::Unsettled).unwrap().3;
        assert_eq!(runs[0].status.as_deref(), Some("running"));
    }
}
