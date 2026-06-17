use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::emoji::{Emoji, NewEmoji};
use crate::db::schema::emojis;

pub fn list_by_pack(conn: &mut SqliteConnection, pack_id: &str) -> QueryResult<Vec<Emoji>> {
    emojis::table
        .filter(emojis::pack_id.eq(pack_id))
        .order(emojis::sort_order.asc())
        .load::<Emoji>(conn)
}

pub fn get_emoji(conn: &mut SqliteConnection, id: &str) -> QueryResult<Emoji> {
    emojis::table.find(id).first::<Emoji>(conn)
}

pub fn create_emoji(conn: &mut SqliteConnection, new: &NewEmoji) -> QueryResult<Emoji> {
    diesel::insert_into(emojis::table)
        .values(new)
        .execute(conn)?;
    emojis::table.find(new.id).first::<Emoji>(conn)
}

pub fn rename_emoji(conn: &mut SqliteConnection, id: &str, new_name: &str) -> QueryResult<Emoji> {
    diesel::update(emojis::table.find(id))
        .set(emojis::name.eq(new_name))
        .execute(conn)?;
    emojis::table.find(id).first::<Emoji>(conn)
}

pub fn delete_emoji(conn: &mut SqliteConnection, id: &str) -> QueryResult<()> {
    diesel::delete(emojis::table.find(id)).execute(conn)?;
    Ok(())
}

pub fn search_emojis(conn: &mut SqliteConnection, query: &str) -> QueryResult<Vec<Emoji>> {
    let pattern = format!("%{query}%");
    emojis::table
        .filter(
            emojis::name.like(&pattern)
                .or(emojis::tags.like(&pattern)),
        )
        .order(emojis::sort_order.asc())
        .limit(50)
        .load::<Emoji>(conn)
}

pub fn list_emojis_for_packs(
    conn: &mut SqliteConnection,
    pack_ids: &[String],
) -> QueryResult<Vec<Emoji>> {
    emojis::table
        .filter(emojis::pack_id.eq_any(pack_ids))
        .order((emojis::pack_id.asc(), emojis::sort_order.asc()))
        .load::<Emoji>(conn)
}

pub fn count_by_pack(conn: &mut SqliteConnection, pack_id: &str) -> QueryResult<i64> {
    use diesel::dsl::count_star;
    emojis::table
        .filter(emojis::pack_id.eq(pack_id))
        .select(count_star())
        .first(conn)
}
