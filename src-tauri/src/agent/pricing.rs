use crate::db::models::model_config::ModelConfig;
use crate::provider::TokenUsage;

#[derive(Debug, Clone, serde::Serialize)]
pub struct RequestCost {
    pub input_cost: f64,
    pub output_cost: f64,
    pub cache_cost: f64,
    pub total_cost: f64,
}

pub fn compute_cost(usage: &TokenUsage, config: &ModelConfig) -> RequestCost {
    let input = usage.prompt_tokens.unwrap_or(0) as f64;
    let output = usage.completion_tokens.unwrap_or(0) as f64;
    let cache = usage.cache_hit_tokens.unwrap_or(0) as f64;
    let cache_price = config.cache_price.unwrap_or(config.input_price);

    let input_cost = input * config.input_price / 1_000_000.0;
    let output_cost = output * config.output_price / 1_000_000.0;
    let cache_cost = cache * cache_price / 1_000_000.0;

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

    #[test]
    fn test_basic_cost() {
        let usage = TokenUsage {
            prompt_tokens: Some(1_000_000),
            completion_tokens: Some(1_000_000),
            total_tokens: Some(2_000_000),
            cache_hit_tokens: None,
            cache_miss_tokens: None,
        };
        let config = mock_config(15.0, 60.0, None);
        let cost = compute_cost(&usage, &config);
        assert!((cost.input_cost - 15.0).abs() < 0.001);
        assert!((cost.output_cost - 60.0).abs() < 0.001);
        assert!((cost.total_cost - 75.0).abs() < 0.001);
    }

    #[test]
    fn test_cache_pricing() {
        let usage = TokenUsage {
            prompt_tokens: Some(500_000),
            completion_tokens: Some(100_000),
            total_tokens: Some(600_000),
            cache_hit_tokens: Some(400_000),
            cache_miss_tokens: Some(100_000),
        };
        let config = mock_config(15.0, 60.0, Some(1.5));
        let cost = compute_cost(&usage, &config);
        assert!((cost.cache_cost - 0.6).abs() < 0.001);
    }

    #[test]
    fn test_zero_pricing() {
        let config = mock_config(0.0, 0.0, None);
        assert!(!has_pricing(&config));
    }
}
