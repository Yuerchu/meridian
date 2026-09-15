//! Configuring where balance and usage alerts go.
//!
//! Every command here is `local`, and for the same reason `acp_save_config` is:
//! the URL decides where alerts — which name providers and amounts of money —
//! are sent, and the signing secret is a credential. A remote caller able to
//! write the URL redirects the alerts. That is not the self-lockout the rest of
//! the `local` list guards against.
//!
//! The secret never comes back out. `NotificationWebhookInfoResponse` carries
//! `has_secret`, because a settings page needs to know whether one is set and
//! nothing needs to know what it is.

use tauri::Manager;

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;
use meridian_core::db::models::notification::{
    MAX_WEBHOOKS, NotificationEventKind, NotificationFormat, NotificationWebhookChangeset, NotificationWebhookInsert,
    NotificationWebhookRow, encode_events,
};
use meridian_core::notify;

#[derive(Debug, serde::Serialize)]
pub struct NotifyConfigInfoResponse {
    pub enabled: bool,
    pub balance_threshold: Option<meridian_core::decimal::Decimal>,
    pub balance_interval_minutes: u32,
    pub usage_enabled: bool,
    pub usage_check_interval_minutes: u32,
    pub usage_window_hours: u32,
    pub usage_baseline_days: u32,
    pub usage_multiplier: meridian_core::decimal::Decimal,
    pub usage_min_cost: meridian_core::decimal::Decimal,
    pub usage_cooldown_minutes: u32,
    pub running: bool,
}

/// The complete notification settings document accepted by IPC.
///
/// Every key is required, and the nullable one uses [`RequiredNullable`] so
/// omitting it cannot silently switch balance alerting off.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotifyConfigUpdateRequest {
    pub enabled: bool,
    pub balance_threshold: RequiredNullable<meridian_core::decimal::Decimal>,
    pub balance_interval_minutes: u32,
    pub usage_enabled: bool,
    pub usage_check_interval_minutes: u32,
    pub usage_window_hours: u32,
    pub usage_baseline_days: u32,
    pub usage_multiplier: meridian_core::decimal::Decimal,
    pub usage_min_cost: meridian_core::decimal::Decimal,
    pub usage_cooldown_minutes: u32,
}

impl TryFrom<NotifyConfigUpdateRequest> for notify::NotifyConfig {
    type Error = String;

    fn try_from(request: NotifyConfigUpdateRequest) -> Result<Self, Self::Error> {
        let balance_threshold = request
            .balance_threshold
            .0
            .map(|value| value.require_non_negative("balance_threshold"))
            .transpose()
            .map_err(|error| error.to_string())?;
        let config = Self {
            enabled: request.enabled,
            balance_threshold,
            balance_interval_minutes: request.balance_interval_minutes,
            usage_enabled: request.usage_enabled,
            usage_check_interval_minutes: request.usage_check_interval_minutes,
            usage_window_hours: request.usage_window_hours,
            usage_baseline_days: request.usage_baseline_days,
            usage_multiplier: request
                .usage_multiplier
                .require_non_negative("usage_multiplier")
                .map_err(|error| error.to_string())?,
            usage_min_cost: request
                .usage_min_cost
                .require_non_negative("usage_min_cost")
                .map_err(|error| error.to_string())?,
            usage_cooldown_minutes: request.usage_cooldown_minutes,
        };
        // The same bounds `save_config` enforces, applied here so the caller
        // gets the exact contract error rather than a save that half happened.
        notify::validate(&config)?;
        Ok(config)
    }
}

#[derive(Debug, serde::Serialize)]
pub struct NotificationWebhookInfoResponse {
    pub id: String,
    pub name: String,
    pub url: String,
    pub format: NotificationFormat,
    pub events: Vec<NotificationEventKind>,
    pub is_enabled: bool,
    /// Whether a signing secret is on file. Never the secret itself.
    pub has_secret: bool,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
    pub consecutive_failures: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

impl NotificationWebhookInfoResponse {
    /// The row's JSON columns are decoded here, and a failure fails the
    /// boundary. A stored subscription that will not parse is a contract
    /// violation, not a request to hand back an empty list.
    fn build(row: NotificationWebhookRow, has_secret: bool) -> Result<Self, String> {
        Ok(Self {
            format: row.format()?,
            events: row.events()?,
            is_enabled: row.is_enabled(),
            has_secret,
            id: row.id,
            name: row.name,
            url: row.url,
            last_attempt_at: row.last_attempt_at,
            last_success_at: row.last_success_at,
            last_error: row.last_error,
            consecutive_failures: row.consecutive_failures,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

#[derive(Debug, serde::Serialize)]
pub struct NotificationWebhookListResponse {
    pub webhooks: Vec<NotificationWebhookInfoResponse>,
}

#[derive(Debug, serde::Serialize)]
pub struct WebhookDeliveryInfoResponse {
    pub ok: bool,
    pub status: Option<u16>,
    pub duration_ms: u64,
    pub attempts: u32,
    pub error: Option<String>,
    pub response_excerpt: Option<String>,
}

impl From<notify::DeliveryReport> for WebhookDeliveryInfoResponse {
    fn from(report: notify::DeliveryReport) -> Self {
        Self {
            ok: report.is_success(),
            status: report.status,
            duration_ms: report.duration_ms,
            attempts: report.attempts,
            error: report.error,
            response_excerpt: report.response_excerpt,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationWebhookCreateRequest {
    pub name: String,
    pub url: String,
    pub format: NotificationFormat,
    pub events: Vec<NotificationEventKind>,
    pub is_enabled: bool,
    pub secret: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationWebhookUpdateRequest {
    pub id: String,
    pub name: String,
    pub url: String,
    pub format: NotificationFormat,
    pub events: Vec<NotificationEventKind>,
    pub is_enabled: bool,
    /// `null` clears the secret; a value replaces it.
    ///
    /// There is no third state meaning "leave it alone", which would need the
    /// caller to distinguish an absent key from a null one — the exact
    /// ambiguity `RequiredNullable` exists to remove everywhere else. A
    /// settings page that does not want to change the secret sends back what
    /// `has_secret` told it, which is a decision rather than an omission.
    pub secret: RequiredNullable<String>,
}

#[tauri::command]
pub async fn get_notify_config(app: tauri::AppHandle) -> Result<NotifyConfigInfoResponse, String> {
    let services = app.services();
    let config = notify::load_config(&services.db)?;
    let running = {
        let watcher = app.state::<notify::AppNotify>();
        let server = watcher.0.lock().await;
        server.is_running()
    };
    Ok(NotifyConfigInfoResponse {
        enabled: config.enabled,
        balance_threshold: config.balance_threshold,
        balance_interval_minutes: config.balance_interval_minutes,
        usage_enabled: config.usage_enabled,
        usage_check_interval_minutes: config.usage_check_interval_minutes,
        usage_window_hours: config.usage_window_hours,
        usage_baseline_days: config.usage_baseline_days,
        usage_multiplier: config.usage_multiplier,
        usage_min_cost: config.usage_min_cost,
        usage_cooldown_minutes: config.usage_cooldown_minutes,
        running,
    })
}

/// Save, then restart the watcher so the new settings are in force.
///
/// Stopped to completion before the next one starts. Two generations polling
/// at once means two requests against the same upstream and two alerts for one
/// condition — the lesson `start_onebot` already carries.
#[tauri::command]
pub async fn save_notify_config(app: tauri::AppHandle, request: NotifyConfigUpdateRequest) -> Result<(), String> {
    let services = app.services();
    let config = notify::NotifyConfig::try_from(request)?;
    notify::save_config(&services.db, &config)?;

    let watcher = app.state::<notify::AppNotify>();
    let mut server = watcher.0.lock().await;
    server.stop().await;
    let replacement = notify::NotifyServer::new(services, config);
    if replacement.config().enabled {
        replacement.start().await?;
    }
    *server = replacement;
    Ok(())
}

#[tauri::command]
pub async fn list_notification_webhooks(app: tauri::AppHandle) -> Result<NotificationWebhookListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    let rows = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|error| error.to_string())?;
        meridian_core::db::ops::notification::list_webhooks(&mut conn).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;

    let webhooks = rows
        .into_iter()
        .map(|row| {
            let has_secret = notify::read_webhook_secret(&services.secrets, &row.id).is_some();
            NotificationWebhookInfoResponse::build(row, has_secret)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(NotificationWebhookListResponse { webhooks })
}

#[tauri::command]
pub async fn create_notification_webhook(
    app: tauri::AppHandle,
    request: NotificationWebhookCreateRequest,
) -> Result<NotificationWebhookInfoResponse, String> {
    notify::validate_endpoint(&request.name, &request.url, &request.events)?;
    let services = app.services();
    let id = uuid::Uuid::new_v4().to_string();
    let events = encode_events(&request.events)?;
    let now = meridian_core::util::now_ms();

    let pool = services.db.clone();
    let row = {
        let id = id.clone();
        let name = request.name.clone();
        let url = request.url.clone();
        let format = request.format.as_str();
        let is_enabled = i32::from(request.is_enabled);
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|error| error.to_string())?;
            if meridian_core::db::ops::notification::count_webhooks(&mut conn).map_err(|e| e.to_string())?
                >= MAX_WEBHOOKS as i64
            {
                return Err(format!("at most {MAX_WEBHOOKS} notification endpoints are supported"));
            }
            meridian_core::db::ops::notification::create_webhook(
                &mut conn,
                &NotificationWebhookInsert {
                    id: &id,
                    name: &name,
                    url: &url,
                    format,
                    events: &events,
                    is_enabled,
                    created_at: now,
                    updated_at: now,
                },
            )
            .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())??
    };

    // After the row, so a keyring failure cannot leave a secret behind for an
    // id nothing points at.
    notify::write_webhook_secret(&services.secrets, &id, request.secret.0.as_deref())?;
    let has_secret = request.secret.0.is_some_and(|secret| !secret.is_empty());
    NotificationWebhookInfoResponse::build(row, has_secret)
}

#[tauri::command]
pub async fn update_notification_webhook(
    app: tauri::AppHandle,
    request: NotificationWebhookUpdateRequest,
) -> Result<NotificationWebhookInfoResponse, String> {
    notify::validate_endpoint(&request.name, &request.url, &request.events)?;
    let services = app.services();
    let events = encode_events(&request.events)?;
    let now = meridian_core::util::now_ms();

    let pool = services.db.clone();
    let row = {
        let id = request.id.clone();
        let changeset = NotificationWebhookChangeset {
            name: Some(request.name.clone()),
            url: Some(request.url.clone()),
            format: Some(request.format.as_str().to_string()),
            events: Some(events),
            is_enabled: Some(i32::from(request.is_enabled)),
            updated_at: Some(now),
        };
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|error| error.to_string())?;
            meridian_core::db::ops::notification::update_webhook(&mut conn, &id, &changeset)
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())??
    };

    notify::write_webhook_secret(&services.secrets, &request.id, request.secret.0.as_deref())?;
    let has_secret = request.secret.0.is_some_and(|secret| !secret.is_empty());
    NotificationWebhookInfoResponse::build(row, has_secret)
}

#[tauri::command]
pub async fn delete_notification_webhook(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let row_id = id.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|error| error.to_string())?;
        meridian_core::db::ops::notification::delete_webhook(&mut conn, &row_id).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;

    // After the row is gone: a keyring entry with no row is unreachable, while
    // a row with no secret would silently send unsigned requests to a vendor
    // that requires a signature.
    notify::write_webhook_secret(&services.secrets, &id, None)
}

/// Send one test alert to one endpoint.
///
/// The only way to find out whether a vendor's signing scheme was implemented
/// correctly: the failure mode otherwise is a robot that answers HTTP 200 and
/// drops every message.
#[tauri::command]
pub async fn test_notification_webhook(
    app: tauri::AppHandle,
    id: String,
) -> Result<WebhookDeliveryInfoResponse, String> {
    let services = app.services();
    notify::send_test(&services, &id).await.map(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config_request() -> serde_json::Value {
        json!({
            "enabled": true,
            "balance_threshold": null,
            "balance_interval_minutes": 360,
            "usage_enabled": true,
            "usage_check_interval_minutes": 15,
            "usage_window_hours": 1,
            "usage_baseline_days": 7,
            "usage_multiplier": "3",
            "usage_min_cost": "1",
            "usage_cooldown_minutes": 360
        })
    }

    #[test]
    fn the_config_request_requires_every_key_and_rejects_unknown_ones() {
        let parsed = serde_json::from_value::<NotifyConfigUpdateRequest>(config_request()).unwrap();
        assert!(notify::NotifyConfig::try_from(parsed).is_ok());

        for key in config_request().as_object().unwrap().keys() {
            let mut missing = config_request();
            missing.as_object_mut().unwrap().remove(key);
            assert!(
                serde_json::from_value::<NotifyConfigUpdateRequest>(missing).is_err(),
                "{key} must be present"
            );
        }

        let mut unknown = config_request();
        unknown["legacy_field"] = json!(true);
        assert!(serde_json::from_value::<NotifyConfigUpdateRequest>(unknown).is_err());
    }

    /// Money crosses IPC as an exact decimal string. A JSON number has already
    /// been through a `f64` by the time it gets here.
    #[test]
    fn money_keys_refuse_a_json_number() {
        for key in ["usage_multiplier", "usage_min_cost", "balance_threshold"] {
            let mut numeric = config_request();
            numeric[key] = json!(2.5);
            assert!(
                serde_json::from_value::<NotifyConfigUpdateRequest>(numeric).is_err(),
                "{key} must be a decimal string"
            );
        }
    }

    /// The bounds are the core's, applied at the boundary so a rejected save
    /// says exactly which field was wrong.
    #[test]
    fn the_bounds_are_enforced_before_anything_is_written() {
        let mut low = config_request();
        low["usage_multiplier"] = json!("0.5");
        let parsed = serde_json::from_value::<NotifyConfigUpdateRequest>(low).unwrap();
        let error = notify::NotifyConfig::try_from(parsed).unwrap_err();
        assert!(error.contains("multiplier"), "{error}");

        let mut negative = config_request();
        negative["balance_threshold"] = json!("-1");
        let parsed = serde_json::from_value::<NotifyConfigUpdateRequest>(negative).unwrap();
        assert!(notify::NotifyConfig::try_from(parsed).is_err());

        let mut zero_window = config_request();
        zero_window["usage_window_hours"] = json!(0);
        let parsed = serde_json::from_value::<NotifyConfigUpdateRequest>(zero_window).unwrap();
        assert!(notify::NotifyConfig::try_from(parsed).is_err());
    }

    fn webhook_request() -> serde_json::Value {
        json!({
            "name": "运维群",
            "url": "https://example.invalid/hook",
            "format": "dingtalk",
            "events": ["balance_low", "usage_surge"],
            "is_enabled": true,
            "secret": null
        })
    }

    #[test]
    fn an_endpoint_request_is_strict_about_its_enums() {
        assert!(serde_json::from_value::<NotificationWebhookCreateRequest>(webhook_request()).is_ok());

        let mut bad_format = webhook_request();
        bad_format["format"] = json!("teams");
        assert!(serde_json::from_value::<NotificationWebhookCreateRequest>(bad_format).is_err());

        let mut bad_event = webhook_request();
        bad_event["events"] = json!(["balance_low", "everything"]);
        assert!(serde_json::from_value::<NotificationWebhookCreateRequest>(bad_event).is_err());

        let mut missing_secret = webhook_request();
        missing_secret.as_object_mut().unwrap().remove("secret");
        assert!(
            serde_json::from_value::<NotificationWebhookCreateRequest>(missing_secret).is_err(),
            "omitting the secret must not be a second spelling of clearing it"
        );
    }

    // The endpoint rules themselves live in `notify::validate_endpoint`, with
    // their tests, because the URL parser is there with the client that uses it.

    /// The response is built from the row, and the row's JSON column is the one
    /// place this can fail. It fails the boundary rather than reporting an
    /// endpoint that is subscribed to nothing.
    #[test]
    fn an_unreadable_subscription_fails_the_response() {
        let row = NotificationWebhookRow {
            id: "w1".into(),
            name: "x".into(),
            url: "https://a.invalid/h".into(),
            format: "generic".into(),
            events: "not json".into(),
            is_enabled: 1,
            last_attempt_at: None,
            last_success_at: None,
            last_error: None,
            consecutive_failures: 0,
            created_at: 1,
            updated_at: 1,
        };
        assert!(NotificationWebhookInfoResponse::build(row, false).is_err());
    }

    #[test]
    fn the_response_never_carries_the_secret() {
        let row = NotificationWebhookRow {
            id: "w1".into(),
            name: "x".into(),
            url: "https://a.invalid/h".into(),
            format: "generic".into(),
            events: r#"["test"]"#.into(),
            is_enabled: 1,
            last_attempt_at: None,
            last_success_at: None,
            last_error: None,
            consecutive_failures: 0,
            created_at: 1,
            updated_at: 1,
        };
        let response = NotificationWebhookInfoResponse::build(row, true).unwrap();
        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["has_secret"], json!(true));
        assert!(json.get("secret").is_none());
    }
}
