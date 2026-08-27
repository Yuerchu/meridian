//! Appending to and reading the file journal's version chains.
//!
//! The one writer, `append_version`, owns the chain invariant: for `seq > 1`,
//! `observed_old_sha` equals the previous version's `new_sha`. It holds by
//! construction — when the caller's observation disagrees with the chain head,
//! an `op = 'external'` version is inserted *first*, carrying the change nobody
//! here made and naming no conversation. That ordering is the "never
//! misattribute" rule made mechanical: the unexplained delta lands on
//! `external`, and only the delta the caller actually performed lands on the
//! caller's turn.
//!
//! Everything runs inside `immediate_transaction`: the head is read and the
//! next `seq` chosen under the write lock, so two conversations appending to
//! one file serialise instead of racing the unique `(file_id, seq)` index.

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::journal::{JournalFile, JournalVersion, NewJournalBlob, NewJournalFile, NewJournalVersion};
use crate::db::schema::{journal_blobs, journal_files, journal_versions};
use crate::journal::blobs::StoredBlob;

/// Who did it, copied onto the row at write time.
#[derive(Debug, Clone, Default)]
pub struct Attribution<'a> {
    pub source: &'a str,
    pub conversation_id: Option<&'a str>,
    pub turn_id: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub model_id: Option<&'a str>,
    pub tool_name: Option<&'a str>,
}

/// One observed transition, ready to append. Blobs are already on disk —
/// "bytes before rows" — and `StoredBlob` is the receipt.
#[derive(Debug)]
pub struct AppendVersion<'a> {
    /// The canonical OS spelling, for display; the matching key is derived.
    pub display_path: &'a str,
    pub op: &'a str,
    /// What the writer saw before acting; `None` = the file did not exist.
    pub observed_old: Option<&'a StoredBlob>,
    /// What it left behind; `None` = deleted.
    pub new: Option<&'a StoredBlob>,
    pub attribution: Attribution<'a>,
    /// For `rename_to`: the chain the content came from.
    pub moved_from_file_id: Option<&'a str>,
    pub now: i64,
}

#[derive(Debug, PartialEq)]
pub struct AppendOutcome {
    pub file_id: String,
    pub seq: i64,
    /// Whether an `external` version was interposed because the observation
    /// disagreed with the chain head.
    pub external_inserted: bool,
}

pub fn append_version(conn: &mut SqliteConnection, norm_path: &str, v: &AppendVersion) -> QueryResult<AppendOutcome> {
    conn.immediate_transaction(|conn| {
        for blob in [v.observed_old, v.new].into_iter().flatten() {
            ensure_blob(conn, blob, v.now)?;
        }

        let file = ensure_file(conn, norm_path, v.display_path, v.now)?;
        let head = head_version(conn, &file.id)?;

        let observed = v.observed_old.map(|b| b.sha256.as_str());
        let mut seq = head.as_ref().map(|h| h.seq + 1).unwrap_or(1);
        let mut external_inserted = false;

        if let Some(head) = &head
            && head.new_sha.as_deref() != observed
        {
            // The chain head is not what the writer found: someone changed the
            // file outside every capture path. That change gets its own
            // version, attributed to nobody — inserting it *before* the real
            // row is what keeps the real row's delta exactly the delta its
            // conversation performed.
            let external = NewJournalVersion {
                id: &uuid::Uuid::new_v4().to_string(),
                file_id: &file.id,
                seq,
                op: crate::db::models::journal::version_op::EXTERNAL,
                observed_old_sha: head.new_sha.as_deref(),
                new_sha: observed,
                source: crate::db::models::journal::version_source::EXTERNAL,
                conversation_id: None,
                turn_id: None,
                origin: None,
                model_id: None,
                tool_name: None,
                moved_from_file_id: None,
                created_at: v.now,
            };
            diesel::insert_into(journal_versions::table)
                .values(&external)
                .execute(conn)?;
            seq += 1;
            external_inserted = true;
        }

        let row = NewJournalVersion {
            id: &uuid::Uuid::new_v4().to_string(),
            file_id: &file.id,
            seq,
            op: v.op,
            observed_old_sha: observed,
            new_sha: v.new.map(|b| b.sha256.as_str()),
            source: v.attribution.source,
            conversation_id: v.attribution.conversation_id,
            turn_id: v.attribution.turn_id,
            origin: v.attribution.origin,
            model_id: v.attribution.model_id,
            tool_name: v.attribution.tool_name,
            moved_from_file_id: v.moved_from_file_id,
            created_at: v.now,
        };
        diesel::insert_into(journal_versions::table)
            .values(&row)
            .execute(conn)?;

        diesel::update(journal_files::table.find(&file.id))
            .set(journal_files::updated_at.eq(v.now))
            .execute(conn)?;

        Ok(AppendOutcome {
            file_id: file.id,
            seq,
            external_inserted,
        })
    })
}

fn ensure_blob(conn: &mut SqliteConnection, blob: &StoredBlob, now: i64) -> QueryResult<()> {
    diesel::insert_or_ignore_into(journal_blobs::table)
        .values(&NewJournalBlob {
            sha256: &blob.sha256,
            byte_len: blob.byte_len,
            line_count: blob.line_count,
            created_at: now,
        })
        .execute(conn)?;
    Ok(())
}

fn ensure_file(conn: &mut SqliteConnection, norm_path: &str, display_path: &str, now: i64) -> QueryResult<JournalFile> {
    if let Some(existing) = file_by_path(conn, norm_path)? {
        return Ok(existing);
    }
    let row = NewJournalFile {
        id: &uuid::Uuid::new_v4().to_string(),
        norm_path,
        display_path,
        created_at: now,
        updated_at: now,
    };
    diesel::insert_into(journal_files::table).values(&row).execute(conn)?;
    journal_files::table.find(row.id).first(conn)
}

pub fn file_by_path(conn: &mut SqliteConnection, norm_path: &str) -> QueryResult<Option<JournalFile>> {
    journal_files::table
        .filter(journal_files::norm_path.eq(norm_path))
        .select(JournalFile::as_select())
        .first(conn)
        .optional()
}

/// The newest version of a file's chain, if the file has one.
pub fn head_version(conn: &mut SqliteConnection, file_id: &str) -> QueryResult<Option<JournalVersion>> {
    journal_versions::table
        .filter(journal_versions::file_id.eq(file_id))
        .order(journal_versions::seq.desc())
        .select(JournalVersion::as_select())
        .first(conn)
        .optional()
}

/// The whole chain, oldest first — the order blame walks it.
pub fn chain(conn: &mut SqliteConnection, file_id: &str) -> QueryResult<Vec<JournalVersion>> {
    journal_versions::table
        .filter(journal_versions::file_id.eq(file_id))
        .order(journal_versions::seq.asc())
        .select(JournalVersion::as_select())
        .load(conn)
}

/// Files whose normalised path starts with `prefix` and whose chain head says
/// the file still exists, capped. This is the run_command bracket's scan set:
/// files the journal already tracks, and only those — a file it has never seen
/// is left to the external-labelling path rather than guessed at.
pub fn tracked_files(conn: &mut SqliteConnection, prefix: &str, limit: i64) -> QueryResult<Vec<(JournalFile, String)>> {
    let files: Vec<JournalFile> = journal_files::table
        .filter(journal_files::norm_path.like(format!("{}%", like_escape(prefix))))
        .order(journal_files::updated_at.desc())
        .limit(limit)
        .select(JournalFile::as_select())
        .load(conn)?;

    let mut out = Vec::new();
    for file in files {
        if let Some(head) = head_version(conn, &file.id)?
            && let Some(sha) = head.new_sha
        {
            out.push((file, sha));
        }
    }
    Ok(out)
}

/// Everything a turn wrote, for rewind previews and the turn's own summary.
pub fn versions_of_turn(conn: &mut SqliteConnection, turn_id: &str) -> QueryResult<Vec<(JournalFile, JournalVersion)>> {
    journal_versions::table
        .inner_join(journal_files::table)
        .filter(journal_versions::turn_id.eq(turn_id))
        .order((journal_files::norm_path.asc(), journal_versions::seq.asc()))
        .select((JournalFile::as_select(), JournalVersion::as_select()))
        .load(conn)
}

/// Blob shas no version references any more — deletable, rows first, files
/// after (the reverse order would leave rows naming missing bytes).
pub fn unreferenced_blobs(conn: &mut SqliteConnection) -> QueryResult<Vec<String>> {
    diesel::sql_query(
        "SELECT b.sha256 AS sha FROM journal_blobs b
         WHERE NOT EXISTS (
             SELECT 1 FROM journal_versions v
             WHERE v.observed_old_sha = b.sha256 OR v.new_sha = b.sha256
         )",
    )
    .load::<ShaRow>(conn)
    .map(|rows| rows.into_iter().map(|r| r.sha).collect())
}

pub fn delete_blob_rows(conn: &mut SqliteConnection, shas: &[String]) -> QueryResult<usize> {
    diesel::delete(journal_blobs::table.filter(journal_blobs::sha256.eq_any(shas))).execute(conn)
}

#[derive(diesel::QueryableByName)]
struct ShaRow {
    #[diesel(sql_type = diesel::sql_types::Text)]
    sha: String,
}

/// LIKE special characters escaped so a path containing `%` or `_` cannot
/// widen a prefix scan.
fn like_escape(s: &str) -> String {
    s.replace('%', r"\%").replace('_', r"\_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::journal::blobs::StoredBlob;

    fn blob(content: &str) -> StoredBlob {
        StoredBlob {
            sha256: crate::journal::blobs::sha256_of(content),
            byte_len: content.len() as i64,
            line_count: content.lines().count() as i32,
        }
    }

    fn append(
        conn: &mut SqliteConnection,
        path: &str,
        old: Option<&StoredBlob>,
        new: Option<&StoredBlob>,
        conversation: Option<&str>,
        now: i64,
    ) -> AppendOutcome {
        append_version(
            conn,
            path,
            &AppendVersion {
                display_path: path,
                op: "edit",
                observed_old: old,
                new,
                attribution: Attribution {
                    source: "native",
                    conversation_id: conversation,
                    turn_id: conversation.map(|_| "t1"),
                    origin: Some("desktop"),
                    model_id: None,
                    tool_name: Some("edit_file"),
                },
                moved_from_file_id: None,
                now,
            },
        )
        .unwrap()
    }

    #[test]
    fn a_matching_observation_appends_without_an_external_row() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let (a, b) = (blob("v1"), blob("v2"));

        let first = append(&mut conn, "c:/p/a.rs", None, Some(&a), Some("conv"), 1);
        assert_eq!((first.seq, first.external_inserted), (1, false));

        let second = append(&mut conn, "c:/p/a.rs", Some(&a), Some(&b), Some("conv"), 2);
        assert_eq!((second.seq, second.external_inserted), (2, false));
    }

    /// The core discipline: an observation that disagrees with the head makes
    /// an `external` version *first*, attributed to nobody, and the real row
    /// lands after it — so the chain invariant holds and the conversation is
    /// only credited with the delta it performed.
    #[test]
    fn a_mismatched_observation_interposes_an_external_version() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let (a, hand_edit, b) = (blob("v1"), blob("hand-edited"), blob("v2"));

        append(&mut conn, "c:/p/a.rs", None, Some(&a), Some("conv"), 1);
        // The conversation's tool observed `hand_edit`, not `a`: somebody
        // touched the file in between.
        let out = append(&mut conn, "c:/p/a.rs", Some(&hand_edit), Some(&b), Some("conv"), 2);
        assert!(out.external_inserted);
        assert_eq!(out.seq, 3, "external took seq 2, the real row took 3");

        let rows = chain(&mut conn, &out.file_id).unwrap();
        assert_eq!(rows.len(), 3);
        let ext = &rows[1];
        assert_eq!(ext.op, "external");
        assert_eq!(ext.source, "external");
        assert_eq!(ext.conversation_id, None, "external rows name nobody");
        assert_eq!(ext.observed_old_sha.as_deref(), Some(a.sha256.as_str()));
        assert_eq!(ext.new_sha.as_deref(), Some(hand_edit.sha256.as_str()));
        // Chain invariant: every row's observed_old equals its predecessor's new.
        for pair in rows.windows(2) {
            assert_eq!(pair[1].observed_old_sha, pair[0].new_sha);
        }
    }

    /// The CHECK is the second lock on the same door: even a buggy writer
    /// cannot record an external change under a conversation's name.
    #[test]
    fn the_schema_refuses_an_attributed_external_row() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let a = blob("v1");
        let out = append(&mut conn, "c:/p/a.rs", None, Some(&a), Some("conv"), 1);

        let bad = NewJournalVersion {
            id: "bad",
            file_id: &out.file_id,
            seq: 99,
            op: "external",
            observed_old_sha: None,
            new_sha: None,
            source: "external",
            conversation_id: Some("conv"),
            turn_id: None,
            origin: None,
            model_id: None,
            tool_name: None,
            moved_from_file_id: None,
            created_at: 9,
        };
        assert!(
            diesel::insert_into(journal_versions::table)
                .values(&bad)
                .execute(&mut conn)
                .is_err()
        );
    }

    #[test]
    fn deletion_and_recreation_stay_on_one_chain() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let (a, b) = (blob("v1"), blob("v2"));

        append(&mut conn, "c:/p/a.rs", None, Some(&a), Some("conv"), 1);
        let gone = append(&mut conn, "c:/p/a.rs", Some(&a), None, Some("conv"), 2);
        assert!(!gone.external_inserted);
        // Recreated: the writer observed "no file", which matches the head.
        let back = append(&mut conn, "c:/p/a.rs", None, Some(&b), Some("conv"), 3);
        assert!(!back.external_inserted);
        assert_eq!(back.seq, 3);
    }

    /// Two connections appending to one file serialise on BEGIN IMMEDIATE
    /// rather than racing the `(file_id, seq)` unique index.
    #[test]
    fn concurrent_appends_do_not_collide_on_seq() {
        let pool = test_db();
        {
            let mut conn = pool.get().unwrap();
            let a = blob("v1");
            append(&mut conn, "c:/p/a.rs", None, Some(&a), Some("conv"), 1);
        }

        let handles: Vec<_> = (0..2)
            .map(|i| {
                let pool = pool.clone();
                std::thread::spawn(move || {
                    let mut conn = pool.get().unwrap();
                    let a = blob("v1");
                    let next = blob(&format!("writer-{i}"));
                    append(&mut conn, "c:/p/a.rs", Some(&a), Some(&next), Some("conv"), 10 + i)
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let mut conn = pool.get().unwrap();
        let file = file_by_path(&mut conn, "c:/p/a.rs").unwrap().unwrap();
        let rows = chain(&mut conn, &file.id).unwrap();
        let seqs: Vec<i64> = rows.iter().map(|r| r.seq).collect();
        let mut sorted = seqs.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(seqs.len(), sorted.len(), "no duplicate seq: {seqs:?}");
        for pair in rows.windows(2) {
            assert_eq!(pair[1].observed_old_sha, pair[0].new_sha);
        }
    }

    #[test]
    fn tracked_files_reports_only_living_heads_under_the_prefix() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let a = blob("v1");

        append(&mut conn, "c:/p/alive.rs", None, Some(&a), Some("conv"), 1);
        append(&mut conn, "c:/p/dead.rs", None, Some(&a), Some("conv"), 2);
        append(&mut conn, "c:/p/dead.rs", Some(&a), None, Some("conv"), 3);
        append(&mut conn, "c:/elsewhere/other.rs", None, Some(&a), Some("conv"), 4);

        let got = tracked_files(&mut conn, "c:/p/", 100).unwrap();
        let paths: Vec<&str> = got.iter().map(|(f, _)| f.norm_path.as_str()).collect();
        assert_eq!(paths, vec!["c:/p/alive.rs"]);
    }

    #[test]
    fn unreferenced_blobs_spares_everything_a_version_names() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let (a, b) = (blob("v1"), blob("v2"));
        append(&mut conn, "c:/p/a.rs", None, Some(&a), Some("conv"), 1);
        // `b` gets a row but no version referencing it.
        diesel::insert_or_ignore_into(journal_blobs::table)
            .values(&NewJournalBlob {
                sha256: &b.sha256,
                byte_len: b.byte_len,
                line_count: b.line_count,
                created_at: 5,
            })
            .execute(&mut conn)
            .unwrap();

        let orphans = unreferenced_blobs(&mut conn).unwrap();
        assert_eq!(orphans, vec![b.sha256.clone()]);
        assert_eq!(delete_blob_rows(&mut conn, &orphans).unwrap(), 1);
    }
}
