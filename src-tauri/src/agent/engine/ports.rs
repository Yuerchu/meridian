//! The places the loop reaches outside itself.
//!
//! One trait per thing the two runners genuinely disagree about, and nothing
//! else. The test of whether something belongs here is not "does it differ" but
//! "does it differ *irreconcilably*" — the row writes differ in wording and the
//! retry ladder differs in whether it logs, and neither earned a port. What did:
//! how an answer is asked for, where mid-turn commentary goes, which tools live
//! outside the registry, what arrives while the turn is running, and whether the
//! conversation can change mode at all.
//!
//! `None` on an optional port is not a degraded mode. It is the honest statement
//! that this runner has no such thing: the desktop has no inbox and OneBot has
//! no plan mode, and a loop that faked either would be inventing behaviour that
//! this refactor is explicitly not adding.
//!
//! Every trait is `Send + Sync` because the whole turn runs as one detached task
//! on the OneBot side. A port that forgets it fails to compile at the call site
//! rather than at runtime, which is the good kind of failure.

use crate::provider::{SenderRef, ToolCall};

use super::transitions::Transitions;
use super::{ApprovalDecision, Emit};

/// Putting a tool call in front of whoever decides, and waiting.
///
/// **Only `ask_user` may consume a [`ApprovalDecision::Response`].** Everywhere
/// else — a registry tool, an MCP tool, a surface tool, a sandbox escalation, a
/// mode switch — the sole thing that authorises the call is `Approved`, and a
/// `Response` is refused exactly as `None` is.
///
/// The distinction is easy to lose, because both plainly mean "the person did
/// something rather than nothing". But `Response` is the *answer to a question*,
/// and only `ask_user` asked one. A transport that can only carry a boolean has
/// to choose which to send, and choosing `Response` for everything would turn
/// somebody typing a sentence into permission to run a command. So the mapping
/// belongs to the adapter and is per tool: `ask_user`'s yes becomes a
/// `Response`, everything else's becomes `Approved`.
#[async_trait::async_trait]
pub(crate) trait Approvals: Send + Sync {
    /// `Ok(None)` is nobody answered — cancelled, timed out, or the waiter went
    /// away. It is not a refusal with an empty reason, and the loop tells the
    /// two apart when it words the tool result.
    ///
    /// `Err` ends the turn. Only the desktop can produce one: drawing its card
    /// *is* an event, so a send that fails means the user is looking at a
    /// question that will never appear.
    ///
    /// Implementations own the phase bracket. The wait is the longest window a
    /// turn has — a person can leave a card on screen for an hour — and what the
    /// record says during it is the difference between "stopped waiting for you"
    /// and "may have already run".
    async fn ask(
        &self,
        assistant_message_id: &str,
        call: &ToolCall,
        retry_reason: Option<&str>,
    ) -> Result<Option<ApprovalDecision>, String>;
}

/// Where the model's text goes when it is not the last thing it says.
///
/// The desktop has no use for it: every chunk was already streamed to the
/// window as it arrived. OneBot streams nowhere, so without this the only text
/// that ever reaches the chat is the final iteration's — everything the model
/// said on the way to a tool call would exist solely in the database.
#[async_trait::async_trait]
pub(crate) trait Commentary: Send + Sync {
    async fn say(&self, text: String);
}

/// Tools that belong to the surface the turn is running on.
///
/// QQ's are neither in the registry nor behind MCP: they are scoped to one
/// group and one session, and handing them to the registry would mean the
/// registry knowing about chat platforms. Their definitions are merged into
/// `tool_defs` by the caller; this only says who owns a name and what happens
/// when it is called.
#[async_trait::async_trait]
pub(crate) trait SurfaceTools: Send + Sync {
    fn owns(&self, name: &str) -> bool;
    fn requires_approval(&self, name: &str) -> bool;
    async fn execute(&self, name: &str, arguments: &str) -> Result<String, String>;
}

/// Running a whole turn of somebody else's, and waiting for its answer.
///
/// Same shape as `SurfaceTools`: the loop recognises the name and hands over,
/// and everything about what happens next lives in the implementation. It has
/// to be a port rather than something the loop does itself, because starting a
/// turn means resolving a provider and a key, and this module is not allowed to
/// know that those exist.
///
/// It is also what closes recursion. A sub-agent's own ports carry `None` here,
/// so a delegated run cannot delegate. That is a property of the type rather
/// than a depth counter somebody has to remember to check.
/// Nothing implements this yet, so the compiler cannot see anything reading the
/// types below. The runner that does is the next piece of work; declaring the
/// shape first is what lets the loop, the tool definition and the dispatch
/// branch be reviewed on their own.
#[async_trait::async_trait]
pub(crate) trait SubAgents: Send + Sync {
    async fn run(&self, spec: SubAgentSpec) -> Result<SubAgentReport, String>;
}

/// What the parent asked for.
pub(crate) struct SubAgentSpec {
    pub kind: crate::agent::sub_agents::SubAgentKind,
    /// Three to five words, shown on the card while it runs and kept as the
    /// sub-agent's conversation title.
    pub description: String,
    /// The whole briefing. The parent's transcript is not passed along, so this
    /// is everything the sub-agent will know.
    pub prompt: String,
    /// `"<provider_id>:<model_id>"`, or `None` for the configured default. Not
    /// resolved here: which models exist is a question for the runner that owns
    /// the database.
    pub model: Option<String>,
    /// The tool call that asked. Both halves, because provider call ids repeat
    /// within one conversation and the card is found by the pair.
    pub parent_message_id: String,
    pub parent_call_id: String,
}

/// How a delegated run ended.
///
/// Kept apart from the text, because `TurnOutcome::reply` is `Ok(partial)` for
/// a turn that was cancelled and for one the loop guard stopped. Handing the
/// parent that string with no verdict attached is how half an answer gets read
/// as a conclusion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SubAgentStatus {
    Done,
    /// Somebody pressed Stop — on the sub-agent, or on the turn that spawned it.
    Cancelled,
    /// The loop guard stopped it going round in circles.
    Aborted,
    Failed,
}

impl SubAgentStatus {
    /// What the parent's tool result is recorded as. Only a run that finished
    /// counts as a success; the rest are outcomes the model must not paper over.
    pub(crate) fn outcome(&self) -> &'static str {
        match self {
            SubAgentStatus::Done => "success",
            _ => "error",
        }
    }
}

pub(crate) struct SubAgentReport {
    pub status: SubAgentStatus,
    pub reply: String,
    /// Assistant iterations — how many times the model was asked.
    pub steps: usize,
}

/// Something that arrived while the turn was running.
pub(crate) struct Steered {
    pub text: String,
    /// Who said it. `None` is a notice the system generated — a recall, a
    /// membership change — rather than something a person typed, and it travels
    /// as injected context instead of as a user message.
    pub speaker: Option<SenderRef>,
}

/// Messages that turned up mid-turn.
///
/// Drained between rounds rather than at any point in one, so a request is
/// never assembled from a history that is being appended to. Not `async`: the
/// implementation is a queue behind a lock, and making it a future would put an
/// await inside the loop's hottest branch for no reason anyone can name.
pub(crate) trait Steering: Send + Sync {
    fn drain(&self) -> Vec<Steered>;
}

/// Everything the loop is allowed to reach outside itself.
///
/// Borrowed rather than owned so that a caller can keep using the same
/// implementations across several rounds of one turn — which is exactly what a
/// `TurnEnd::Continue` round is.
pub(crate) struct TurnPorts<'a> {
    /// `None` emits nothing at all, which is the ordinary case for a QQ turn
    /// with no window attached.
    pub emit: Option<&'a dyn Emit>,
    pub approvals: &'a dyn Approvals,
    pub interim: Option<&'a dyn Commentary>,
    pub surface_tools: Option<&'a dyn SurfaceTools>,
    pub steering: Option<&'a dyn Steering>,
    pub transitions: Option<&'a dyn Transitions>,
    /// `None` on every runner that cannot delegate — and on every sub-agent, so
    /// that a delegated run cannot delegate again.
    pub sub_agents: Option<&'a dyn SubAgents>,
}
