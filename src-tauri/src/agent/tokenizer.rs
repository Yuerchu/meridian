use std::sync::{Arc, OnceLock};
use std::sync::atomic::{AtomicU32, Ordering};

use tiktoken::CoreBpe;

use crate::provider::ChatMessage;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TokenizerKind {
    Cl100kBase,
    O200kBase,
}

struct Tokenizers {
    cl100k: &'static CoreBpe,
    o200k: &'static CoreBpe,
}

static TOKENIZERS: OnceLock<Tokenizers> = OnceLock::new();

fn tokenizers() -> &'static Tokenizers {
    TOKENIZERS.get_or_init(|| Tokenizers {
        cl100k: tiktoken::get_encoding("cl100k_base").expect("cl100k_base encoding"),
        o200k: tiktoken::get_encoding("o200k_base").expect("o200k_base encoding"),
    })
}

pub fn tokenizer_for_model(provider_type: &str, model: &str) -> TokenizerKind {
    let m = model.to_lowercase();
    let _ = provider_type;
    if m.starts_with("gpt-4.1")
        || m.starts_with("gpt-4.5")
        || m.starts_with("o3")
        || m.starts_with("o4")
        || m.starts_with("o1")
    {
        TokenizerKind::O200kBase
    } else {
        TokenizerKind::Cl100kBase
    }
}

const MESSAGE_OVERHEAD: usize = 4;

#[derive(Clone)]
pub struct TokenCounter {
    kind: TokenizerKind,
    correction_factor: Arc<AtomicU32>,
}

impl TokenCounter {
    pub fn new(kind: TokenizerKind) -> Self {
        Self {
            kind,
            correction_factor: Arc::new(AtomicU32::new(f32::to_bits(1.0))),
        }
    }

    pub fn for_model(provider_type: &str, model: &str) -> Self {
        Self::new(tokenizer_for_model(provider_type, model))
    }

    fn factor(&self) -> f32 {
        f32::from_bits(self.correction_factor.load(Ordering::Relaxed))
    }

    pub fn count(&self, text: &str) -> usize {
        let tok = tokenizers();
        let enc = match self.kind {
            TokenizerKind::Cl100kBase => &tok.cl100k,
            TokenizerKind::O200kBase => &tok.o200k,
        };
        let raw = enc.count(text);
        let factor = self.factor();
        if (factor - 1.0).abs() < 0.001 {
            raw
        } else {
            (raw as f32 * factor).round() as usize
        }
    }

    pub fn count_message(&self, msg: &ChatMessage) -> usize {
        let mut tokens = MESSAGE_OVERHEAD;
        tokens += self.count(&msg.content);
        if let Some(ref reasoning) = msg.reasoning_content {
            tokens += self.count(reasoning);
        }
        if let Some(ref tcs) = msg.tool_calls {
            for tc in tcs {
                tokens += self.count(&tc.name) + self.count(&tc.arguments) + 4;
            }
        }
        if let Some(ref _id) = msg.tool_call_id {
            tokens += 2;
        }
        tokens
    }

    pub fn count_messages(&self, messages: &[ChatMessage]) -> usize {
        messages.iter().map(|m| self.count_message(m)).sum::<usize>() + 3
    }

    pub fn calibrate(&self, estimated: usize, actual: usize) {
        if estimated == 0 || actual == 0 {
            return;
        }
        let new_ratio = actual as f32 / estimated as f32;
        let old = self.factor();
        let blended = old * 0.7 + new_ratio * 0.3;
        let clamped = blended.clamp(0.5, 2.0);
        self.correction_factor.store(f32::to_bits(clamped), Ordering::Relaxed);
    }
}

pub struct TokenBudget {
    pub context_limit: usize,
    pub max_output: usize,
    pub compact_threshold: usize,
    pub hard_limit: usize,
    pub current_estimate: usize,
    pub counter: TokenCounter,
}

impl TokenBudget {
    pub fn new(
        provider_type: &str,
        model: &str,
        context_limit: usize,
        max_output: usize,
        compact_threshold_override: Option<usize>,
    ) -> Self {
        let compact_threshold = compact_threshold_override.unwrap_or_else(|| {
            let reserve = max_output.max(context_limit / 5);
            context_limit.saturating_sub(reserve)
        });
        let hard_limit = context_limit * 95 / 100;
        Self {
            context_limit,
            max_output,
            compact_threshold,
            hard_limit,
            current_estimate: 0,
            counter: TokenCounter::for_model(provider_type, model),
        }
    }

    pub fn update_estimate(&mut self, messages: &[ChatMessage]) {
        self.current_estimate = self.counter.count_messages(messages);
    }

    pub fn calibrate_from_usage(&mut self, usage: &crate::provider::TokenUsage) {
        if let Some(prompt) = usage.prompt_tokens {
            if prompt > 0 && self.current_estimate > 0 {
                self.counter.calibrate(self.current_estimate, prompt as usize);
            }
        }
    }

    pub fn needs_compact(&self) -> bool {
        self.current_estimate > self.compact_threshold
    }

    pub fn is_blocked(&self) -> bool {
        self.current_estimate > self.hard_limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenizer_for_model_o200k() {
        assert_eq!(tokenizer_for_model("openai", "gpt-4.1-mini"), TokenizerKind::O200kBase);
        assert_eq!(tokenizer_for_model("openai", "o3-mini"), TokenizerKind::O200kBase);
        assert_eq!(tokenizer_for_model("openai", "o4-mini"), TokenizerKind::O200kBase);
    }

    #[test]
    fn test_tokenizer_for_model_cl100k() {
        assert_eq!(tokenizer_for_model("openai", "gpt-4o"), TokenizerKind::Cl100kBase);
        assert_eq!(tokenizer_for_model("anthropic", "claude-sonnet-4-20250514"), TokenizerKind::Cl100kBase);
        assert_eq!(tokenizer_for_model("deepseek", "deepseek-chat"), TokenizerKind::Cl100kBase);
    }

    #[test]
    fn test_count_known_string() {
        let counter = TokenCounter::new(TokenizerKind::Cl100kBase);
        let tokens = counter.count("Hello, world!");
        assert!(tokens > 0 && tokens < 10);
    }

    #[test]
    fn test_count_messages_overhead() {
        let counter = TokenCounter::new(TokenizerKind::Cl100kBase);
        let msgs = vec![ChatMessage::user("hi")];
        let total = counter.count_messages(&msgs);
        let content_only = counter.count("hi");
        assert!(total > content_only);
    }

    #[test]
    fn test_calibrate_adjusts_factor() {
        let counter = TokenCounter::new(TokenizerKind::Cl100kBase);
        counter.calibrate(100, 150);
        let f = counter.factor();
        assert!(f > 1.0, "factor should increase: {f}");
    }

    #[test]
    fn test_calibrate_clamps() {
        let counter = TokenCounter::new(TokenizerKind::Cl100kBase);
        counter.calibrate(100, 1000);
        let f = counter.factor();
        assert!(f <= 2.0, "factor should be clamped: {f}");
    }

    #[test]
    fn test_budget_thresholds() {
        let budget = TokenBudget::new("openai", "gpt-4o", 128_000, 16_384, None);
        assert_eq!(budget.compact_threshold, 128_000 - 128_000 / 5);
        assert_eq!(budget.hard_limit, 128_000 * 95 / 100);
    }

    #[test]
    fn test_budget_large_output() {
        let budget = TokenBudget::new("anthropic", "claude-sonnet-4-20250514", 200_000, 64_000, None);
        assert_eq!(budget.compact_threshold, 200_000 - 64_000);
    }

    #[test]
    fn test_budget_needs_compact() {
        let mut budget = TokenBudget::new("openai", "gpt-4o", 1000, 200, None);
        budget.current_estimate = 900;
        assert!(budget.needs_compact());
        budget.current_estimate = 100;
        assert!(!budget.needs_compact());
    }
}
