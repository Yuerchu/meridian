use tauri::Manager;

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;
use meridian_core::onebot;

#[derive(Debug, serde::Serialize)]
pub struct OneBotConfigInfoResponse {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub access_token: Option<String>,
    pub assistant_id: Option<String>,
    pub admin_users: Vec<i64>,
    pub ack_emoji_id: String,
    // The balance threshold used to be here. It is `notify.balance.threshold`
    // now — one threshold, because the watcher that reads it no longer lives
    // inside the chat server and QQ is one outlet among several. See migration
    // 55, which carries an existing value across.
    pub voice_capture_sessions: Vec<String>,
    pub voice_send_enabled: bool,
    pub voice_send_groups: Vec<String>,
    pub voice_tts_model: String,
    pub voice_tts_reference_id: String,
}

impl From<onebot::OneBotConfig> for OneBotConfigInfoResponse {
    fn from(config: onebot::OneBotConfig) -> Self {
        Self {
            enabled: config.enabled,
            host: config.host,
            port: config.port,
            access_token: config.access_token,
            assistant_id: config.assistant_id,
            admin_users: config.admin_users,
            ack_emoji_id: config.ack_emoji_id,
            voice_capture_sessions: config.voice_capture_sessions,
            voice_send_enabled: config.voice_send_enabled,
            voice_send_groups: config.voice_send_groups,
            voice_tts_model: config.voice_tts_model,
            voice_tts_reference_id: config.voice_tts_reference_id,
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct OneBotStatusInfoResponse {
    pub enabled: bool,
    pub running: bool,
    pub connected_clients: u32,
    pub host: String,
    pub port: u16,
}

impl From<onebot::OneBotStatus> for OneBotStatusInfoResponse {
    fn from(status: onebot::OneBotStatus) -> Self {
        Self {
            enabled: status.enabled,
            running: status.running,
            connected_clients: status.connected_clients,
            host: status.host,
            port: status.port,
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct VoiceSendReadinessInfoResponse {
    pub enabled: bool,
    pub has_model: bool,
    pub has_reference_id: bool,
    pub has_api_key: bool,
    pub ready: bool,
}

impl From<onebot::VoiceSendReadiness> for VoiceSendReadinessInfoResponse {
    fn from(readiness: onebot::VoiceSendReadiness) -> Self {
        Self {
            enabled: readiness.enabled,
            has_model: readiness.has_model,
            has_reference_id: readiness.has_reference_id,
            has_api_key: readiness.has_api_key,
            ready: readiness.ready,
        }
    }
}

/// The complete OneBot settings document accepted by IPC.
///
/// Every key is required. In particular, nullable values use
/// [`RequiredNullable`] so omitting a key cannot silently clear it.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OneBotConfigUpdateRequest {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub access_token: RequiredNullable<String>,
    pub assistant_id: RequiredNullable<String>,
    pub admin_users: Vec<i64>,
    pub ack_emoji_id: String,
    pub voice_capture_sessions: Vec<String>,
    pub voice_send_enabled: bool,
    pub voice_send_groups: Vec<String>,
    pub voice_tts_model: String,
    pub voice_tts_reference_id: String,
}

impl TryFrom<OneBotConfigUpdateRequest> for onebot::OneBotConfig {
    type Error = String;

    fn try_from(config: OneBotConfigUpdateRequest) -> Result<Self, Self::Error> {
        Ok(Self {
            enabled: config.enabled,
            host: config.host,
            port: config.port,
            access_token: config.access_token.0,
            assistant_id: config.assistant_id.0,
            admin_users: config.admin_users,
            ack_emoji_id: config.ack_emoji_id,
            voice_capture_sessions: config.voice_capture_sessions,
            voice_send_enabled: config.voice_send_enabled,
            voice_send_groups: config.voice_send_groups,
            voice_tts_model: config.voice_tts_model,
            voice_tts_reference_id: config.voice_tts_reference_id,
        })
    }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_onebot_status(app: tauri::AppHandle) -> Result<OneBotStatusInfoResponse, String> {
    let ob = app.state::<onebot::AppOneBot>();
    let server = ob.0.lock().await;
    Ok(server.status().into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_onebot_config(app: tauri::AppHandle) -> Result<OneBotConfigInfoResponse, String> {
    let services = app.services();
    onebot::load_config(&services.db).map(Into::into)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn save_onebot_config(app: tauri::AppHandle, request: OneBotConfigUpdateRequest) -> Result<(), String> {
    let services = app.services();
    let config = onebot::OneBotConfig::try_from(request)?;
    onebot::save_config(&services.db, &config)?;

    // 语音策略立刻生效，不等重启。
    //
    // 这是这个功能的及格线，不是便利：把一个群从采集白名单里拿掉之后，跑着的
    // 服务如果还在录，那这个开关就是个摆设。`apply` 会为被移除的范围立屏障、
    // 等在途采集归还 permit，然后才返回——所以这个命令返回时，"不再新增"是
    // 已经成立的事实。
    //
    // 只有语音策略是热的。同一页上的 host / token / admin 仍然是启动快照,
    // UI 的成功提示不能暗示它们也生效了。
    //
    // 失败要报出去。这一步读 opt-out 名单和钥匙串，两者都可能失败，而失败之后
    // 配置已经写进库了——不说的话，用户看到的是一次成功的保存加上一个什么都
    // 没变的会话。
    onebot::refresh_voice_policy(&services, &config).await
}

/// 出站语音差哪一项。设置页照着它说话——四项之中缺哪个只有后端知道，而这个
/// 功能唯一一种"什么都不说"的失败就是开关开着、工具不出现。
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_voice_send_readiness(app: tauri::AppHandle) -> Result<VoiceSendReadinessInfoResponse, String> {
    let services = app.services();
    let config = onebot::load_config(&services.db)?;
    Ok(onebot::voice_send_readiness(&services, &config).into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn start_onebot(app: tauri::AppHandle) -> Result<(), String> {
    let services = app.services();
    let config = onebot::load_config(&services.db)?;

    let ob = app.state::<onebot::AppOneBot>();
    let mut server_guard = ob.0.lock().await;

    // Stop the previous instance before replacing it so its accept loop exits and
    // releases the listener, instead of hot-spinning on a closed shutdown channel
    // and keeping the old port/token alive. Brief pause lets the socket free up.
    server_guard.stop().await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Recreate server with fresh config. The services are the desktop's own —
    // restarting OneBot rebuilds everything in its shared state, and a
    // coordinator rebuilt with it would forget the conversations desktop turns
    // are holding.
    let new_server = onebot::OneBotServer::new(services, config);
    new_server.start()?;
    *server_guard = new_server;
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn stop_onebot(app: tauri::AppHandle) -> Result<(), String> {
    let ob = app.state::<onebot::AppOneBot>();
    let server = ob.0.lock().await;
    server.stop().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request() -> serde_json::Value {
        json!({
            "enabled": false,
            "host": "127.0.0.1",
            "port": 6700,
            "access_token": null,
            "assistant_id": null,
            "admin_users": [],
            "ack_emoji_id": "76",
            "voice_capture_sessions": [],
            "voice_send_enabled": false,
            "voice_send_groups": [],
            "voice_tts_model": "",
            "voice_tts_reference_id": ""
        })
    }

    #[test]
    fn onebot_config_request_requires_nullable_keys_and_rejects_unknown_fields() {
        assert!(serde_json::from_value::<OneBotConfigUpdateRequest>(request()).is_ok());

        // The balance threshold moved to `save_notify_config`; sending it here
        // is now an unknown field rather than a value this command ignores.
        let mut moved = request();
        moved["balance_alert_threshold"] = json!("1.25");
        assert!(serde_json::from_value::<OneBotConfigUpdateRequest>(moved).is_err());

        for key in ["access_token", "assistant_id"] {
            let mut missing = request();
            missing.as_object_mut().unwrap().remove(key);
            assert!(
                serde_json::from_value::<OneBotConfigUpdateRequest>(missing).is_err(),
                "{key} must be present"
            );
        }

        let mut unknown = request();
        unknown["legacy_field"] = json!(true);
        assert!(serde_json::from_value::<OneBotConfigUpdateRequest>(unknown).is_err());
    }

    #[test]
    fn onebot_status_is_projected_into_the_shell_response() {
        let response = OneBotStatusInfoResponse::from(onebot::OneBotStatus {
            enabled: true,
            running: true,
            connected_clients: 2,
            host: "127.0.0.1".into(),
            port: 6700,
        });

        assert_eq!(
            serde_json::to_value(response).unwrap(),
            json!({
                "enabled": true,
                "running": true,
                "connected_clients": 2,
                "host": "127.0.0.1",
                "port": 6700
            })
        );
    }

    #[test]
    fn voice_send_readiness_is_projected_into_the_shell_response() {
        let response = VoiceSendReadinessInfoResponse::from(onebot::VoiceSendReadiness {
            enabled: true,
            has_model: true,
            has_reference_id: false,
            has_api_key: true,
            ready: false,
        });

        assert_eq!(
            serde_json::to_value(response).unwrap(),
            json!({
                "enabled": true,
                "has_model": true,
                "has_reference_id": false,
                "has_api_key": true,
                "ready": false
            })
        );
    }
}
