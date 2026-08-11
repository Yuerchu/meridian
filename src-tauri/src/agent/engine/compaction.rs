//! When a turn runs out of room, and what it does about it.
//!
//! Not a boolean. The two runners differ in four ways at once — whether a
//! preference can switch it off, whether a repeatedly failing summariser is
//! allowed to stop trying, whether the cheap pass runs before the expensive one,
//! and whether any of it is announced — and a flag per difference would let
//! three of the sixteen combinations exist that neither runner has ever been.
//!
//! So it is a policy with two moments. `on_overflow` is recovery: the provider
//! has already refused the request, and something has to come out of the history
//! before it can be sent again. `between_rounds` is prevention: the budget says
//! the next request would be tight, and there is a quiet moment to fix it.
//!
//! The desktop does the full ladder in both — cheap pass, then a summariser
//! behind a circuit breaker, then a blunt trim if that fails — and says so on
//! `compact-start` / `compact-done`. OneBot's recovery is the blunt trim alone.
//! That gap loses content a summary would have kept, and it is on the drift list
//! rather than fixed here: closing it is a behaviour change, and this is not
//! where behaviour changes.

use std::sync::Arc;

use crate::agent::{microcompact, mid_turn_compact, trim_to_context_limit, CompactCircuitBreaker, TokenBudget};
use crate::provider::{ChatMessage, ChatParams, ChatProvider};

use super::Emit;

/// Everything a compaction pass is allowed to touch.
pub(crate) struct Compacting<'a> {
    pub messages: &'a mut Vec<ChatMessage>,
    pub budget: &'a mut TokenBudget,
    /// The turn's own provider. A summary written by a different model than the
    /// one being summarised for would be counted against the wrong tokenizer.
    pub provider: &'a dyn ChatProvider,
    pub params: &'a ChatParams,
    pub keep_recent: usize,
    pub context_limit: usize,
    pub emit: Option<&'a dyn Emit>,
    pub conversation_id: &'a str,
}

impl Compacting<'_> {
    /// The last resort, and the only step that cannot fail. Half the window and
    /// half the tail: deliberately harsher than the threshold path, because by
    /// the time anything calls this the alternative is a request that will be
    /// refused again.
    fn trim(&mut self) {
        trim_to_context_limit(
            self.messages,
            self.context_limit / 2,
            (self.keep_recent / 2).max(2),
        );
        // Re-measured here rather than at each of the four call sites. Trimming
        // is the one step that always changes what the estimate describes, and
        // the caller sizes the retry's output allowance from it — a stale one
        // asks for room this just spent.
        self.budget.update_estimate(self.messages);
    }

    fn announce(&self, channel: &str, extra: serde_json::Value) {
        let Some(emit) = self.emit else { return };
        let mut payload = serde_json::json!({
            "conversation_id": self.conversation_id,
            "mid_turn": true,
        });
        if let (Some(p), Some(e)) = (payload.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                p.insert(k.clone(), v.clone());
            }
        }
        let _ = emit.emit(channel, payload);
    }
}

pub(crate) enum CompactionPolicy {
    Desktop {
        /// The assistant's `auto_compact_enabled`. Governs the threshold pass
        /// only — recovery from a refused request is not a preference, it is the
        /// alternative to giving up on the turn.
        enabled: bool,
        breaker: Arc<CompactCircuitBreaker>,
    },
    OneBot,
}

impl CompactionPolicy {
    /// The provider refused the request as too large.
    ///
    /// Leaves the estimate describing what is left, on every path: the caller
    /// sizes the retry's output allowance from it, and a stale one would ask for
    /// room the trim just spent.
    pub(crate) async fn on_overflow(&self, mut c: Compacting<'_>) {
        match self {
            CompactionPolicy::OneBot => c.trim(),
            CompactionPolicy::Desktop { breaker, .. } => {
                microcompact(c.messages, c.budget, c.keep_recent);
                c.budget.update_estimate(c.messages);
                if !(c.budget.needs_compact() && breaker.can_compact()) {
                    c.trim();
                    return;
                }
                c.announce("compact-start", serde_json::json!({ "trigger": "api_error" }));
                match mid_turn_compact(c.messages, c.budget, c.provider, c.params, c.keep_recent).await {
                    Ok(_) => {
                        breaker.record_success();
                        c.budget.update_estimate(c.messages);
                    }
                    Err(_) => {
                        breaker.record_failure();
                        c.trim();
                    }
                }
                c.announce("compact-done", serde_json::json!({ "trigger": "api_error" }));
            }
        }
    }

    /// The tool results are settled and the next request has not been built yet.
    pub(crate) async fn between_rounds(&self, mut c: Compacting<'_>) {
        c.budget.update_estimate(c.messages);
        if !c.budget.needs_compact() {
            return;
        }
        match self {
            CompactionPolicy::OneBot => {
                microcompact(c.messages, c.budget, c.keep_recent);
                c.budget.update_estimate(c.messages);
                if c.budget.needs_compact() {
                    if let Err(e) =
                        mid_turn_compact(c.messages, c.budget, c.provider, c.params, c.keep_recent).await
                    {
                        tracing::warn!("OneBot mid-turn compact failed: {e}");
                        c.trim();
                    }
                    c.budget.update_estimate(c.messages);
                }
            }
            CompactionPolicy::Desktop { enabled, breaker } => {
                if !(*enabled && breaker.can_compact()) {
                    return;
                }
                c.announce("compact-start", serde_json::json!({ "trigger": "threshold" }));
                let reclaimed = microcompact(c.messages, c.budget, c.keep_recent);
                c.budget.update_estimate(c.messages);
                if !c.budget.needs_compact() {
                    // Said even when the cheap pass freed nothing, because the
                    // start went out and a window left holding it would show a
                    // compaction that never ends.
                    let extra = if reclaimed > 0 {
                        serde_json::json!({ "tokens_reclaimed": reclaimed })
                    } else {
                        serde_json::json!({})
                    };
                    c.announce("compact-done", extra);
                    return;
                }
                match mid_turn_compact(c.messages, c.budget, c.provider, c.params, c.keep_recent).await {
                    Ok(more) => {
                        breaker.record_success();
                        c.budget.update_estimate(c.messages);
                        c.announce(
                            "compact-done",
                            serde_json::json!({ "tokens_reclaimed": reclaimed + more }),
                        );
                    }
                    Err(e) => {
                        tracing::warn!("Mid-turn compact failed: {e}");
                        breaker.record_failure();
                        c.trim();
                        c.budget.update_estimate(c.messages);
                        c.announce(
                            "compact-done",
                            serde_json::json!({ "fallback": true, "error": e.to_string() }),
                        );
                    }
                }
            }
        }
    }
}
