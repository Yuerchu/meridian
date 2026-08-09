//! The durable half of a turn.
//!
//! A turn runs on the stack of the task driving it, and everything about it —
//! the cancellation token, the approvals waiting on a human — lives in memory.
//! That is fine while the process is alive and useless the moment it is not.
//! These rows are what remains: a turn says what it is about to do *before*
//! doing it, so whatever the last phase says is where it died.
//!
//! Nothing here is written from a destructor. Destructors do not run for a
//! kill, which is the case that matters, so the design leans the other way: a
//! row left at `running` is itself the record that the turn never reached its
//! own ending, and `reconcile_interrupted` says so at the next launch.

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::turn::{NewTurn, Turn, TurnPhase, TurnStatus};
use crate::db::schema::turns;
use crate::turn::TurnOrigin;

/// Record a turn that is starting. Called once the conversation has actually
/// been taken, so a refused turn leaves nothing behind.
pub fn begin(
    conn: &mut SqliteConnection,
    id: &str,
    conversation_id: &str,
    origin: TurnOrigin,
    now: i64,
) -> QueryResult<usize> {
    diesel::insert_into(turns::table)
        .values(&NewTurn {
            id,
            conversation_id,
            origin: origin.as_str(),
            status: TurnStatus::Running.as_str(),
            phase: Some(TurnPhase::Streaming.as_str()),
            started_at: now,
            updated_at: now,
        })
        .execute(conn)
}

/// Say what the turn is about to do. Must be committed *before* the thing it
/// names, or the window it was meant to cover is still uncovered.
///
/// `tool` names the call `phase` refers to, and is cleared when it does not.
pub fn set_phase(
    conn: &mut SqliteConnection,
    id: &str,
    phase: TurnPhase,
    tool: Option<&str>,
    now: i64,
) -> QueryResult<usize> {
    diesel::update(running(id))
        .set((
            turns::phase.eq(phase.as_str()),
            turns::phase_tool.eq(tool),
            turns::updated_at.eq(now),
        ))
        .execute(conn)
}

/// Close a turn out. Only the paths that actually reach an ending call this —
/// everything else is left for `reconcile_interrupted`.
pub fn finish(
    conn: &mut SqliteConnection,
    id: &str,
    status: TurnStatus,
    error: Option<&str>,
    now: i64,
) -> QueryResult<usize> {
    diesel::update(running(id))
        .set((
            turns::status.eq(status.as_str()),
            turns::error.eq(error),
            turns::ended_at.eq(Some(now)),
            turns::updated_at.eq(now),
        ))
        .execute(conn)
}

/// A turn only while it is still running.
///
/// Every write goes through this, so the lifecycle is one-way at the SQL level
/// rather than by call-order discipline. Two things it rules out: a phase write
/// that lands after the turn ended, which would leave a finished row claiming
/// to be inside a tool; and a second `finish`, which would overwrite a terminal
/// state with a later opinion. The second is reachable today — the desktop turn
/// records `done` and *then* emits its stop event, and a failed emit sends the
/// caller down the failure path.
fn running(id: &str) -> diesel::helper_types::Filter<
    diesel::helper_types::Find<turns::table, &str>,
    diesel::dsl::Eq<turns::status, &'static str>,
> {
    turns::table.find(id).filter(turns::status.eq(TurnStatus::Running.as_str()))
}

/// The most recent turn of a conversation. What decides whether the next
/// request has to tell the model that the last one was cut off.
///
/// Written here with the rest of the table's vocabulary; the caller that reads
/// it arrives with that block.
#[allow(dead_code)]
pub fn latest_for_conversation(
    conn: &mut SqliteConnection,
    conversation_id: &str,
) -> QueryResult<Option<Turn>> {
    turns::table
        .filter(turns::conversation_id.eq(conversation_id))
        .order((turns::started_at.desc(), insertion_order().desc()))
        .first::<Turn>(conn)
        .optional()
}

/// Tie-break for turns that started in the same millisecond.
///
/// One conversation's turns are strictly sequential — the coordinator sees to
/// that — but a turn refused by its provider can begin and end inside a
/// millisecond, so two of them sharing a `started_at` is reachable. `id` cannot
/// break the tie: it is a uuid, and its ordering has nothing to do with when
/// the row was written. SQLite's rowid does, being assigned on insert, and
/// "which turn was really last" is the whole question `latest_for_conversation`
/// is asked.
fn insertion_order() -> diesel::expression::SqlLiteral<diesel::sql_types::BigInt> {
    diesel::dsl::sql::<diesel::sql_types::BigInt>("rowid")
}

/// Every turn of a conversation, oldest first. For the transcript snapshot,
/// which is what lets the UI say which turn was cut off rather than guessing.
#[allow(dead_code)]
pub fn list_for_conversation(
    conn: &mut SqliteConnection,
    conversation_id: &str,
) -> QueryResult<Vec<Turn>> {
    turns::table
        .filter(turns::conversation_id.eq(conversation_id))
        .order((turns::started_at.asc(), insertion_order().asc()))
        .load::<Turn>(conn)
}

/// Mark every turn still recorded as running as interrupted, and report how
/// many there were.
///
/// Sound because a turn only ever runs inside the process that wrote its row:
/// there is no scheduler, no worker pool, nothing that could still be going.
/// So a `running` row seen at startup is not a turn in progress, it is a turn
/// that was killed — and `phase` is the last thing it admitted to doing.
///
/// The one case this does not cover is two copies of the app sharing a
/// database, where one would declare the other's live turns dead. That is
/// already impossible for other reasons (the OneBot listener binds a port, MCP
/// servers are spawned as children) and is not designed for.
pub fn reconcile_interrupted(conn: &mut SqliteConnection, now: i64) -> QueryResult<usize> {
    diesel::update(turns::table.filter(turns::status.eq(TurnStatus::Running.as_str())))
        .set((
            turns::status.eq(TurnStatus::Interrupted.as_str()),
            turns::ended_at.eq(Some(now)),
            turns::updated_at.eq(now),
        ))
        .execute(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ops::conversation::create_conversation;
    use crate::db::test_db;

    fn conv(conn: &mut SqliteConnection, id: &str) {
        create_conversation(conn, id, Some("t"), None, None, 1000).unwrap();
    }

    fn get(conn: &mut SqliteConnection, id: &str) -> Turn {
        turns::table.find(id).first::<Turn>(conn).unwrap()
    }

    #[test]
    fn a_turn_starts_running_and_streaming() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");

        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();

        let t = get(&mut conn, "t1");
        assert_eq!(t.status(), Some(TurnStatus::Running));
        assert_eq!(t.phase(), Some(TurnPhase::Streaming));
        assert_eq!(t.origin, "desktop");
        assert!(t.ended_at.is_none());
    }

    /// The phase is the diagnosis, so it has to track what the turn is really
    /// doing — including going back to streaming once a tool returns.
    #[test]
    fn the_phase_follows_the_turn() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();

        set_phase(&mut conn, "t1", TurnPhase::AwaitingApproval, Some("run_command"), 1001).unwrap();
        let t = get(&mut conn, "t1");
        assert_eq!(t.phase(), Some(TurnPhase::AwaitingApproval));
        assert_eq!(t.phase_tool.as_deref(), Some("run_command"));

        set_phase(&mut conn, "t1", TurnPhase::RunningTool, Some("run_command"), 1002).unwrap();
        assert_eq!(get(&mut conn, "t1").phase(), Some(TurnPhase::RunningTool));

        // Back to the model, and the tool is no longer what it is doing.
        set_phase(&mut conn, "t1", TurnPhase::Streaming, None, 1003).unwrap();
        let t = get(&mut conn, "t1");
        assert_eq!(t.phase(), Some(TurnPhase::Streaming));
        assert!(t.phase_tool.is_none(), "a phase that names no tool must not keep the last one");
    }

    /// The whole point. A turn that was killed left its row at `running` with
    /// the phase it died in; startup turns that into a diagnosis without losing
    /// the phase.
    #[test]
    fn a_turn_left_running_is_interrupted_at_the_next_launch() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        set_phase(&mut conn, "t1", TurnPhase::RunningTool, Some("edit_file"), 1001).unwrap();

        assert_eq!(reconcile_interrupted(&mut conn, 2000).unwrap(), 1);

        let t = get(&mut conn, "t1");
        assert_eq!(t.status(), Some(TurnStatus::Interrupted));
        assert_eq!(t.ended_at, Some(2000));
        assert_eq!(
            t.phase(),
            Some(TurnPhase::RunningTool),
            "the phase is the diagnosis; reconciliation must not erase it",
        );
        assert_eq!(t.phase_tool.as_deref(), Some("edit_file"));
    }

    #[test]
    fn reconciliation_leaves_finished_turns_alone() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        for (id, status) in [
            ("done", TurnStatus::Done),
            ("cancelled", TurnStatus::Cancelled),
            ("failed", TurnStatus::Failed),
        ] {
            begin(&mut conn, id, "c1", TurnOrigin::Desktop, 1000).unwrap();
            finish(&mut conn, id, status, None, 1500).unwrap();
        }
        begin(&mut conn, "live", "c1", TurnOrigin::OneBot, 1000).unwrap();

        assert_eq!(reconcile_interrupted(&mut conn, 2000).unwrap(), 1);

        assert_eq!(get(&mut conn, "done").status(), Some(TurnStatus::Done));
        assert_eq!(get(&mut conn, "cancelled").status(), Some(TurnStatus::Cancelled));
        assert_eq!(get(&mut conn, "failed").status(), Some(TurnStatus::Failed));
        assert_eq!(get(&mut conn, "live").status(), Some(TurnStatus::Interrupted));
        // Nothing to do the second time.
        assert_eq!(reconcile_interrupted(&mut conn, 2001).unwrap(), 0);
    }

    #[test]
    fn a_failed_turn_keeps_what_went_wrong() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();

        finish(&mut conn, "t1", TurnStatus::Failed, Some("API Key not set"), 1500).unwrap();

        let t = get(&mut conn, "t1");
        assert_eq!(t.status(), Some(TurnStatus::Failed));
        assert_eq!(t.error.as_deref(), Some("API Key not set"));
    }

    #[test]
    fn the_latest_turn_is_the_one_that_started_last() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        conv(&mut conn, "c2");
        begin(&mut conn, "old", "c1", TurnOrigin::Desktop, 1000).unwrap();
        begin(&mut conn, "new", "c1", TurnOrigin::Desktop, 2000).unwrap();
        begin(&mut conn, "other", "c2", TurnOrigin::Desktop, 3000).unwrap();

        assert_eq!(latest_for_conversation(&mut conn, "c1").unwrap().unwrap().id, "new");
        assert_eq!(latest_for_conversation(&mut conn, "c2").unwrap().unwrap().id, "other");
        assert!(latest_for_conversation(&mut conn, "nope").unwrap().is_none());

        let all: Vec<String> = list_for_conversation(&mut conn, "c1")
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(all, vec!["old", "new"]);
    }

    /// Turns belong to their conversation and go with it.
    #[test]
    fn deleting_a_conversation_takes_its_turns() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();

        crate::db::ops::conversation::delete_conversation(&mut conn, "c1").unwrap();

        assert!(list_for_conversation(&mut conn, "c1").unwrap().is_empty());
    }

    /// The lifecycle is one-way, enforced in SQL rather than by call order.
    /// A phase write that lands after the turn ended would leave a finished row
    /// claiming to be inside a tool — and "inside a tool" is the reading that
    /// says side effects may have happened.
    #[test]
    fn a_finished_turn_no_longer_moves() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        finish(&mut conn, "t1", TurnStatus::Done, None, 1500).unwrap();
        let ended = get(&mut conn, "t1");

        assert_eq!(
            set_phase(&mut conn, "t1", TurnPhase::RunningTool, Some("edit_file"), 2000).unwrap(),
            0,
            "a late phase write must find nothing to update",
        );

        let after = get(&mut conn, "t1");
        assert_eq!(after.phase, ended.phase);
        assert_eq!(after.phase_tool, ended.phase_tool);
        assert_eq!(after.updated_at, ended.updated_at);
    }

    /// A second ending cannot overwrite the first. Reachable today: the desktop
    /// records `done` and *then* emits its stop event, and an emit that fails
    /// sends the caller down the failure path with the same turn id.
    #[test]
    fn a_turn_cannot_end_twice() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        finish(&mut conn, "t1", TurnStatus::Done, None, 1500).unwrap();

        assert_eq!(
            finish(&mut conn, "t1", TurnStatus::Failed, Some("too late"), 2000).unwrap(),
            0,
        );

        let t = get(&mut conn, "t1");
        assert_eq!(t.status(), Some(TurnStatus::Done));
        assert_eq!(t.ended_at, Some(1500));
        assert!(t.error.is_none());
    }

    /// A turn cut short by the loop guard did not complete, and its record must
    /// not say it did — the stop event on the same turn says `loop_detected`.
    #[test]
    fn a_turn_the_loop_guard_stopped_is_not_recorded_as_done() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();

        finish(
            &mut conn,
            "t1",
            TurnStatus::Failed,
            Some(crate::db::models::turn::ERROR_LOOP_DETECTED),
            1500,
        )
        .unwrap();

        let t = get(&mut conn, "t1");
        assert_eq!(t.status(), Some(TurnStatus::Failed));
        assert_eq!(t.error.as_deref(), Some("loop_detected"));
    }

    /// A turn refused by its provider can start and finish inside the same
    /// millisecond, so `started_at` alone does not say which of two turns came
    /// last — and a uuid primary key cannot break the tie, because its order
    /// has nothing to do with when it was written. Insertion order does.
    #[test]
    fn turns_from_the_same_millisecond_still_have_an_order() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        // Ids chosen so that ordering by `id` would put them the wrong way
        // round: "aaa" sorts before "zzz" but was written second.
        begin(&mut conn, "zzz-first", "c1", TurnOrigin::Desktop, 1000).unwrap();
        begin(&mut conn, "aaa-second", "c1", TurnOrigin::Desktop, 1000).unwrap();

        assert_eq!(
            latest_for_conversation(&mut conn, "c1").unwrap().unwrap().id,
            "aaa-second",
            "the latest turn is the one written last, not the one sorting last",
        );
        let all: Vec<String> = list_for_conversation(&mut conn, "c1")
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(all, vec!["zzz-first", "aaa-second"]);
    }

    /// The desktop's turn ids arrive from the front end, so a replayed one is
    /// reachable without anything being malicious — a retry, a double
    /// dispatch. It must not be able to reopen a turn that has already ended:
    /// the insert conflicts, but everything after it is an update by primary
    /// key and would rewrite that turn's ending while the new turn's messages
    /// filed themselves under it.
    #[test]
    fn a_second_turn_cannot_claim_an_id_that_is_already_on_record() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        set_phase(&mut conn, "t1", TurnPhase::RunningTool, Some("edit_file"), 1001).unwrap();
        finish(&mut conn, "t1", TurnStatus::Done, None, 1500).unwrap();

        let replayed = begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 2000);

        assert!(
            matches!(
                replayed,
                Err(diesel::result::Error::DatabaseError(
                    diesel::result::DatabaseErrorKind::UniqueViolation,
                    _
                ))
            ),
            "a replayed id must be refused by the database, not merged into the old row",
        );
        // And the finished turn is exactly as it was.
        let t = get(&mut conn, "t1");
        assert_eq!(t.status(), Some(TurnStatus::Done));
        assert_eq!(t.started_at, 1000);
        assert_eq!(t.ended_at, Some(1500));
        assert_eq!(list_for_conversation(&mut conn, "c1").unwrap().len(), 1);
    }

    /// A status this build does not know reads as "no opinion" rather than
    /// making the conversation unreadable — the same rule the collaboration
    /// mode follows.
    #[test]
    fn an_unknown_status_does_not_poison_the_row() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        conv(&mut conn, "c1");
        begin(&mut conn, "t1", "c1", TurnOrigin::Desktop, 1000).unwrap();
        diesel::update(turns::table.find("t1"))
            .set(turns::status.eq("from_the_future"))
            .execute(&mut conn)
            .unwrap();

        let t = get(&mut conn, "t1");
        assert_eq!(t.status(), None);
        // And it is not swept up as if it were running.
        assert_eq!(reconcile_interrupted(&mut conn, 2000).unwrap(), 0);
    }
}
