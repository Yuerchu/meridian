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
}
