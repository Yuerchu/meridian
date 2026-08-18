use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::assistant_emoji_pack::NewAssistantEmojiPack;
use crate::db::models::emoji_pack::{EmojiPack, NewEmojiPack};
use crate::db::schema::{assistant_emoji_packs, emoji_packs};

pub fn list_packs(conn: &mut SqliteConnection) -> QueryResult<Vec<EmojiPack>> {
    emoji_packs::table
        .order(emoji_packs::sort_order.asc())
        .load::<EmojiPack>(conn)
}

pub fn get_pack(conn: &mut SqliteConnection, id: &str) -> QueryResult<EmojiPack> {
    emoji_packs::table.find(id).first::<EmojiPack>(conn)
}

pub fn create_pack(conn: &mut SqliteConnection, new: &NewEmojiPack) -> QueryResult<EmojiPack> {
    diesel::insert_into(emoji_packs::table).values(new).execute(conn)?;
    emoji_packs::table.find(new.id).first::<EmojiPack>(conn)
}

pub fn delete_pack(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    diesel::delete(emoji_packs::table.find(id)).execute(conn)?;
    Ok(())
}

pub fn list_packs_for_assistant(conn: &mut SqliteConnection, assistant_id: &str) -> QueryResult<Vec<EmojiPack>> {
    emoji_packs::table
        .inner_join(assistant_emoji_packs::table.on(assistant_emoji_packs::pack_id.eq(emoji_packs::id)))
        .filter(assistant_emoji_packs::assistant_id.eq(assistant_id))
        .select(EmojiPack::as_select())
        .order(emoji_packs::sort_order.asc())
        .load::<EmojiPack>(conn)
}

pub fn assign_pack(conn: &mut SqliteConnection, assistant_id: &str, pack_id: &str, now: i64) -> QueryResult<()> {
    diesel::insert_or_ignore_into(assistant_emoji_packs::table)
        .values(&NewAssistantEmojiPack {
            assistant_id,
            pack_id,
            created_at: now,
        })
        .execute(conn)?;
    Ok(())
}

pub fn unassign_pack(conn: &mut SqliteConnection, assistant_id: &str, pack_id: &str) -> QueryResult<()> {
    diesel::delete(
        assistant_emoji_packs::table
            .filter(assistant_emoji_packs::assistant_id.eq(assistant_id))
            .filter(assistant_emoji_packs::pack_id.eq(pack_id)),
    )
    .execute(conn)?;
    Ok(())
}

pub fn list_assigned_pack_ids(conn: &mut SqliteConnection, assistant_id: &str) -> QueryResult<Vec<String>> {
    assistant_emoji_packs::table
        .filter(assistant_emoji_packs::assistant_id.eq(assistant_id))
        .select(assistant_emoji_packs::pack_id)
        .load::<String>(conn)
}
