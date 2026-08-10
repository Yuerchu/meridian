//! The turn loop, and the ports the two runners plug into it.
//!
//! The desktop and OneBot runners were two copies of the same loop that had
//! drifted — the same retry ladder, the same stream state machine, the same row
//! writes, with the approval judgement fixed on one side and not the other. This
//! is the one copy; everything the two genuinely disagree about arrives as a
//! port rather than as a fork in the code.
//!
//! Nothing in here knows about Tauri. That is deliberate and worth keeping: it
//! is what lets the loop be tested without an app handle, and what will let a
//! sub-agent run one without owning a window.

pub(crate) mod stream;
pub(crate) mod transcript;

pub(crate) use stream::consume_stream;
pub(crate) use transcript::{append_tool_result, begin_assistant, complete_assistant, in_phase};

/// Where a turn's progress goes while it is still happening.
///
/// Returns a `Result` because the two runners do not agree on what a failed
/// send means, and that disagreement is load-bearing rather than accidental:
///
/// - The desktop treats it as fatal. Its events *are* the answer — a window
///   that missed one is showing a transcript that never catches up — so a send
///   that fails takes the turn down with it and the user is told.
/// - OneBot treats it as nothing. Its answer goes out over the chat transport;
///   these events are a courtesy to a desktop window that may not even be open.
///
/// So the desktop adapter returns the real error and the OneBot one returns
/// `Ok(())` whatever happened. Folding this into `Option<&dyn Emit>` would
/// quietly give one of them the other's behaviour.
///
/// `None` is the third case, and means neither: emit nothing at all.
pub(crate) trait Emit: Send + Sync {
    fn emit(&self, channel: &str, payload: serde_json::Value) -> Result<(), String>;
}
