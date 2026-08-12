use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::conversation::{Conversation, NewConversation, SubAgentRun};
use crate::db::models::turn::Turn;
use crate::db::schema::conversations;

/// The user's own conversations, newest first.
///
/// Sub-agent transcripts are excluded here rather than by archiving them: the
/// archive flag is a user's decision and can be undone, and the project view
/// deliberately concatenates archived rows onto active ones, which would spill
/// them back into the list. Being spawned is not a decision anyone can reverse.
pub fn list_conversations(
    conn: &mut SqliteConnection,
    archived: bool,
) -> QueryResult<Vec<Conversation>> {
    let archived_val = if archived { 1 } else { 0 };
    conversations::table
        .filter(conversations::is_archived.eq(archived_val))
        .filter(conversations::parent_conversation_id.is_null())
        .order((conversations::is_pinned.desc(), conversations::updated_at.desc()))
        .load::<Conversation>(conn)
}

pub fn get_conversation(
    conn: &mut SqliteConnection,
    id: &str,
) -> QueryResult<Conversation> {
    conversations::table.find(id).first::<Conversation>(conn)
}

pub fn create_conversation(
    conn: &mut SqliteConnection,
    id: &str,
    title: Option<&str>,
    assistant_id: Option<&str>,
    project_id: Option<&str>,
    now: i64,
) -> QueryResult<Conversation> {
    let new = NewConversation {
        id,
        title,
        assistant_id,
        is_pinned: 0,
        is_archived: 0,
        created_at: now,
        updated_at: now,
        project_id,
        ..Default::default()
    };
    insert(conn, new)
}

/// Insert a prepared row. Split out so a sub-agent can fill the spawned-by
/// columns without `create_conversation` growing seven more parameters that
/// every ordinary caller would pass `None` to.
pub fn insert(
    conn: &mut SqliteConnection,
    new: NewConversation<'_>,
) -> QueryResult<Conversation> {
    let id = new.id.to_string();
    diesel::insert_into(conversations::table)
        .values(&new)
        .execute(conn)?;
    conversations::table.find(&id).first::<Conversation>(conn)
}

pub fn list_conversations_by_project(
    conn: &mut SqliteConnection,
    project_id: &str,
    archived: bool,
) -> QueryResult<Vec<Conversation>> {
    let archived_val = if archived { 1 } else { 0 };
    conversations::table
        .filter(conversations::project_id.eq(project_id))
        .filter(conversations::is_archived.eq(archived_val))
        .filter(conversations::parent_conversation_id.is_null())
        .order((conversations::is_pinned.desc(), conversations::updated_at.desc()))
        .load::<Conversation>(conn)
}

pub fn update_title(
    conn: &mut SqliteConnection,
    id: &str,
    title: &str,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::title.eq(title),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn update_assistant(
    conn: &mut SqliteConnection,
    id: &str,
    assistant_id: Option<&str>,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::assistant_id.eq(assistant_id),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn toggle_pin(
    conn: &mut SqliteConnection,
    id: &str,
    now: i64,
) -> QueryResult<Conversation> {
    let conv = conversations::table.find(id).first::<Conversation>(conn)?;
    let new_pinned = if conv.is_pinned == 0 { 1 } else { 0 };
    diesel::update(conversations::table.find(id))
        .set((
            conversations::is_pinned.eq(new_pinned),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    conversations::table.find(id).first::<Conversation>(conn)
}

pub fn archive_conversation(
    conn: &mut SqliteConnection,
    id: &str,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::is_archived.eq(1),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn update_compact_cursor(
    conn: &mut SqliteConnection,
    id: &str,
    cursor: Option<i32>,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::compact_cursor.eq(cursor),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

/// Persist the per-conversation reasoning preferences. `thinking_level` of
/// `None` means "inherit the assistant default".
pub fn update_reasoning_prefs(
    conn: &mut SqliteConnection,
    id: &str,
    thinking_level: Option<&str>,
    fast_mode: bool,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::thinking_level.eq(thinking_level),
            conversations::fast_mode.eq(i32::from(fast_mode)),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

/// Persist the collaboration mode. `None` means the default (work) mode.
///
/// Deliberately its own setter rather than another parameter on
/// `update_reasoning_prefs`: that one already writes two fields at once, which
/// forces every caller to pass the current value of the other. A third field
/// would make all three callers depend on each other.
pub fn update_mode(
    conn: &mut SqliteConnection,
    id: &str,
    mode: Option<&str>,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((conversations::mode.eq(mode), conversations::updated_at.eq(now)))
        .execute(conn)?;
    Ok(())
}

/// Its own setter for the same reason as `update_mode`, and kept apart from it
/// for a second one: a mode narrows what the assistant can do, this widens what
/// it can do without asking. Writing both through one call would suggest they
/// are two settings of the same kind.
pub fn update_accept_edits(
    conn: &mut SqliteConnection,
    id: &str,
    accept_edits: bool,
    now: i64,
) -> QueryResult<()> {
    diesel::update(conversations::table.find(id))
        .set((
            conversations::accept_edits.eq(i32::from(accept_edits)),
            conversations::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}

/// The conversations spawned by this one, oldest first.
///
/// Ordered by creation so that a caller comparing two readings of this list can
/// compare them element by element, and so leases are always taken in the same
/// order.
pub fn sub_agent_conversation_ids(
    conn: &mut SqliteConnection,
    parent_id: &str,
) -> QueryResult<Vec<String>> {
    conversations::table
        .filter(conversations::parent_conversation_id.eq(parent_id))
        .order(conversations::created_at.asc())
        .select(conversations::id)
        .load::<String>(conn)
}

/// Every delegated run this conversation started, for the cards that report on
/// them.
///
/// The turn each one carries is the one named by `spawned_turn_id`, never the
/// conversation's latest. A sub-agent's transcript stays writable after the run
/// ends, so "latest" would let a follow-up chat decide what the parent's card
/// says about a run that finished long ago.
pub fn sub_agent_runs(
    conn: &mut SqliteConnection,
    parent_id: &str,
) -> QueryResult<Vec<SubAgentRun>> {
    use crate::db::schema::{messages, turns};

    let rows: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> =
        conversations::table
            .filter(conversations::parent_conversation_id.eq(parent_id))
            .order(conversations::created_at.asc())
            .select((
                conversations::id,
                conversations::spawned_by_message_id,
                conversations::spawned_by_call_id,
                conversations::spawned_turn_id,
                conversations::agent_kind,
                conversations::title,
            ))
            .load(conn)?;

    let turn_ids: Vec<String> = rows.iter().filter_map(|r| r.3.clone()).collect();

    // Assistant rows, not every row and not tool calls: the loop writes one
    // assistant row per iteration, so this counts how many times the model was
    // asked. Tool rows and steering rows would inflate it, and a round that
    // called three tools is still one step.
    let counts: Vec<(Option<String>, i64)> = messages::table
        .filter(messages::turn_id.eq_any(&turn_ids))
        .filter(messages::role.eq("assistant"))
        .group_by(messages::turn_id)
        .select((messages::turn_id, diesel::dsl::count_star()))
        .load(conn)?;

    let turns: Vec<Turn> = turns::table
        .filter(turns::id.eq_any(&turn_ids))
        .select(Turn::as_select())
        .load(conn)?;

    Ok(rows
        .into_iter()
        .map(|(conversation_id, message_id, call_id, turn_id, agent_kind, title)| {
            let steps = turn_id
                .as_ref()
                .and_then(|id| {
                    counts.iter().find(|(t, _)| t.as_deref() == Some(id.as_str())).map(|(_, n)| *n)
                })
                .unwrap_or(0);
            let turn = turn_id
                .as_ref()
                .and_then(|id| turns.iter().find(|t| &t.id == id).cloned());
            SubAgentRun {
                conversation_id,
                spawned_by_message_id: message_id,
                spawned_by_call_id: call_id,
                spawned_turn_id: turn_id,
                agent_kind,
                title,
                steps,
                turn,
            }
        })
        .collect())
}

pub fn delete_conversation(
    conn: &mut SqliteConnection,
    id: &str,
) -> QueryResult<()> {
    diesel::delete(conversations::table.find(id)).execute(conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    /// Migrations are plain SQL and Diesel does not check them at compile time,
    /// so this is the only place a broken ALTER TABLE surfaces before runtime.
    #[test]
    fn migrations_apply_and_reasoning_prefs_round_trip() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();

        let conv = create_conversation(&mut conn, "c1", Some("t"), None, None, 1).unwrap();
        assert_eq!(conv.thinking_level, None, "defaults to inheriting the assistant");
        assert_eq!(conv.fast_mode, 0);

        update_reasoning_prefs(&mut conn, "c1", Some("xhigh"), true, 2).unwrap();
        let conv = get_conversation(&mut conn, "c1").unwrap();
        assert_eq!(conv.thinking_level.as_deref(), Some("xhigh"));
        assert_eq!(conv.fast_mode, 1);

        // Clearing back to the assistant default must be expressible.
        update_reasoning_prefs(&mut conn, "c1", None, false, 3).unwrap();
        let conv = get_conversation(&mut conn, "c1").unwrap();
        assert_eq!(conv.thinking_level, None);
        assert_eq!(conv.fast_mode, 0);
    }

    /// Everything a delegated run needs in the database, written the way
    /// `commands::sub_agent` will write it.
    fn spawn(
        conn: &mut SqliteConnection,
        id: &str,
        parent: &str,
        message_id: &str,
        call_id: &str,
        turn_id: &str,
    ) {
        // The project is inherited, the way `commands::sub_agent` will inherit
        // it: tools resolve their paths through it.
        let project_id = conversations::table
            .find(parent)
            .select(conversations::project_id)
            .first::<Option<String>>(conn)
            .unwrap();
        insert(
            conn,
            NewConversation {
                id,
                title: Some("look something up"),
                is_pinned: 0,
                is_archived: 0,
                created_at: 10,
                updated_at: 10,
                project_id: project_id.as_deref(),
                parent_conversation_id: Some(parent),
                spawned_by_message_id: Some(message_id),
                spawned_by_call_id: Some(call_id),
                spawned_turn_id: Some(turn_id),
                agent_kind: Some("explore"),
                ..Default::default()
            },
        )
        .unwrap();
        crate::db::ops::turn::begin(conn, turn_id, id, crate::turn::TurnOrigin::SubAgent, 10)
            .unwrap();
    }

    fn assistant_row(conn: &mut SqliteConnection, id: &str, conv: &str, turn_id: &str) {
        use crate::db::models::message::NewMessage;
        crate::db::ops::message::append_message(
            conn,
            &NewMessage {
                id,
                conversation_id: conv,
                role: "assistant",
                content: "",
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
                turn_id: Some(turn_id),
                tool_outcome: None,
                cache_read_tokens: None,
                cache_write_tokens: None,
                provider_name: None,
            },
            None,
        )
        .unwrap();
    }

    /// A sub-agent's transcript is reachable only through the card on the turn
    /// that spawned it. Listing it beside the user's own conversations would
    /// turn one delegated errand into a second entry they never started.
    #[test]
    fn a_delegated_conversation_stays_out_of_the_lists() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        crate::db::ops::project::create_project(
            &mut conn,
            &crate::db::models::project::NewProject {
                id: "p1",
                name: "P",
                path: None,
                source_type: "local",
                source_id: None,
                assistant_id: None,
                description: None,
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
        create_conversation(&mut conn, "parent", Some("t"), None, Some("p1"), 1).unwrap();
        spawn(&mut conn, "child", "parent", "m1", "0", "t-child");

        let all = list_conversations(&mut conn, false).unwrap();
        assert_eq!(all.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["parent"]);

        // The project view concatenates archived onto active, so it needs the
        // same filter rather than relying on the archive flag.
        let by_project = list_conversations_by_project(&mut conn, "p1", false).unwrap();
        assert_eq!(by_project.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["parent"]);

        let runs = sub_agent_runs(&mut conn, "parent").unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].conversation_id, "child");
        assert_eq!(runs[0].agent_kind.as_deref(), Some("explore"));
    }

    /// The reason the message id is stored alongside the call id. A gateway that
    /// numbers per request answers `"0"` for the first tool call of every
    /// response, so delegating twice in one conversation produces two runs whose
    /// call ids are equal and whose cards are not.
    #[test]
    fn two_runs_with_the_same_call_id_stay_apart() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "parent", Some("t"), None, None, 1).unwrap();
        spawn(&mut conn, "first", "parent", "m1", "0", "t-first");
        spawn(&mut conn, "second", "parent", "m2", "0", "t-second");

        let runs = sub_agent_runs(&mut conn, "parent").unwrap();
        let ids: Vec<_> = runs
            .iter()
            .map(|r| {
                (
                    r.spawned_by_message_id.as_deref().unwrap(),
                    r.spawned_by_call_id.as_deref().unwrap(),
                    r.conversation_id.as_str(),
                )
            })
            .collect();
        assert_eq!(ids, [("m1", "0", "first"), ("m2", "0", "second")]);
    }

    /// The card reports on the run, not on whatever the user did in that
    /// transcript afterwards. Reading the conversation's latest turn instead
    /// would let a follow-up question days later decide what a finished run
    /// looks like.
    #[test]
    fn the_card_reads_the_delegated_turn_and_not_the_latest_one() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "parent", Some("t"), None, None, 1).unwrap();
        spawn(&mut conn, "child", "parent", "m1", "0", "t-run");
        crate::db::ops::turn::finish(
            &mut conn,
            "t-run",
            crate::db::models::turn::TurnStatus::Done,
            None,
            20,
        )
        .unwrap();

        // The user opens the sub-agent's transcript and keeps talking. That is a
        // desktop turn in the same conversation, and it is still running.
        crate::db::ops::turn::begin(
            &mut conn,
            "t-followup",
            "child",
            crate::turn::TurnOrigin::Desktop,
            30,
        )
        .unwrap();

        let runs = sub_agent_runs(&mut conn, "parent").unwrap();
        assert_eq!(runs[0].spawned_turn_id.as_deref(), Some("t-run"));
        assert_eq!(runs[0].turn.as_ref().unwrap().status, "done");
    }

    /// Steps are assistant iterations: how many times the model was asked. Tool
    /// rows answer calls rather than making them, and a round that called three
    /// tools is still one step.
    #[test]
    fn steps_count_assistant_iterations_of_the_delegated_turn() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "parent", Some("t"), None, None, 1).unwrap();
        spawn(&mut conn, "child", "parent", "m1", "0", "t-run");

        assistant_row(&mut conn, "a1", "child", "t-run");
        assistant_row(&mut conn, "a2", "child", "t-run");
        // A follow-up chat in the same conversation, under a different turn.
        assistant_row(&mut conn, "a3", "child", "t-followup");

        assert_eq!(sub_agent_runs(&mut conn, "parent").unwrap()[0].steps, 2);
    }

    /// Rows written before this migration have every new column empty, and go on
    /// behaving exactly as they did.
    #[test]
    fn conversations_that_predate_delegation_are_ordinary() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let conv = create_conversation(&mut conn, "c1", Some("t"), None, None, 1).unwrap();

        assert!(conv.parent_conversation_id.is_none());
        assert!(conv.spawned_by_message_id.is_none());
        assert!(conv.spawned_by_call_id.is_none());
        assert!(conv.spawned_turn_id.is_none());
        assert!(conv.agent_kind.is_none());
        assert!(conv.agent_provider_id.is_none());
        assert!(conv.agent_model_id.is_none(), "it goes on resolving from the assistant");
        assert_eq!(list_conversations(&mut conn, false).unwrap().len(), 1);
    }
}
