//! What crosses the socket.
//!
//! The inbound half is written by the `meridian-plan-gate` plugin, not by
//! Claude Code itself: the plugin has already pulled the plan out of the hook
//! payload, counted the round and decided whether the plan actually changed.
//! So this is our own shape and we can require what we need, rather than
//! tracking whatever Claude Code's hook JSON looks like this month.
//!
//! The outbound half is Claude Code's, and that one is not ours to change —
//! see `HookOutput`.

use serde::{Deserialize, Serialize};

/// One `ExitPlanMode` submission, as the plugin describes it.
#[derive(Debug, Deserialize)]
pub(crate) struct ReviewRequest {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// The repository the plan is about. The reviewing agent is confined to it,
    /// so this is load-bearing rather than informational.
    pub cwd: String,
    /// Where the earlier rounds of this session went, as the client remembers
    /// it. This is what lets round 2 see what round 1 said without Meridian
    /// holding a session table of its own — the client keeps its state on disk
    /// and hands the continuation back, so a Meridian that crashed between the
    /// two rounds has nothing to recover.
    ///
    /// Optional, and not trusted: see `review::open_or_reuse`.
    #[serde(rename = "conversationId", default)]
    pub conversation_id: Option<String>,
    pub plan: String,
    #[serde(default)]
    pub round: u32,
    #[serde(default)]
    pub max_rounds: Option<u32>,
    /// Whether this submission is materially the same as the previous one. The
    /// reviewer is told, because "this is the third time you have seen this"
    /// changes what a useful answer looks like.
    #[serde(default)]
    pub stagnant: bool,
    #[serde(default)]
    pub history: Vec<HistoryEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct HistoryEntry {
    #[serde(default)]
    pub round: u32,
    #[serde(default)]
    pub verdict: String,
    #[serde(default)]
    pub summary: String,
}

/// What the plugin gets back.
///
/// Three shapes, and the difference matters: only `Revise` stops the plan.
/// `Approve` and `Inconclusive` both let Claude Code's own permission flow
/// carry on, which is what puts the plan in front of the user. Deciding
/// *for* the user is not this endpoint's job.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub(crate) enum ReviewResponse {
    Verdict {
        verdict: &'static str,
        summary: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        #[serde(rename = "reviewId")]
        review_id: String,
        /// Hand back where this round was written, so the next one can ask to
        /// continue there. The client is the only thing that remembers.
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
    /// The review ran but said nothing usable. The plugin forwards this string
    /// to the user verbatim and does not block the plan.
    ///
    /// Always carries the conversation: getting here means a transcript was
    /// written, and the next round should continue in it rather than start the
    /// reviewer over. A review that never ran at all is a non-200 instead, so
    /// there is no case here with nothing to continue.
    Inconclusive {
        #[serde(rename = "systemMessage")]
        system_message: String,
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
}

impl ReviewResponse {
    pub(crate) fn approve(summary: String, review_id: String, conversation_id: String) -> Self {
        Self::Verdict { verdict: "approve", summary, message: None, review_id, conversation_id }
    }

    pub(crate) fn revise(
        summary: String,
        message: String,
        review_id: String,
        conversation_id: String,
    ) -> Self {
        Self::Verdict {
            verdict: "revise",
            summary,
            message: Some(message),
            review_id,
            conversation_id,
        }
    }

    /// Ran, wrote a transcript, but produced no usable verdict.
    pub(crate) fn inconclusive(reason: impl Into<String>, conversation_id: String) -> Self {
        Self::Inconclusive { system_message: reason.into(), conversation_id }
    }
}

/// The error body. Nothing reads it but a human with `claude --debug` open:
/// every non-200 is fail-open on the Claude Code side, so the status code is
/// the whole protocol and this is just the explanation.
#[derive(Debug, Serialize)]
pub(crate) struct ErrorBody {
    pub error: String,
}
