use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::conversations;

#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = conversations)]
pub struct Conversation {
    pub id: String,
    pub title: Option<String>,
    pub assistant_id: Option<String>,
    pub is_pinned: i32,
    pub is_archived: i32,
    pub message_count: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_id: Option<String>,
    pub compact_cursor: Option<i32>,
    /// Per-conversation reasoning tier. `None` means "fall back to the
    /// assistant's stored default".
    pub thinking_level: Option<String>,
    pub fast_mode: i32,
    /// Which collaboration mode the conversation is in. `None` is the default
    /// (work) mode; see `agent::modes`.
    pub mode: Option<String>,
    /// Leaf the active path ends at. `None` falls back to the highest
    /// `sort_order` row, which is necessarily a leaf, so a missed write costs an
    /// alternative branch rather than the whole transcript.
    pub head_message_id: Option<String>,
    /// The user's standing "yes" to ordinary edits inside the project. What it
    /// can widen is bounded in `tools::reach` — never outside the project,
    /// never anything irreversible, never a path that makes code run later.
    pub accept_edits: i32,
    /// Set when this conversation exists because a turn delegated work to a
    /// sub-agent. Being set is the whole test: it keeps the row out of the
    /// sidebar, and the only way in is the card on the turn that spawned it.
    pub parent_conversation_id: Option<String>,
    /// The assistant row and the provider call id of the delegating tool call,
    /// as a pair. The message id is not redundant — provider call ids repeat
    /// within one conversation, so the call id alone would hang a second run's
    /// card on the first run's tool call.
    pub spawned_by_message_id: Option<String>,
    pub spawned_by_call_id: Option<String>,
    /// The delegated run. The parent's card reports on this turn and no other,
    /// because follow-up chat in here writes turns too and "the latest one"
    /// would let an unrelated conversation decide what the card says.
    pub spawned_turn_id: Option<String>,
    /// `explore` or `agent`. Unknown values degrade rather than fail, like every
    /// other enum stored here.
    pub agent_kind: Option<String>,
    /// What the sub-agent actually ran on. `None` for ordinary conversations,
    /// whose model lives in frontend state and never reaches the database. Set
    /// here because this transcript outlives the run: continuing it, sizing the
    /// context indicator and compacting all have to use the same model the
    /// transcript was written by, not the parent's.
    pub agent_provider_id: Option<String>,
    pub agent_model_id: Option<String>,
}

/// One delegated run, as the card on the parent's turn needs it.
///
/// The turn is carried whole rather than reduced to a status string because the
/// coordinator has the last word on whether a `running` row is still running,
/// and that judgement belongs to the command layer — the same split
/// `TurnView` makes.
#[derive(Debug, Clone)]
pub struct SubAgentRun {
    pub conversation_id: String,
    /// The assistant row and the provider call id of the delegating call. Both,
    /// always: call ids repeat within a conversation.
    pub spawned_by_message_id: Option<String>,
    pub spawned_by_call_id: Option<String>,
    pub spawned_turn_id: Option<String>,
    pub agent_kind: Option<String>,
    pub title: Option<String>,
    /// Assistant iterations in the delegated run — how many times the model was
    /// asked, not how many tools it called.
    pub steps: i64,
    /// The row named by `spawned_turn_id`, if it is still there.
    pub turn: Option<crate::db::models::turn::Turn>,
}

#[derive(Debug, Default, Insertable)]
#[diesel(table_name = conversations)]
pub struct NewConversation<'a> {
    pub id: &'a str,
    pub title: Option<&'a str>,
    pub assistant_id: Option<&'a str>,
    pub is_pinned: i32,
    pub is_archived: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_id: Option<&'a str>,
    pub parent_conversation_id: Option<&'a str>,
    pub spawned_by_message_id: Option<&'a str>,
    pub spawned_by_call_id: Option<&'a str>,
    pub spawned_turn_id: Option<&'a str>,
    pub agent_kind: Option<&'a str>,
    pub agent_provider_id: Option<&'a str>,
    pub agent_model_id: Option<&'a str>,
}
