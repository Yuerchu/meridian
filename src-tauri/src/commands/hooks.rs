use tauri::Manager;

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;
use meridian_core::hooks;

#[derive(Debug, serde::Serialize)]
pub struct HookConfigInfoResponse {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub token: Option<String>,
    pub review_model: Option<String>,
    pub assistant_id: Option<String>,
    pub timeout_secs: u32,
    pub max_rounds: u32,
}

impl From<hooks::HookConfig> for HookConfigInfoResponse {
    fn from(config: hooks::HookConfig) -> Self {
        Self {
            enabled: config.enabled,
            host: config.host,
            port: config.port,
            token: config.token,
            review_model: config.review_model,
            assistant_id: config.assistant_id,
            timeout_secs: config.timeout_secs,
            max_rounds: config.max_rounds,
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct HookStatusInfoResponse {
    pub enabled: bool,
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub handshake_path: Option<String>,
}

impl From<hooks::HookStatus> for HookStatusInfoResponse {
    fn from(status: hooks::HookStatus) -> Self {
        Self {
            enabled: status.enabled,
            running: status.running,
            host: status.host,
            port: status.port,
            handshake_path: status.handshake_path,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HookConfigUpdateRequest {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub token: RequiredNullable<String>,
    pub review_model: RequiredNullable<String>,
    pub assistant_id: RequiredNullable<String>,
    pub timeout_secs: u32,
    pub max_rounds: u32,
}

impl From<HookConfigUpdateRequest> for hooks::HookConfig {
    fn from(config: HookConfigUpdateRequest) -> Self {
        Self {
            enabled: config.enabled,
            host: config.host,
            port: config.port,
            token: config.token.0,
            review_model: config.review_model.0,
            assistant_id: config.assistant_id.0,
            timeout_secs: config.timeout_secs,
            max_rounds: config.max_rounds,
        }
    }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_hooks_status(app: tauri::AppHandle) -> Result<HookStatusInfoResponse, String> {
    let state = app.state::<hooks::AppHooks>();
    let server = state.0.lock().await;
    Ok(server.status().into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_hooks_config(app: tauri::AppHandle) -> Result<HookConfigInfoResponse, String> {
    let services = app.services();
    hooks::load_config(&services.db).map(Into::into)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn save_hooks_config(
    app: tauri::AppHandle,
    request: HookConfigUpdateRequest,
) -> Result<HookConfigInfoResponse, String> {
    let services = app.services();
    let config = hooks::HookConfig::from(request);
    // Minted here rather than in the settings page: the page would have to send
    // it back on every save, and a token that travels twice is a token that can
    // be pasted into a screenshot twice.
    let config = hooks::HookConfig {
        token: match config.token.filter(|t| !t.is_empty()) {
            Some(existing) => Some(existing),
            None => Some(meridian_core::listen_guard::generate_token()),
        },
        ..config
    };
    hooks::save_config(&services.db, &config)?;
    apply_to_running(&app).await?;
    // Read back rather than echoing what came in: `save_config` clamps, so what
    // is stored is not always what was sent.
    hooks::load_config(&services.db).map(Into::into)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn regenerate_hooks_token(app: tauri::AppHandle) -> Result<String, String> {
    let services = app.services();
    let token = meridian_core::listen_guard::generate_token();
    let config = hooks::HookConfig {
        token: Some(token.clone()),
        ..hooks::load_config(&services.db)?
    };
    hooks::save_config(&services.db, &config)?;
    // Otherwise the running server keeps checking the old token and the
    // handshake file keeps advertising it — the new one would be a value in the
    // database that nothing honours.
    apply_to_running(&app).await?;
    Ok(token)
}

/// Rebuild the server from stored config, but only if one is actually running.
///
/// `SharedState.config` is a snapshot taken when the server was built, so
/// writing preferences alone changes nothing that is serving requests. That
/// used to be invisible: fill in the review model, press save, and the endpoint
/// went on answering "no review model configured" from a snapshot taken minutes
/// earlier.
///
/// Cheap to do now that a review conversation is named by the client rather
/// than by an in-memory table — a restart costs the socket and nothing else.
#[cfg(not(target_os = "android"))]
async fn apply_to_running(app: &tauri::AppHandle) -> Result<(), String> {
    let should = {
        let state = app.state::<hooks::AppHooks>();
        let guard = state.0.lock().await;
        guard.is_running()
    };
    if !should {
        return Ok(());
    }
    restart(app).await
}

/// Stop whatever is there and put a freshly configured server in its place.
///
/// The old instance has to go first so its accept loop exits and releases the
/// listener, rather than hot-spinning on a closed shutdown channel while
/// holding the port. The pause lets the socket free up; the handshake file is
/// safe across it because each generation only deletes the file it wrote.
#[cfg(not(target_os = "android"))]
async fn restart(app: &tauri::AppHandle) -> Result<(), String> {
    let services = app.services();
    let config = hooks::load_config(&services.db)?;

    let state = app.state::<hooks::AppHooks>();
    let mut guard = state.0.lock().await;

    guard.stop();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // The services are the desktop's own. A coordinator rebuilt here would
    // forget which conversations desktop turns are currently holding.
    let server = hooks::HookServer::new(services, config);
    server.start()?;
    *guard = server;
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn start_hooks(app: tauri::AppHandle) -> Result<(), String> {
    restart(&app).await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn stop_hooks(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<hooks::AppHooks>();
    let server = state.0.lock().await;
    server.stop();
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
            "port": 8765,
            "token": null,
            "review_model": null,
            "assistant_id": null,
            "timeout_secs": 600,
            "max_rounds": 5
        })
    }

    #[test]
    fn hook_config_request_requires_nullable_keys_and_rejects_unknown_fields() {
        assert!(serde_json::from_value::<HookConfigUpdateRequest>(request()).is_ok());

        for key in ["token", "review_model", "assistant_id"] {
            let mut missing = request();
            missing.as_object_mut().unwrap().remove(key);
            assert!(
                serde_json::from_value::<HookConfigUpdateRequest>(missing).is_err(),
                "{key} must be present"
            );
        }

        let mut unknown = request();
        unknown["review_provider"] = json!("openai");
        assert!(serde_json::from_value::<HookConfigUpdateRequest>(unknown).is_err());
    }

    #[test]
    fn hook_status_is_projected_into_the_shell_response() {
        let response = HookStatusInfoResponse::from(hooks::HookStatus {
            enabled: true,
            running: false,
            host: "127.0.0.1".into(),
            port: 8765,
            handshake_path: Some("C:/tmp/hooks.json".into()),
        });

        assert_eq!(
            serde_json::to_value(response).unwrap(),
            json!({
                "enabled": true,
                "running": false,
                "host": "127.0.0.1",
                "port": 8765,
                "handshake_path": "C:/tmp/hooks.json"
            })
        );
    }
}
