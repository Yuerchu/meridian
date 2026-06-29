use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::message::{Message, NewMessage};
use crate::db::schema::messages;

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
