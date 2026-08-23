use crate::db::models::model_config::ModelConfig;
use crate::provider::TokenUsage;

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct RequestCost {
    pub input_cost: f64,
    pub output_cost: f64,
    pub cache_cost: f64,
    /// What the provider's own tools charged, which is not a token cost.
    ///
    /// Its own slot rather than folded into the others because it does not
    /// divide by anything they do: a turn that cost $0.01 of tokens and $0.015
    /// of searching is a different decision from one that spent it all on
    /// tokens, and a single total cannot be taken apart again.
    pub tool_cost: f64,
    pub total_cost: f64,
}

/// A turn is many requests, and with tiered pricing they are not all priced the
/// same — so the costs add up, the tokens do not.
impl std::ops::AddAssign for RequestCost {
    fn add_assign(&mut self, other: Self) {
        self.input_cost += other.input_cost;
        self.output_cost += other.output_cost;
        self.cache_cost += other.cache_cost;
        self.tool_cost += other.tool_cost;
        self.total_cost += other.total_cost;
    }
}

/// What this turn's model costs, at every prompt size it might reach.
///
/// Carried into the turn loop because that loop is the only place that sees each
/// request's own prompt size. A turn of five 50k requests and a turn of one 250k
/// request have identical totals and different bills, and totals are all that
/// survives to the end — so a tier picked afterwards from `progress.input_tokens`
/// would put the first turn in the second one's bracket and overcharge it by the
/// whole premium.
///
/// Resolved once per turn rather than per round: the tier table is parsed here,
/// not on every usage event.
#[derive(Debug, Clone, Default)]
pub struct TurnPricing {
    base: Prices,
    tiers: Vec<PriceTier>,
}

impl TurnPricing {
    /// `None` for a model nobody has priced — the same test the reports use, so
    /// a turn showing no cost and a report counting it as unpriced agree.
    pub fn of(config: &ModelConfig) -> Option<Self> {
        let base = Prices::of(config);
        base.known().then(|| Self {
            base,
            tiers: parse_tiers(config.price_tiers.as_deref()),
        })
    }

    /// The rates for one request of this size. See `Prices::for_prompt` — same
    /// rule, against an already-parsed table.
    pub fn for_prompt(&self, prompt_tokens: i64) -> Prices {
        with_tool_rate(tier_for(&self.tiers, prompt_tokens), self.base)
    }
}

/// A tier's token rates, keeping the base's per-call tool rate.
///
/// Tiers describe what a *large prompt* costs. A tool invocation costs the same
/// whatever the prompt was, so a tier that omitted it — which is all of them —
/// would otherwise switch the charge off for exactly the long requests most
/// likely to have searched.
fn with_tool_rate(tier: Option<Prices>, base: Prices) -> Prices {
    match tier {
        Some(mut prices) => {
            prices.server_tool = base.server_tool;
            prices
        }
        None => base,
    }
}

/// The highest tier this prompt reaches, or `None` for the base rates.
///
/// One implementation, called from both places that choose a tier. They were
/// written twice and had already drifted: one of them applied a tier to a model
/// whose base rates nobody had filled in, which is how the same model came to be
/// "unpriced" on short requests and priced on long ones.
fn tier_for(tiers: &[PriceTier], prompt_tokens: i64) -> Option<Prices> {
    tiers
        .iter()
        .take_while(|tier| tier.min_prompt_tokens <= prompt_tokens)
        .last()
        .map(PriceTier::prices)
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
    /// What one provider-side tool invocation costs, per **thousand** calls —
    /// the unit the upstreams publish it in. `None` means nobody has said, which
    /// is not zero: a searching turn priced at nothing is under-reported, not
    /// free. Never carried by a tier, because a tier is about prompt size and
    /// this charge does not vary with it.
    pub server_tool: Option<f64>,
}

/// A rate set that takes over once the prompt is large enough.
///
/// Three upstreams price this way and all three do the same surprising thing:
/// the threshold is measured against the **whole prompt**, cached part
/// included, and crossing it re-prices the *entire* request rather than the
/// excess. A 201k-token prompt on `grok-4.6` costs double on all 201k, not
/// double on the last thousand. Written down here because the intuitive reading
/// — a bracket, like income tax — is the wrong one, and a formula built on it
/// would be quietly cheap by almost exactly the base rate.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PriceTier {
    /// The prompt size at which this tier starts applying, inclusive.
    pub min_prompt_tokens: i64,
    pub input: f64,
    pub output: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<f64>,
}

impl PriceTier {
    /// A tier states token rates and nothing else. `server_tool` is filled in by
    /// the caller from the base rates — a per-call charge does not vary with how
    /// long the prompt was, and no upstream prices it that way.
    fn prices(&self) -> Prices {
        Prices {
            input: self.input,
            output: self.output,
            cache_read: self.cache_read,
            cache_write: self.cache_write,
            server_tool: None,
        }
    }
}

/// Read the stored tier table, in ascending order and with the nonsense removed.
///
/// The column is hand-editable and reaches here from a form, so this cannot
/// assume it is well formed. It is sorted rather than trusted, because the
/// selection below takes the last tier that applies and an out-of-order array
/// would silently pick the wrong one. Entries at or below zero are dropped:
/// a tier that starts at nothing is not a tier, it is a replacement for the base
/// rate, and letting one through would mean the base columns still shown in the
/// editor no longer decided anything.
///
/// A malformed column yields no tiers at all, which prices the model at its base
/// rate — the same behaviour as before this existed, and the only degradation
/// here that cannot overcharge anyone.
pub fn parse_tiers(raw: Option<&str>) -> Vec<PriceTier> {
    let Some(raw) = raw.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Vec::new();
    };
    let Ok(mut tiers) = serde_json::from_str::<Vec<PriceTier>>(raw) else {
        tracing::warn!(
            raw_len = raw.len(),
            "price_tiers is not an array of tiers; this model will be billed at its base rate"
        );
        return Vec::new();
    };
    // A negative rate produces a negative bill, and this column is reachable
    // from `save_model_config` — which the remote transport can call — not only
    // from the form that would have stopped it. Non-finite values would poison
    // every sum they touch.
    tiers.retain(|tier| {
        tier.min_prompt_tokens > 0
            && [tier.input, tier.output]
                .into_iter()
                .chain(tier.cache_read)
                .chain(tier.cache_write)
                .all(|rate| rate.is_finite() && rate >= 0.0)
    });
    // Stable, so two tiers sharing a threshold resolve to whichever was stored
    // last — arbitrary, but deterministic, and there is no better answer to a
    // table that contradicts itself.
    tiers.sort_by_key(|tier| tier.min_prompt_tokens);
    tiers
}

impl Prices {
    pub fn of(config: &ModelConfig) -> Self {
        Self {
            input: config.input_price,
            output: config.output_price,
            cache_read: config.cache_price,
            cache_write: config.cache_write_price,
            server_tool: config.server_tool_price,
        }
    }

    /// The rates that apply to a request with this prompt size.
    ///
    /// The highest tier whose threshold the prompt reaches, or the base rates
    /// when it reaches none — which is every model that does not price this way
    /// and every row written before the column existed.
    ///
    /// `prompt_tokens` is the whole prompt including the cached part, because
    /// that is what the upstreams measure. Passing the uncached remainder
    /// instead would put a heavily-cached 400k conversation back in the cheap
    /// tier, which is the case most likely to arise and most expensive to get
    /// wrong.
    /// A model whose base rates are blank stays unpriced at *every* size, tiers
    /// or no tiers. Filling in only the long-context row — easy to do, since it
    /// is the row that surprises people — otherwise made one model report as two
    /// things at once: its short requests counted into `unpriced_messages` while
    /// its long ones were billed, and the turn showed no cost either way.
    pub fn for_prompt(config: &ModelConfig, prompt_tokens: i64) -> Self {
        let base = Self::of(config);
        if !base.known() {
            return base;
        }
        with_tool_rate(
            tier_for(&parse_tiers(config.price_tiers.as_deref()), prompt_tokens),
            base,
        )
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
            server_tool_calls: usage.billable_tool_calls.unwrap_or(0) as i64,
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
    /// Billable provider-side tool invocations. Not a token count; see
    /// `TokenUsage::billable_tool_calls`.
    pub server_tool_calls: i64,
}

impl BilledTokens {
    /// The same split `TokenUsage::uncached_prompt_tokens` makes, over totals
    /// rather than one request — including its saturation, because a provider
    /// that over-reports its cache does so in the aggregate too and a negative
    /// token count would print a negative price.
    pub fn from_totals(prompt: i64, output: i64, cache_read: i64, cache_write: i64, server_tool_calls: i64) -> Self {
        Self {
            uncached_input: prompt.saturating_sub(cache_read).saturating_sub(cache_write).max(0),
            cache_read,
            cache_write,
            output,
            server_tool_calls,
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
    // Per *thousand*, not per million: that is the unit the upstreams publish an
    // invocation charge in, and the column stores it that way so nobody has to
    // convert while copying it off a pricing page. An unpriced rate contributes
    // nothing — the calls still happened, and `Prices::known` is what decides
    // whether the whole row counts as unpriced.
    let tool_cost = tokens.server_tool_calls as f64 * prices.server_tool.unwrap_or(0.0) / 1_000.0;

    RequestCost {
        input_cost,
        output_cost,
        cache_cost,
        tool_cost,
        total_cost: input_cost + output_cost + cache_cost + tool_cost,
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

    fn priced(input: f64, output: f64, cache: Option<f64>, cache_write: Option<f64>) -> ModelConfig {
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
            price_tiers: None,
            server_tools: None,
            server_tool_price: None,
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
            billable_tool_calls: None,
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
            billable_tool_calls: None,
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
            billable_tool_calls: None,
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
        assert!(
            cost.cache_cost > 1.5,
            "the premium is what distinguishes this from input"
        );
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
            billable_tool_calls: None,
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

    // --- tiered pricing ---

    /// xAI's actual `grok-4.6` table: everything doubles above a 200k prompt.
    fn grok() -> ModelConfig {
        let mut config = priced(2.0, 6.0, Some(0.5), None);
        config.price_tiers =
            Some(r#"[{"min_prompt_tokens":200000,"input":4.0,"output":12.0,"cache_read":1.0}]"#.into());
        config
    }

    /// The whole point, and the part that is not obvious: crossing the threshold
    /// re-prices the *entire* prompt, not the part above it. A bracket reading
    /// would bill this at roughly the base rate and look completely reasonable.
    #[test]
    fn crossing_the_threshold_reprices_the_whole_request() {
        let config = grok();
        let usage = TokenUsage {
            prompt_tokens: Some(201_000),
            completion_tokens: Some(1_000),
            ..Default::default()
        };
        let cost = compute_cost(&usage, &Prices::for_prompt(&config, 201_000));

        // 201k at 4/M, not 200k at 2/M plus 1k at 4/M.
        assert!((cost.input_cost - 0.804).abs() < 1e-6, "got {}", cost.input_cost);
        assert!((cost.output_cost - 0.012).abs() < 1e-6);
        let as_a_bracket = 200_000.0 * 2.0 / 1e6 + 1_000.0 * 4.0 / 1e6;
        assert!(cost.input_cost > as_a_bracket, "a bracket would give {as_a_bracket}");
    }

    /// One token below, and nothing has changed.
    #[test]
    fn a_prompt_under_the_threshold_pays_the_base_rate() {
        let prices = Prices::for_prompt(&grok(), 199_999);
        assert_eq!(prices.input, 2.0);
        assert_eq!(prices.output, 6.0);
        assert_eq!(prices.cache_read, Some(0.5));
    }

    /// The threshold counts the cached part too. Measuring the uncached
    /// remainder instead would drop a heavily-cached 400k conversation back into
    /// the cheap tier — the most likely case, and the most expensive to miss.
    #[test]
    fn the_cached_part_still_counts_towards_the_threshold() {
        let usage = TokenUsage {
            prompt_tokens: Some(400_000),
            completion_tokens: Some(0),
            cache_read_tokens: Some(390_000),
            ..Default::default()
        };
        let prices = Prices::for_prompt(&grok(), usage.prompt_tokens.unwrap() as i64);
        assert_eq!(prices.cache_read, Some(1.0), "the long-context cache rate");
        let cost = compute_cost(&usage, &prices);
        // 10k uncached at 4/M + 390k read at 1/M.
        assert!((cost.input_cost - 0.04).abs() < 1e-6);
        assert!((cost.cache_cost - 0.39).abs() < 1e-6);
    }

    /// Several tiers, and the highest one that applies wins.
    #[test]
    fn the_highest_applicable_tier_is_the_one_that_applies() {
        let mut config = priced(1.0, 2.0, None, None);
        config.price_tiers = Some(
            r#"[{"min_prompt_tokens":1000000,"input":9.0,"output":9.0},
                {"min_prompt_tokens":200000,"input":3.0,"output":3.0}]"#
                .into(),
        );
        // Stored out of order on purpose: the reader sorts rather than trusting.
        assert_eq!(Prices::for_prompt(&config, 100).input, 1.0);
        assert_eq!(Prices::for_prompt(&config, 200_000).input, 3.0);
        assert_eq!(Prices::for_prompt(&config, 999_999).input, 3.0);
        assert_eq!(Prices::for_prompt(&config, 2_000_000).input, 9.0);
    }

    /// A tier that omits a cache rate means what a blank column has always
    /// meant — priced like that tier's input — rather than inheriting the base
    /// tier's cheaper one, which would understate every long request.
    #[test]
    fn a_tier_without_a_cache_rate_prices_reads_at_its_own_input() {
        let mut config = priced(2.0, 6.0, Some(0.5), None);
        config.price_tiers = Some(r#"[{"min_prompt_tokens":200000,"input":4.0,"output":12.0}]"#.into());
        let usage = TokenUsage {
            prompt_tokens: Some(300_000),
            cache_read_tokens: Some(300_000),
            ..Default::default()
        };
        let cost = compute_cost(&usage, &Prices::for_prompt(&config, 300_000));
        assert!((cost.cache_cost - 1.2).abs() < 1e-6, "300k at the tier's 4/M");
    }

    /// Everything a hand-edited column can be, and none of it may throw or
    /// silently overcharge. A model that cannot be read falls back to its base
    /// rate — the behaviour it had before tiers existed.
    #[test]
    fn a_malformed_tier_table_falls_back_to_the_base_rate() {
        for raw in [
            "",
            "   ",
            "not json",
            "{}",
            r#"[{"min_prompt_tokens":0,"input":99.0,"output":99.0}]"#,
            r#"[{"min_prompt_tokens":-5,"input":99.0,"output":99.0}]"#,
        ] {
            let mut config = priced(2.0, 6.0, None, None);
            config.price_tiers = Some(raw.into());
            assert_eq!(
                Prices::for_prompt(&config, 10_000_000).input,
                2.0,
                "{raw:?} should not have priced anything"
            );
        }
        let mut config = priced(2.0, 6.0, None, None);
        config.price_tiers = None;
        assert_eq!(Prices::for_prompt(&config, 10_000_000).input, 2.0);
    }

    /// A turn is many requests. Five small ones and one large one leave the same
    /// totals behind and are billed differently, which is why the loop prices
    /// each round rather than the sum.
    #[test]
    fn five_small_requests_are_not_one_large_one() {
        let pricing = TurnPricing::of(&grok()).expect("priced");
        let round = |prompt: i64| {
            let usage = TokenUsage {
                prompt_tokens: Some(prompt as i32),
                completion_tokens: Some(0),
                ..Default::default()
            };
            compute_cost(&usage, &pricing.for_prompt(prompt))
        };

        let mut split = RequestCost::default();
        for _ in 0..5 {
            split += round(50_000);
        }
        let whole = round(250_000);

        assert!((split.total_cost - 0.5).abs() < 1e-6, "250k at the base 2/M");
        assert!((whole.total_cost - 1.0).abs() < 1e-6, "250k at the long 4/M");
        assert!(
            whole.total_cost > split.total_cost,
            "identical token totals, different bills — pricing from the sum picks one of these at random",
        );
    }

    /// The reply that made this necessary, priced end to end.
    ///
    /// A live `grok-4.6` answer with one web search: 4551 prompt tokens (1152 of
    /// them cached), 74 output, and `web_search_calls: 1`. xAI's own
    /// `cost_in_usd_ticks` said $0.012818 — of which half a cent was the search,
    /// on top of the tokens. Counting only the tokens reports two thirds of it.
    #[test]
    fn a_search_is_billed_on_top_of_the_tokens() {
        let mut config = priced(2.0, 6.0, Some(0.5), None);
        config.server_tool_price = Some(5.0); // $5 per 1000 calls
        let usage = TokenUsage {
            prompt_tokens: Some(4551),
            completion_tokens: Some(74),
            total_tokens: Some(4625),
            cache_read_tokens: Some(1152),
            cache_write_tokens: None,
            billable_tool_calls: Some(1),
        };

        let cost = compute_cost(&usage, &Prices::of(&config));
        assert!((cost.tool_cost - 0.005).abs() < 1e-9, "one search at $5/1k");
        assert!(
            (cost.total_cost - 0.012818).abs() < 1e-6,
            "xAI billed 0.012818, got {}",
            cost.total_cost,
        );
        // The figure the old formula would have produced, kept explicit so
        // reintroducing it fails here rather than in a month's invoice.
        let tokens_only = cost.input_cost + cost.output_cost + cost.cache_cost;
        assert!((tokens_only - 0.007818).abs() < 1e-6);
    }

    /// A model nobody has given a tool rate still ran the searches. The calls are
    /// counted and contribute nothing, rather than being priced at a rate that
    /// was never configured.
    #[test]
    fn an_unpriced_tool_rate_adds_nothing_rather_than_guessing() {
        let config = priced(2.0, 6.0, None, None);
        let usage = TokenUsage {
            prompt_tokens: Some(1_000),
            completion_tokens: Some(0),
            billable_tool_calls: Some(4),
            ..Default::default()
        };
        let cost = compute_cost(&usage, &Prices::of(&config));
        assert_eq!(cost.tool_cost, 0.0);
        assert!((cost.total_cost - 0.002).abs() < 1e-9, "the tokens still bill");
    }

    /// The per-call rate does not vary with prompt size, so a tier must not
    /// switch it off — and every tier omits it, since no upstream prices it that
    /// way. Long requests are the ones most likely to have searched.
    #[test]
    fn a_tier_keeps_the_base_tool_rate() {
        let mut config = priced(2.0, 6.0, Some(0.5), None);
        config.server_tool_price = Some(5.0);
        config.price_tiers = Some(r#"[{"min_prompt_tokens":200000,"input":4.0,"output":12.0}]"#.into());

        let long = Prices::for_prompt(&config, 250_000);
        assert_eq!(long.input, 4.0, "the tier applied");
        assert_eq!(long.server_tool, Some(5.0), "and did not take the tool rate with it");

        let pricing = TurnPricing::of(&config).expect("priced");
        assert_eq!(pricing.for_prompt(250_000).server_tool, Some(5.0));
    }

    /// An unpriced model has no tier table worth reading, and has to stay
    /// distinguishable from one priced at zero.
    #[test]
    fn an_unpriced_model_has_no_turn_pricing() {
        assert!(TurnPricing::of(&mock_config(0.0, 0.0, None)).is_none());
        assert!(TurnPricing::of(&mock_config(2.0, 0.0, None)).is_some());
    }

    /// Filling in only the long-context row is an easy mistake — it is the row
    /// that surprises people — and it used to make one model report as two
    /// things at once: short requests counted as unpriced, long ones billed, and
    /// the turn showing no cost either way. Both paths now agree that a model
    /// without base rates is unpriced at every size.
    #[test]
    fn tiers_alone_do_not_price_a_model_nobody_has_priced() {
        let mut config = priced(0.0, 0.0, None, None);
        config.price_tiers = Some(r#"[{"min_prompt_tokens":200000,"input":4.0,"output":12.0}]"#.into());

        assert_eq!(Prices::for_prompt(&config, 500_000).input, 0.0, "still unpriced");
        assert!(!Prices::for_prompt(&config, 500_000).known());
        assert!(TurnPricing::of(&config).is_none(), "and the turn agrees");
    }

    /// A rate that would produce a negative or non-finite bill is not a rate.
    /// The column is reachable from `save_model_config`, which the remote
    /// transport can call — the form is not the only way in.
    #[test]
    fn a_tier_that_would_bill_nonsense_is_dropped() {
        for raw in [
            r#"[{"min_prompt_tokens":200000,"input":-4.0,"output":12.0}]"#,
            r#"[{"min_prompt_tokens":200000,"input":4.0,"output":-12.0}]"#,
            r#"[{"min_prompt_tokens":200000,"input":4.0,"output":12.0,"cache_read":-1.0}]"#,
        ] {
            let mut config = priced(2.0, 6.0, None, None);
            config.price_tiers = Some(raw.into());
            let prices = Prices::for_prompt(&config, 500_000);
            assert_eq!(prices.input, 2.0, "{raw} should not have applied");
            assert_eq!(prices.output, 6.0);
        }
    }
}
