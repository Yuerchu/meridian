use crate::db::models::model_config::ModelConfig;
use crate::provider::TokenUsage;

#[derive(Debug, Clone, serde::Serialize)]
pub struct RequestCost {
    pub input_cost: f64,
    pub output_cost: f64,
    pub cache_cost: f64,
    pub total_cost: f64,
}

/// The four rates a bill needs, apart from wherever they were read.
///
/// A turn takes them off the model's configuration. A report takes them off the
/// audit row, where they were copied at the time — and those two disagree by
/// design, because a price edited last week must not reprice last month. Making
/// this a type rather than passing `&ModelConfig` around is what lets both feed
/// the same formula instead of growing a second one.
///
/// `None` on either cache rate means "priced like ordinary input", which is what
/// most upstreams do and what every row written before migration 30 recorded.
#[derive(Debug, Clone, Copy, Default)]
pub struct Prices {
    pub input: f64,
    pub output: f64,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

impl Prices {
    pub fn of(config: &ModelConfig) -> Self {
        Self {
            input: config.input_price,
            output: config.output_price,
            cache_read: config.cache_price,
            cache_write: config.cache_write_price,
        }
    }

    /// Whether anyone has actually said what this model costs.
    ///
    /// Zero is not a price here: the editor opens with `0` in both boxes, so a
    /// model nobody has priced and a model priced at nothing are the same row.
    /// A report that reads the first as free understates the bill and gives no
    /// sign it did, which is why callers have to be able to count these apart.
    pub fn known(&self) -> bool {
        self.input > 0.0 || self.output > 0.0
    }
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
pub fn compute_cost(usage: &TokenUsage, prices: &Prices) -> RequestCost {
    cost_of(
        &BilledTokens {
            uncached_input: usage.uncached_prompt_tokens() as i64,
            cache_read: usage.cache_read_tokens.unwrap_or(0) as i64,
            cache_write: usage.cache_write_tokens.unwrap_or(0) as i64,
            output: usage.completion_tokens.unwrap_or(0) as i64,
        },
        prices,
    )
}

/// The prompt already split into the three parts that bill at three rates.
///
/// Wider than `TokenUsage`, which reports one request and so fits in `i32`. A
/// month of requests does not — two billion tokens is a fortnight for a busy
/// deployment — and a report that had to squeeze its groups back through `i32`
/// would wrap into a negative bill rather than fail. So the formula is written
/// over `i64` and `compute_cost` is the narrow door into it.
#[derive(Debug, Clone, Copy, Default)]
pub struct BilledTokens {
    pub uncached_input: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub output: i64,
}

impl BilledTokens {
    /// The same split `TokenUsage::uncached_prompt_tokens` makes, over totals
    /// rather than one request — including its saturation, because a provider
    /// that over-reports its cache does so in the aggregate too and a negative
    /// token count would print a negative price.
    pub fn from_totals(prompt: i64, output: i64, cache_read: i64, cache_write: i64) -> Self {
        Self {
            uncached_input: prompt
                .saturating_sub(cache_read)
                .saturating_sub(cache_write)
                .max(0),
            cache_read,
            cache_write,
            output,
        }
    }
}

pub fn cost_of(tokens: &BilledTokens, prices: &Prices) -> RequestCost {
    let uncached = tokens.uncached_input as f64;
    let cache_read = tokens.cache_read as f64;
    let cache_write = tokens.cache_write as f64;
    let output = tokens.output as f64;

    // A blank cache price means "this model prices a cache read like ordinary
    // input". That reading can only ever over-report, which is the safe
    // direction for a number someone makes spending decisions on.
    let read_price = prices.cache_read.unwrap_or(prices.input);
    // Anthropic charges 1.25x input for a five-minute cache entry and 2x for an
    // hour. A blank column means this upstream charges no premium, which is true
    // of every provider except that one — and the same reading every row written
    // before migration 30 already had.
    let write_price = prices.cache_write.unwrap_or(prices.input);

    let input_cost = uncached * prices.input / 1_000_000.0;
    // Both cache legs report under one heading because the breakdown has three
    // slots and "input" there means the part that paid full price. Splitting
    // writes out would need a fourth slot to say something nobody can act on.
    let cache_cost = (cache_read * read_price + cache_write * write_price) / 1_000_000.0;
    let output_cost = output * prices.output / 1_000_000.0;

    RequestCost {
        input_cost,
        output_cost,
        cache_cost,
        total_cost: input_cost + output_cost + cache_cost,
    }
}

pub fn has_pricing(config: &ModelConfig) -> bool {
    Prices::of(config).known()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_config(input: f64, output: f64, cache: Option<f64>) -> ModelConfig {
        priced(input, output, cache, None)
    }

    fn priced(
        input: f64,
        output: f64,
        cache: Option<f64>,
        cache_write: Option<f64>,
    ) -> ModelConfig {
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
            cache_write_price: cache_write,
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
        let cost = compute_cost(&usage, &Prices::of(&config));
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
        let cost = compute_cost(&usage, &Prices::of(&config));
        assert!((cost.input_cost - 1.5).abs() < 0.001, "100k uncached at 15/M");
        assert!((cost.cache_cost - 1.35).abs() < 0.001, "900k read at 1.5/M");
        assert!((cost.total_cost - 2.85).abs() < 0.001);
        assert!(cost.total_cost < 15.0, "the old formula gave 16.35 here");
    }

    fn wrote_100k() -> TokenUsage {
        TokenUsage {
            prompt_tokens: Some(100_000),
            completion_tokens: None,
            total_tokens: None,
            cache_read_tokens: None,
            cache_write_tokens: Some(100_000),
        }
    }

    /// A blank write price means the upstream charges no premium, which is what
    /// every provider except Anthropic does — and what every row written before
    /// migration 30 was already billed at.
    #[test]
    fn a_cache_write_with_no_price_of_its_own_costs_what_input_costs() {
        let cost = compute_cost(&wrote_100k(), &Prices::of(&mock_config(15.0, 60.0, Some(1.5))));
        assert!(cost.input_cost.abs() < 0.001, "nothing was uncached");
        assert!((cost.cache_cost - 1.5).abs() < 0.001, "100k written at the input rate");
    }

    /// The premium the column exists for. Anthropic's five-minute entry is
    /// 1.25x input; billing it as ordinary input understates the run by exactly
    /// the difference, which is what this asserts is no longer happening.
    #[test]
    fn a_cache_write_is_billed_at_its_own_price_when_there_is_one() {
        let cost = compute_cost(&wrote_100k(), &Prices::of(&priced(15.0, 60.0, Some(1.5), Some(18.75))));
        assert!((cost.cache_cost - 1.875).abs() < 0.001, "100k written at 18.75/M");
        assert!(cost.cache_cost > 1.5, "the premium is what distinguishes this from input");
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
        let cost = compute_cost(&usage, &Prices::of(&mock_config(15.0, 60.0, Some(1.5))));
        assert!(cost.input_cost >= 0.0);
        assert!(cost.total_cost >= 0.0);
    }

    #[test]
    fn test_zero_pricing() {
        let config = mock_config(0.0, 0.0, None);
        assert!(!has_pricing(&config));
    }
}
