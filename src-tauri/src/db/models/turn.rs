use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::turns;

/// How a turn ended, or that it has not.
///
/// `Running` is only ever true of the process that wrote it — a turn lives on
/// the stack of the task driving it and does not survive a restart. So a
/// `Running` row read at startup is not a turn still going; it is a turn that
/// never reached its own ending, and `reconcile_interrupted` says so. That is
/// what lets nothing be written from a destructor: destructors do not run for a
/// kill, and leaving the row alone is already the truthful record.
///
/// `Cancelled` is the user pressing Stop. `Interrupted` is a turn that never
/// reached an ending. The transcript has always shown these as the same thing,
/// and they are not: one is a decision, the other is an accident that may have
/// left work half done.
///
/// Stored, `Interrupted` is only ever written by startup reconciliation, so it
/// does mean the process died. Reported — `conversation_snapshot` substitutes
/// it for a `running` row the coordinator is not holding — it means less than
/// that: a task that panicked or was dropped while the application carried on
/// looks identical. Nothing may read a cause into either.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Running,
    Done,
    Cancelled,
    Failed,
    Interrupted,
}

impl TurnStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TurnStatus::Running => "running",
            TurnStatus::Done => "done",
            TurnStatus::Cancelled => "cancelled",
            TurnStatus::Failed => "failed",
            TurnStatus::Interrupted => "interrupted",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "running" => Ok(TurnStatus::Running),
            "done" => Ok(TurnStatus::Done),
            "cancelled" => Ok(TurnStatus::Cancelled),
            "failed" => Ok(TurnStatus::Failed),
            "interrupted" => Ok(TurnStatus::Interrupted),
            other => Err(format!("unknown turn status '{other}'")),
        }
    }
}

/// A turn cut short because the model kept making the same call.
///
/// A stable token rather than prose: it is matched on, and it goes in the same
/// column as a provider's error text, which is not. The loop guard stopping a
/// turn is a failure to finish, not a finish — recording it as `done` would
/// have the row claim a clean ending for a turn whose own stop event says it
/// was aborted.
pub const ERROR_LOOP_DETECTED: &str = "loop_detected";

/// What a turn was doing when it last said anything.
///
/// Written *before* the thing it names, which is the whole point: whatever is
/// stored when the process dies is where it died. Meaningless once a turn has
/// ended normally.
///
/// `RunningTool` is the one that matters. It means a tool had started — a file
/// may already be written, a command may already have run — and nothing
/// recorded how it went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnPhase {
    Streaming,
    AwaitingApproval,
    RunningTool,
    Compacting,
}

impl TurnPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            TurnPhase::Streaming => "streaming",
            TurnPhase::AwaitingApproval => "awaiting_approval",
            TurnPhase::RunningTool => "running_tool",
            TurnPhase::Compacting => "compacting",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "streaming" => Ok(TurnPhase::Streaming),
            "awaiting_approval" => Ok(TurnPhase::AwaitingApproval),
            "running_tool" => Ok(TurnPhase::RunningTool),
            "compacting" => Ok(TurnPhase::Compacting),
            other => Err(format!("unknown turn phase '{other}'")),
        }
    }
}

/// A turn as stored.
#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = turns)]
pub struct Turn {
    pub id: String,
    pub conversation_id: String,
    pub origin: String,
    pub status: String,
    pub phase: Option<String>,
    pub phase_tool: Option<String>,
    pub error: Option<String>,
    pub started_at: i64,
    pub updated_at: i64,
    pub ended_at: Option<i64>,
    /// When a later turn actually delivered this turn's interruption to the
    /// model. `None` means it still owes the telling — which is not the same as
    /// "this turn is the most recent one", because a turn that dies before
    /// reaching a provider carries nothing and therefore consumes nothing.
    ///
    /// "Delivered" here means delivered to *this turn's own conversation*. A
    /// delegated run owes two tellings; the other one is below.
    pub reported_at: Option<i64>,
    /// When the conversation that *spawned* this turn was told about it. Only
    /// ever set on a sub-agent's turn, and kept apart from `reported_at` because
    /// the two audiences are independent: the user opening the child and saying
    /// one thing must not decide that the parent has heard about a half-written
    /// file.
    pub parent_reported_at: Option<i64>,
}

impl Turn {
    /// The stored status, or `None` for a value this build does not know. An
    /// unknown status is treated as "no opinion" everywhere it is read, so a
    /// row written by a later build cannot make a conversation unreadable.
    pub fn status(&self) -> Option<TurnStatus> {
        TurnStatus::parse(&self.status).ok()
    }

    pub fn phase(&self) -> Option<TurnPhase> {
        self.phase.as_deref().and_then(|p| TurnPhase::parse(p).ok())
    }
}

#[derive(Debug, Insertable)]
#[diesel(table_name = turns)]
pub struct NewTurn<'a> {
    pub id: &'a str,
    pub conversation_id: &'a str,
    pub origin: &'a str,
    pub status: &'a str,
    pub phase: Option<&'a str>,
    pub started_at: i64,
    pub updated_at: i64,
}
