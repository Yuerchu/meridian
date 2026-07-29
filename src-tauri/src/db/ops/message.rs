use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::message::{Message, NewMessage};
use crate::db::schema::{conversations, messages};

/// Append a message to the end of a conversation's active path.
///
/// The single write path for conversation messages. It links the new row to
/// `parent` and moves the conversation's head onto it, in one transaction, so a
/// row can never exist without being reachable from the head.
///
/// `parent` is the caller's own cursor for the turn rather than a re-read of the
/// head: two turns writing the same conversation concurrently should end up as
/// two branches, not interleaved into one nonsensical thread. Whichever finishes
/// last owns the head, and the other stays reachable as a sibling.
pub fn append_message(
    conn: &mut SqliteConnection,
    new: &NewMessage,
    parent: Option<&str>,
) -> QueryResult<Message> {
    conn.transaction(|conn| {
        let row = insert_message(conn, &NewMessage { parent_id: parent, ..copy_of(new) })?;
        diesel::update(conversations::table.find(new.conversation_id))
            .set(conversations::head_message_id.eq(Some(&row.id)))
            .execute(conn)?;
        Ok(row)
    })
}

/// Where the active path currently ends.
///
/// Falls back to the highest `sort_order` row when the stored head is missing or
/// dangling. That row is necessarily a leaf: any child of it would have been
/// inserted afterwards and so carry a larger `sort_order`, contradicting it being
/// the maximum. So the fallback always names a legitimate tip, which is what lets
/// a dropped head write cost an alternative branch rather than the transcript.
///
/// `history` is the caller's already-loaded message list for the conversation,
/// ordered by `sort_order`.
pub fn resolve_head(stored_head: Option<&str>, history: &[Message]) -> Option<String> {
    if let Some(head) = stored_head {
        if history.iter().any(|m| m.id == head && m.is_compact_summary == 0) {
            return Some(head.to_string());
        }
    }
    history
        .iter()
        .filter(|m| m.is_compact_summary == 0)
        .next_back()
        .map(|m| m.id.clone())
}

/// Everything a turn needs to rebuild its context, resolved once.
///
/// Existed as three separate lookups threaded through
/// `build_messages_with_senders`, which meant four call sites each had to
/// remember to pair a message list with the matching cursor. Bundling them makes
/// the pairing impossible to get wrong, and gives the front end the split point
/// without recomputing it from sort_order.
pub struct ActiveContext {
    /// Root to head, in order. Excludes summaries and inactive branches.
    pub path: Vec<Message>,
    /// The summary standing in front of `path`, when one applies.
    pub summary: Option<Message>,
    /// Where `summary` takes over: everything before this index is represented
    /// by it. `None` when no summary applies.
    pub anchor_index: Option<usize>,
    pub head_id: Option<String>,
}

impl ActiveContext {
    /// The messages a request actually carries: the tail from the anchor on,
    /// since anything before it is covered by the summary.
    pub fn live(&self) -> &[Message] {
        match self.anchor_index {
            Some(i) => &self.path[i..],
            None => &self.path,
        }
    }
}

/// Walk the tree from `head` back to a root, then reverse.
///
/// Done in Rust rather than a recursive CTE because the whole conversation is
/// already loaded: reading a path through SQL would mean giving `Message` a
/// `QueryableByName` impl and hand-writing every column's type, which is pure
/// upkeep. The visited set guards against a cycle, which no writer can produce
/// but corrupted data could.
fn path_to_head(history: &[Message], head: &str) -> Vec<Message> {
    let by_id: std::collections::HashMap<&str, &Message> = history
        .iter()
        .filter(|m| m.is_compact_summary == 0)
        .map(|m| (m.id.as_str(), m))
        .collect();

    let mut seen = std::collections::HashSet::new();
    let mut reversed = Vec::new();
    let mut cursor = Some(head);
    while let Some(id) = cursor {
        if !seen.insert(id) {
            tracing::error!("cycle in message tree at {id}; truncating the path here");
            break;
        }
        let Some(m) = by_id.get(id) else { break };
        reversed.push((*m).clone());
        cursor = m.parent_id.as_deref();
    }
    reversed.reverse();
    reversed
}

/// Load the active path plus whichever summary applies to it.
///
/// `history` is the full conversation, ordered by `sort_order`.
pub fn active_context(
    history: &[Message],
    stored_head: Option<&str>,
) -> ActiveContext {
    let head_id = resolve_head(stored_head, history);
    let mut path = match head_id.as_deref() {
        Some(head) => path_to_head(history, head),
        None => Vec::new(),
    };

    // Safety net for a conversation the backfill never reached: with no
    // parent_id anywhere, the path would be just the head and the rest of the
    // transcript would vanish from the UI. sort_order still describes it, so use
    // that instead.
    //
    // Deliberately narrow. A partially linked tree is left alone: the missing
    // link could equally be a message someone deleted from the middle, and
    // splicing across that gap would invent a conversation that never happened.
    // Temporary — remove once no unlinked conversation can still be out there.
    let conversation: Vec<&Message> = history.iter().filter(|m| m.is_compact_summary == 0).collect();
    let unlinked = conversation.len() > 1 && conversation.iter().all(|m| m.parent_id.is_none());
    if unlinked {
        tracing::warn!(
            "conversation has {} messages and no parent links; falling back to sort_order",
            conversation.len(),
        );
        path = conversation.into_iter().cloned().collect();
    }

    // A summary applies only if its anchor is on this path — that is what stops
    // one branch from being handed another branch's summary. With several, the
    // deepest anchor wins, being the most recent compaction of this path.
    let mut best: Option<(usize, &Message)> = None;
    for s in history.iter().filter(|m| m.is_compact_summary == 1) {
        let Some(anchor) = s.compact_anchor_id.as_deref() else { continue };
        if let Some(idx) = path.iter().position(|m| m.id == anchor) {
            if best.is_none_or(|(prev, _)| idx > prev) {
                best = Some((idx, s));
            }
        }
    }

    ActiveContext {
        path,
        summary: best.map(|(_, s)| s.clone()),
        anchor_index: best.map(|(i, _)| i),
        head_id,
    }
}

/// `NewMessage` holds borrows, so it cannot derive Clone without tying the copy
/// to the original's lifetime. Rebuilding it field by field keeps `append_message`
/// able to override `parent_id` without forcing every caller to pass it.
fn copy_of<'a>(n: &NewMessage<'a>) -> NewMessage<'a> {
    NewMessage {
        id: n.id,
        conversation_id: n.conversation_id,
        role: n.role,
        content: n.content,
        provider_id: n.provider_id,
        model_id: n.model_id,
        input_tokens: n.input_tokens,
        output_tokens: n.output_tokens,
        tool_calls: n.tool_calls,
        tool_call_id: n.tool_call_id,
        sort_order: n.sort_order,
        created_at: n.created_at,
        reasoning_content: n.reasoning_content,
        rating: n.rating,
        schema_version: n.schema_version,
        is_compact_summary: n.is_compact_summary,
        sender_id: n.sender_id,
        parent_id: n.parent_id,
        compact_anchor_id: n.compact_anchor_id,
    }
}

pub fn list_messages(
    conn: &mut SqliteConnection,
    conversation_id: &str,
) -> QueryResult<Vec<Message>> {
    messages::table
        .filter(messages::conversation_id.eq(conversation_id))
        .order(messages::sort_order.asc())
        .load::<Message>(conn)
}

pub fn insert_message(
    conn: &mut SqliteConnection,
    new: &NewMessage,
) -> QueryResult<Message> {
    diesel::insert_into(messages::table)
        .values(new)
        .execute(conn)?;
    messages::table.find(new.id).first::<Message>(conn)
}

pub fn update_content(
    conn: &mut SqliteConnection,
    id: &str,
    content: &str,
) -> QueryResult<()> {
    diesel::update(messages::table.find(id))
        .set(messages::content.eq(content))
        .execute(conn)?;
    Ok(())
}

pub fn update_content_and_tool_calls(
    conn: &mut SqliteConnection,
    id: &str,
    content: &str,
    tool_calls: Option<&str>,
) -> QueryResult<()> {
    diesel::update(messages::table.find(id))
        .set((
            messages::content.eq(content),
            messages::tool_calls.eq(tool_calls),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn update_assistant_message(
    conn: &mut SqliteConnection,
    id: &str,
    content: &str,
    reasoning_content: Option<&str>,
    tool_calls: Option<&str>,
    input_tokens: Option<i32>,
    output_tokens: Option<i32>,
) -> QueryResult<()> {
    diesel::update(messages::table.find(id))
        .set((
            messages::content.eq(content),
            messages::reasoning_content.eq(reasoning_content),
            messages::tool_calls.eq(tool_calls),
            messages::input_tokens.eq(input_tokens),
            messages::output_tokens.eq(output_tokens),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn update_tokens(
    conn: &mut SqliteConnection,
    id: &str,
    input_tokens: Option<i32>,
    output_tokens: Option<i32>,
) -> QueryResult<()> {
    diesel::update(messages::table.find(id))
        .set((
            messages::input_tokens.eq(input_tokens),
            messages::output_tokens.eq(output_tokens),
        ))
        .execute(conn)?;
    Ok(())
}

pub fn update_rating(
    conn: &mut SqliteConnection,
    id: &str,
    rating: Option<i32>,
) -> QueryResult<()> {
    diesel::update(messages::table.find(id))
        .set(messages::rating.eq(rating))
        .execute(conn)?;
    Ok(())
}

pub fn delete_message(
    conn: &mut SqliteConnection,
    id: &str,
) -> QueryResult<()> {
    diesel::delete(messages::table.find(id)).execute(conn)?;
    Ok(())
}

pub fn delete_compact_summaries(
    conn: &mut SqliteConnection,
    conversation_id: &str,
) -> QueryResult<()> {
    diesel::delete(
        messages::table
            .filter(messages::conversation_id.eq(conversation_id))
            .filter(messages::is_compact_summary.eq(1)),
    )
    .execute(conn)?;
    Ok(())
}

/// Drop the summaries belonging to one path, leaving other branches' alone.
///
/// Compacting used to clear every summary in the conversation, which is right
/// while a conversation is a single line and wrong the moment it is not: the
/// branch being compacted would take the other branches' summaries with it, and
/// switching back would re-summarise from scratch.
pub fn delete_summaries_anchored_in(
    conn: &mut SqliteConnection,
    conversation_id: &str,
    path_ids: &[String],
) -> QueryResult<()> {
    if path_ids.is_empty() {
        return Ok(());
    }
    diesel::delete(
        messages::table
            .filter(messages::conversation_id.eq(conversation_id))
            .filter(messages::is_compact_summary.eq(1))
            .filter(messages::compact_anchor_id.eq_any(path_ids)),
    )
    .execute(conn)?;
    Ok(())
}

pub fn count_messages(
    conn: &mut SqliteConnection,
    conversation_id: &str,
) -> QueryResult<i64> {
    messages::table
        .filter(messages::conversation_id.eq(conversation_id))
        .count()
        .get_result(conn)
}

pub fn delete_messages_from(
    conn: &mut SqliteConnection,
    conversation_id: &str,
    from_sort_order: i32,
) -> QueryResult<()> {
    diesel::delete(
        messages::table
            .filter(messages::conversation_id.eq(conversation_id))
            .filter(messages::sort_order.ge(from_sort_order)),
    )
    .execute(conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ops::conversation::{create_conversation, get_conversation};
    use crate::db::test_db;

    fn row<'a>(id: &'a str, conv: &'a str, role: &'a str) -> NewMessage<'a> {
        NewMessage {
            id,
            conversation_id: conv,
            role,
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
        }
    }

    #[test]
    fn append_links_each_row_to_the_last_and_moves_the_head() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();

        let a = append_message(&mut conn, &row("a", "c1", "user"), None).unwrap();
        let b = append_message(&mut conn, &row("b", "c1", "assistant"), Some(&a.id)).unwrap();
        let c = append_message(&mut conn, &row("c", "c1", "tool"), Some(&b.id)).unwrap();

        assert_eq!(a.parent_id, None, "the first message is a root");
        assert_eq!(b.parent_id.as_deref(), Some("a"));
        assert_eq!(c.parent_id.as_deref(), Some("b"));

        let conv = get_conversation(&mut conn, "c1").unwrap();
        assert_eq!(conv.head_message_id.as_deref(), Some("c"));
    }

    /// Two answers to the same question are siblings, and the head follows
    /// whichever was written last.
    #[test]
    fn a_second_child_forks_the_branch() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();

        let q = append_message(&mut conn, &row("q", "c1", "user"), None).unwrap();
        append_message(&mut conn, &row("a1", "c1", "assistant"), Some(&q.id)).unwrap();
        let second = append_message(&mut conn, &row("a2", "c1", "assistant"), Some(&q.id)).unwrap();

        assert_eq!(second.parent_id.as_deref(), Some("q"));
        let conv = get_conversation(&mut conn, "c1").unwrap();
        assert_eq!(conv.head_message_id.as_deref(), Some("a2"));
    }

    #[test]
    fn resolve_head_prefers_the_stored_head() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        let q = append_message(&mut conn, &row("q", "c1", "user"), None).unwrap();
        append_message(&mut conn, &row("a1", "c1", "assistant"), Some(&q.id)).unwrap();
        append_message(&mut conn, &row("a2", "c1", "assistant"), Some(&q.id)).unwrap();

        let history = list_messages(&mut conn, "c1").unwrap();
        // a1 is not the newest row, so only the stored head can name it.
        assert_eq!(resolve_head(Some("a1"), &history).as_deref(), Some("a1"));
    }

    /// A dangling head must not strand the transcript. The newest row is always
    /// a leaf, since a child of it would have been inserted later still.
    #[test]
    fn resolve_head_falls_back_to_the_newest_row() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        let a = append_message(&mut conn, &row("a", "c1", "user"), None).unwrap();
        append_message(&mut conn, &row("b", "c1", "assistant"), Some(&a.id)).unwrap();

        let history = list_messages(&mut conn, "c1").unwrap();
        assert_eq!(resolve_head(None, &history).as_deref(), Some("b"));
        assert_eq!(resolve_head(Some("gone"), &history).as_deref(), Some("b"));

        let leaf_children = history.iter().filter(|m| m.parent_id.as_deref() == Some("b")).count();
        assert_eq!(leaf_children, 0, "the fallback must name a leaf");
    }

    /// A summary sits beside the tree. Letting it answer "where does the path
    /// end" would hang the next turn off something that is not conversation.
    #[test]
    fn resolve_head_ignores_compaction_summaries() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        let a = append_message(&mut conn, &row("a", "c1", "user"), None).unwrap();
        append_message(&mut conn, &row("b", "c1", "assistant"), Some(&a.id)).unwrap();

        let mut summary = row("s", "c1", "user");
        summary.is_compact_summary = 1;
        summary.sort_order = -1;
        insert_message(&mut conn, &summary).unwrap();

        let history = list_messages(&mut conn, "c1").unwrap();
        assert_eq!(resolve_head(Some("s"), &history).as_deref(), Some("b"));
        assert_eq!(resolve_head(None, &history).as_deref(), Some("b"));
    }

    #[test]
    fn resolve_head_is_none_for_an_empty_conversation() {
        assert_eq!(resolve_head(None, &[]), None);
        assert_eq!(resolve_head(Some("ghost"), &[]), None);
    }

    /// Builds a tree directly, bypassing append_message, so a shape the writers
    /// cannot currently produce can still be tested.
    fn tree(conn: &mut SqliteConnection, edges: &[(&str, Option<&str>)]) {
        for (id, parent) in edges {
            let mut n = row(id, "c1", "user");
            n.parent_id = *parent;
            insert_message(conn, &n).unwrap();
        }
    }

    fn ids(ctx: &ActiveContext) -> Vec<&str> {
        ctx.path.iter().map(|m| m.id.as_str()).collect()
    }

    #[test]
    fn active_context_follows_one_branch_and_ignores_the_other() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        tree(&mut conn, &[
            ("q", None),
            ("a1", Some("q")),
            ("a1x", Some("a1")),
            ("a2", Some("q")),
            ("a2x", Some("a2")),
        ]);
        let history = list_messages(&mut conn, "c1").unwrap();

        assert_eq!(ids(&active_context(&history, Some("a1x"))), ["q", "a1", "a1x"]);
        assert_eq!(ids(&active_context(&history, Some("a2x"))), ["q", "a2", "a2x"]);
    }

    #[test]
    fn active_context_is_empty_for_a_conversation_with_no_messages() {
        let ctx = active_context(&[], None);
        assert!(ctx.path.is_empty());
        assert_eq!(ctx.head_id, None);
        assert_eq!(ctx.anchor_index, None);
    }

    /// A corrupt parent link must not spin forever.
    #[test]
    fn active_context_stops_on_a_cycle() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        tree(&mut conn, &[("a", None), ("b", Some("a"))]);
        diesel::update(messages::table.find("a"))
            .set(messages::parent_id.eq(Some("b")))
            .execute(&mut conn)
            .unwrap();
        let history = list_messages(&mut conn, "c1").unwrap();

        let ctx = active_context(&history, Some("b"));
        assert!(ctx.path.len() <= 2, "a cycle must terminate, got {:?}", ids(&ctx));
    }

    #[test]
    fn a_summary_anchored_on_the_path_takes_effect() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        tree(&mut conn, &[("m1", None), ("m2", Some("m1")), ("m3", Some("m2"))]);

        let mut s = row("s", "c1", "user");
        s.is_compact_summary = 1;
        s.sort_order = -1;
        s.compact_anchor_id = Some("m2");
        insert_message(&mut conn, &s).unwrap();
        let history = list_messages(&mut conn, "c1").unwrap();

        let ctx = active_context(&history, Some("m3"));
        assert_eq!(ctx.anchor_index, Some(1));
        assert_eq!(ctx.summary.as_ref().map(|m| m.id.as_str()), Some("s"));
        // m1 is represented by the summary, so it is not sent again.
        assert_eq!(ctx.live().iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["m2", "m3"]);
    }

    /// The whole point of anchoring: switching branches must not hand this one
    /// a summary of a history it never had.
    #[test]
    fn a_summary_anchored_off_the_path_is_ignored() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        tree(&mut conn, &[("q", None), ("a1", Some("q")), ("a2", Some("q"))]);

        let mut s = row("s", "c1", "user");
        s.is_compact_summary = 1;
        s.sort_order = -1;
        s.compact_anchor_id = Some("a1");
        insert_message(&mut conn, &s).unwrap();
        let history = list_messages(&mut conn, "c1").unwrap();

        let ctx = active_context(&history, Some("a2"));
        assert!(ctx.summary.is_none());
        assert_eq!(ctx.anchor_index, None);
        assert_eq!(ctx.live().len(), 2);
    }

    #[test]
    fn the_deepest_anchored_summary_wins() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        tree(&mut conn, &[("m1", None), ("m2", Some("m1")), ("m3", Some("m2"))]);

        for (id, anchor) in [("s1", "m1"), ("s2", "m3")] {
            let mut s = row(id, "c1", "user");
            s.is_compact_summary = 1;
            s.sort_order = -1;
            s.compact_anchor_id = Some(anchor);
            insert_message(&mut conn, &s).unwrap();
        }
        let history = list_messages(&mut conn, "c1").unwrap();

        let ctx = active_context(&history, Some("m3"));
        assert_eq!(ctx.summary.as_ref().map(|m| m.id.as_str()), Some("s2"));
        assert_eq!(ctx.anchor_index, Some(2));
    }

    /// A conversation the backfill never reached has no links at all. Serving
    /// only the head would make the rest of the transcript disappear.
    #[test]
    fn a_wholly_unlinked_history_falls_back_to_sort_order() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        tree(&mut conn, &[("m1", None), ("m2", None), ("m3", None)]);
        let history = list_messages(&mut conn, "c1").unwrap();

        assert_eq!(ids(&active_context(&history, Some("m3"))), ["m1", "m2", "m3"]);
    }

    /// A gap in the middle is not the same thing: it is what deleting a message
    /// leaves behind, and bridging it would invent a conversation that never
    /// happened.
    #[test]
    fn a_partially_linked_history_is_not_bridged() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        tree(&mut conn, &[("m1", None), ("m2", None), ("m3", Some("m2"))]);
        let history = list_messages(&mut conn, "c1").unwrap();

        assert_eq!(ids(&active_context(&history, Some("m3"))), ["m2", "m3"]);
    }

    /// The guarantee this whole change rests on: for a conversation that has
    /// never branched — every conversation that exists today — reading the tree
    /// gives back exactly what ordering by sort_order gave.
    #[test]
    fn a_linear_conversation_reads_back_identically() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();

        let mut parent: Option<String> = None;
        for i in 0..12 {
            let id = format!("m{i}");
            let role = if i % 2 == 0 { "user" } else { "assistant" };
            let written = append_message(&mut conn, &row(&id, "c1", role), parent.as_deref()).unwrap();
            parent = Some(written.id);
        }

        let history = list_messages(&mut conn, "c1").unwrap();
        let by_sort_order: Vec<&str> = history.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids(&active_context(&history, None)), by_sort_order);
    }

    /// Flattening a real fork would splice two branches into one transcript.
    #[test]
    fn a_forked_history_is_never_flattened() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        tree(&mut conn, &[("q", None), ("a1", Some("q")), ("a2", Some("q"))]);
        let history = list_messages(&mut conn, "c1").unwrap();

        assert_eq!(ids(&active_context(&history, Some("a2"))), ["q", "a2"]);
    }
}
