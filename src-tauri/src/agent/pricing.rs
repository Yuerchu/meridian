use crate::db::models::model_config::ModelConfig;
use crate::provider::TokenUsage;

#[derive(Debug, Clone, serde::Serialize)]
pub struct RequestCost {
    pub input_cost: f64,
    pub output_cost: f64,
    pub cache_cost: f64,
    pub total_cost: f64,
}

/// What one request cost, in whatever currency the model's prices are quoted in.
///
/// The prompt is split three ways because the three parts bill at three rates,
/// and every prompt token belongs to exactly one of them:
///
/// ```text
/// uncached = prompt_tokens - cache_read_tokens - cache_write_tokens
/// ```
///
/// The previous formula charged `input_price` on the *whole* prompt and then
/// `cache_price` on the cached part on top, so a cached token was billed twice —
/// once of them at full rate. It stayed dormant only because the single caller
/// hard-coded the cache fields to `None`; with the adapters filling them in, a
/// DeepSeek turn at a 90% hit rate would have reported nearly six times its real
/// cost, and that number is user-facing — it ships in the stop event's
/// `cost_breakdown`.
pub fn compute_cost(usage: &TokenUsage, config: &ModelConfig) -> RequestCost {
    let uncached = usage.uncached_prompt_tokens() as f64;
    let cache_read = usage.cache_read_tokens.unwrap_or(0) as f64;
    let cache_write = usage.cache_write_tokens.unwrap_or(0) as f64;
    let output = usage.completion_tokens.unwrap_or(0) as f64;

    // A blank cache price means "this model prices a cache read like ordinary
    // input". That reading can only ever over-report, which is the safe
    // direction for a number someone makes spending decisions on.
    let read_price = config.cache_price.unwrap_or(config.input_price);
    // Anthropic charges 1.25x input for a five-minute cache write and 2x for the
    // hour, but `model_configs` has no column for either, so a write is billed as
    // ordinary input and the total is understated by that premium. The error is
    // bounded by the write count, which is zero on every provider except
    // Anthropic — and zero there too until the request builder starts sending
    // `cache_control`. Add the column in the same change that does.
    let write_price = config.input_price;

    let input_cost = uncached * config.input_price / 1_000_000.0;
    // Both cache legs report under one heading because the breakdown has three
    // slots and "input" there means the part that paid full price. Splitting
    // writes out would need a fourth slot to say something nobody can act on.
    let cache_cost = (cache_read * read_price + cache_write * write_price) / 1_000_000.0;
    let output_cost = output * config.output_price / 1_000_000.0;

    RequestCost {
        input_cost,
        output_cost,
        cache_cost,
        total_cost: input_cost + output_cost + cache_cost,
    }
}

pub fn has_pricing(config: &ModelConfig) -> bool {
    config.input_price > 0.0 || config.output_price > 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_config(input: f64, output: f64, cache: Option<f64>) -> ModelConfig {
        ModelConfig {
            id: "test".into(),
            provider_id: "p".into(),
            model_id: "m".into(),
            display_name: None,
            context_window: 128000,
            compact_threshold: 100000,
            max_output_tokens: None,
            input_price: input,
            output_price: output,
            cache_price: cache,
            created_at: 0,
            updated_at: 0,
            capability_overrides: None,
        }
    }

    /// A provider that reports no caching bills the whole prompt as input.
    #[test]
    fn test_basic_cost() {
        let usage = TokenUsage {
            prompt_tokens: Some(1_000_000),
            completion_tokens: Some(1_000_000),
            total_tokens: Some(2_000_000),
            cache_read_tokens: None,
            cache_write_tokens: None,
        };
        let config = mock_config(15.0, 60.0, None);
        let cost = compute_cost(&usage, &config);
        assert!((cost.input_cost - 15.0).abs() < 0.001);
        assert!((cost.output_cost - 60.0).abs() < 0.001);
        assert!((cost.total_cost - 75.0).abs() < 0.001);
    }

    /// The cached part is billed at the cache rate *instead of*, not in addition
    /// to, the input rate.
    ///
    /// The old formula charged the whole prompt at `input_price` and then added
    /// the cached part again at `cache_price`, which on these numbers came to
    /// 16.35 against a real cost of 2.85. The explicit `< 15.0` below is there to
    /// fail loudly if anyone reintroduces that shape: 15.0 is what the full
    /// prompt alone would cost, so a total at or above it means the discount was
    /// not applied at all.
    #[test]
    fn a_cached_token_is_billed_once_not_twice() {
        let usage = TokenUsage {
            prompt_tokens: Some(1_000_000),
            completion_tokens: None,
            total_tokens: None,
            cache_read_tokens: Some(900_000),
            cache_write_tokens: None,
        };
        let config = mock_config(15.0, 60.0, Some(1.5));
        let cost = compute_cost(&usage, &config);
        assert!((cost.input_cost - 1.5).abs() < 0.001, "100k uncached at 15/M");
        assert!((cost.cache_cost - 1.35).abs() < 0.001, "900k read at 1.5/M");
        assert!((cost.total_cost - 2.85).abs() < 0.001);
        assert!(cost.total_cost < 15.0, "the old formula gave 16.35 here");
    }

    /// Until `model_configs` grows a column for it, a cache write costs what
    /// ordinary input costs. This test is the executable form of that decision —
    /// when the column lands, the expectation here becomes 1.25x.
    #[test]
    fn a_cache_write_is_billed_as_input_until_there_is_a_price_for_it() {
        let usage = TokenUsage {
            prompt_tokens: Some(100_000),
            completion_tokens: None,
            total_tokens: None,
            cache_read_tokens: None,
            cache_write_tokens: Some(100_000),
        };
        let config = mock_config(15.0, 60.0, Some(1.5));
        let cost = compute_cost(&usage, &config);
        assert!(cost.input_cost.abs() < 0.001, "nothing was uncached");
        assert!((cost.cache_cost - 1.5).abs() < 0.001, "100k written at the input rate");
    }

    /// A provider contradicting itself must not produce a negative bill.
    #[test]
    fn an_over_reported_cache_count_cannot_produce_a_negative_bill() {
        let usage = TokenUsage {
            prompt_tokens: Some(100),
            completion_tokens: None,
            total_tokens: None,
            cache_read_tokens: Some(9_999),
            cache_write_tokens: None,
        };
        let cost = compute_cost(&usage, &mock_config(15.0, 60.0, Some(1.5)));
        assert!(cost.input_cost >= 0.0);
        assert!(cost.total_cost >= 0.0);
    }

    #[test]
    fn test_zero_pricing() {
        let config = mock_config(0.0, 0.0, None);
        assert!(!has_pricing(&config));
    }
}
