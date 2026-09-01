use crate::ServicesExt;
use meridian_core::db::ops::usage::{
    UsageBucket, UsageDimension as CoreUsageDimension, UsageFilter as CoreUsageFilter, report,
};
use meridian_core::decimal::Decimal;
use meridian_core::turn::TurnOrigin as CoreTurnOrigin;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageDimension {
    Total,
    Provider,
    Model,
    Bot,
    Source,
    Conversation,
    Day,
    Hour,
    Kind,
}

impl From<UsageDimension> for CoreUsageDimension {
    fn from(dimension: UsageDimension) -> Self {
        match dimension {
            UsageDimension::Total => Self::Total,
            UsageDimension::Provider => Self::Provider,
            UsageDimension::Model => Self::Model,
            UsageDimension::Bot => Self::Bot,
            UsageDimension::Source => Self::Source,
            UsageDimension::Conversation => Self::Conversation,
            UsageDimension::Day => Self::Day,
            UsageDimension::Hour => Self::Hour,
            UsageDimension::Kind => Self::Kind,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnOrigin {
    Desktop,
    #[serde(rename = "onebot")]
    OneBot,
    SubAgent,
    PlanReview,
    ImplReview,
    ClaudeCode,
    UserShell,
}

impl From<TurnOrigin> for CoreTurnOrigin {
    fn from(origin: TurnOrigin) -> Self {
        match origin {
            TurnOrigin::Desktop => Self::Desktop,
            TurnOrigin::OneBot => Self::OneBot,
            TurnOrigin::SubAgent => Self::SubAgent,
            TurnOrigin::PlanReview => Self::PlanReview,
            TurnOrigin::ImplReview => Self::ImplReview,
            TurnOrigin::ClaudeCode => Self::ClaudeCode,
            TurnOrigin::UserShell => Self::UserShell,
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageReportRequest {
    pub dimension: UsageDimension,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    pub since_ms: Option<i64>,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    pub until_ms: Option<i64>,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    pub origin: Option<TurnOrigin>,
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    pub conversation_id: Option<String>,
}

impl UsageReportRequest {
    fn into_core(self) -> (CoreUsageDimension, CoreUsageFilter) {
        (
            self.dimension.into(),
            CoreUsageFilter {
                since_ms: self.since_ms,
                until_ms: self.until_ms,
                origin: self.origin.map(Into::into),
                conversation_id: self.conversation_id,
            },
        )
    }
}

/// One explicitly mapped row in a usage report.
///
/// `UsageBucket` is the core query accumulator. Keeping this response separate
/// means adding an implementation field to that accumulator cannot change IPC.
/// Decimal's serializer emits canonical JSON strings, never floating-point
/// numbers.
#[derive(Debug, Clone, serde::Serialize)]
pub struct UsageBucketInfoResponse {
    pub key: String,
    pub label: Option<String>,
    pub messages: i64,
    pub metered_messages: i64,
    pub subscription_messages: i64,
    pub external_messages: i64,
    pub missing_token_usage_messages: i64,
    pub incomplete_token_usage_messages: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub input_cost: Decimal,
    pub output_cost: Decimal,
    pub cache_cost: Decimal,
    pub tool_cost: Decimal,
    pub total_cost: Decimal,
    pub unpriced_token_messages: i64,
    pub unpriced_tool_messages: i64,
    pub estimated_token_messages: i64,
    pub estimated_tool_messages: i64,
    pub estimated_messages: i64,
    pub unpriced_messages: i64,
}

impl From<UsageBucket> for UsageBucketInfoResponse {
    fn from(bucket: UsageBucket) -> Self {
        Self {
            key: bucket.key,
            label: bucket.label,
            messages: bucket.messages,
            metered_messages: bucket.metered_messages,
            subscription_messages: bucket.subscription_messages,
            external_messages: bucket.external_messages,
            missing_token_usage_messages: bucket.missing_token_usage_messages,
            incomplete_token_usage_messages: bucket.incomplete_token_usage_messages,
            input_tokens: bucket.input_tokens,
            output_tokens: bucket.output_tokens,
            cache_read_tokens: bucket.cache_read_tokens,
            cache_write_tokens: bucket.cache_write_tokens,
            input_cost: bucket.input_cost,
            output_cost: bucket.output_cost,
            cache_cost: bucket.cache_cost,
            tool_cost: bucket.tool_cost,
            total_cost: bucket.total_cost,
            unpriced_token_messages: bucket.unpriced_token_messages,
            unpriced_tool_messages: bucket.unpriced_tool_messages,
            estimated_token_messages: bucket.estimated_token_messages,
            estimated_tool_messages: bucket.estimated_tool_messages,
            estimated_messages: bucket.estimated_messages,
            unpriced_messages: bucket.unpriced_messages,
        }
    }
}

pub type UsageBucketListResponse = Vec<UsageBucketInfoResponse>;

/// What was spent, grouped by one thing.
///
/// One command with a dimension rather than one per breakdown: the five
/// groupings and the two time series produce the same shape and differ only in
/// the key, and splitting them would make "the parts add up to the whole" a
/// coincidence between seven functions instead of a property of one.
///
/// `UsageDimension::Total` is how a caller asks for the headline figures. It is
/// the same query with a constant key, which is what stops a summary and the
/// breakdown beneath it from being computed two different ways.
#[tauri::command]
pub async fn usage_report(
    app: tauri::AppHandle,
    request: UsageReportRequest,
) -> Result<UsageBucketListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let (dimension, filter) = request.into_core();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        report(&mut conn, dimension, &filter)
            .map(|buckets| buckets.into_iter().map(Into::into).collect())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_response_maps_every_field_and_serializes_money_as_strings() {
        let bucket = UsageBucket {
            key: "provider".into(),
            label: Some("Provider".into()),
            messages: 1,
            metered_messages: 1,
            subscription_messages: 2,
            external_messages: 3,
            missing_token_usage_messages: 4,
            incomplete_token_usage_messages: 5,
            input_tokens: 6,
            output_tokens: 7,
            cache_read_tokens: 8,
            cache_write_tokens: 9,
            input_cost: "0.1".parse().unwrap(),
            output_cost: "0.2".parse().unwrap(),
            cache_cost: "0.3".parse().unwrap(),
            tool_cost: "0.4".parse().unwrap(),
            total_cost: "1".parse().unwrap(),
            unpriced_token_messages: 10,
            unpriced_tool_messages: 11,
            estimated_token_messages: 12,
            estimated_tool_messages: 13,
            estimated_messages: 14,
            unpriced_messages: 15,
        };

        let value = serde_json::to_value(UsageBucketInfoResponse::from(bucket)).unwrap();
        assert_eq!(value["total_cost"], "1");
        assert_eq!(value["tool_cost"], "0.4");
        assert_eq!(value["unpriced_messages"], 15);
        assert_eq!(value.as_object().unwrap().len(), 23);
    }

    #[test]
    fn usage_report_request_is_strict_and_maps_closed_enums() {
        let request: UsageReportRequest = serde_json::from_value(serde_json::json!({
            "dimension": "kind",
            "sinceMs": 10,
            "untilMs": null,
            "origin": "sub_agent",
            "conversationId": "conversation-1",
        }))
        .unwrap();
        let (dimension, filter) = request.into_core();
        assert_eq!(dimension, CoreUsageDimension::Kind);
        assert_eq!(filter.since_ms, Some(10));
        assert_eq!(filter.until_ms, None);
        assert_eq!(filter.origin, Some(CoreTurnOrigin::SubAgent));
        assert_eq!(filter.conversation_id.as_deref(), Some("conversation-1"));

        for invalid in [
            serde_json::json!({
                "dimension": "future",
                "sinceMs": null,
                "untilMs": null,
                "origin": null,
                "conversationId": null,
            }),
            serde_json::json!({
                "dimension": "total",
                "sinceMs": null,
                "untilMs": null,
                "origin": null,
                "conversationId": null,
                "legacyFilter": true,
            }),
            serde_json::json!({
                "dimension": "total",
                "untilMs": null,
                "origin": null,
                "conversationId": null,
            }),
        ] {
            assert!(serde_json::from_value::<UsageReportRequest>(invalid).is_err());
        }
    }
}
