//! Turning remote access on, and telling the user where to point their phone.

use meridian_core::listen_guard::generate_token;
use tauri::Manager;

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;
use crate::remote::{AppRemote, ListenConfig, RemoteServer, RemoteStatusResponse, load_config, save_config};

#[derive(Debug, serde::Serialize)]
pub struct RemoteConfigInfoResponse {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub token: Option<String>,
}

impl From<ListenConfig> for RemoteConfigInfoResponse {
    fn from(config: ListenConfig) -> Self {
        Self {
            enabled: config.enabled,
            host: config.host,
            port: config.port,
            token: config.token,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoteConfigUpdateRequest {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub token: RequiredNullable<String>,
}

impl From<RemoteConfigUpdateRequest> for ListenConfig {
    fn from(config: RemoteConfigUpdateRequest) -> Self {
        Self {
            enabled: config.enabled,
            host: config.host,
            port: config.port,
            token: config.token.0,
        }
    }
}

#[tauri::command]
pub async fn get_remote_status(app: tauri::AppHandle) -> Result<RemoteStatusResponse, String> {
    Ok(app.state::<AppRemote>().0.lock().await.status())
}

#[tauri::command]
pub async fn get_remote_config(app: tauri::AppHandle) -> Result<RemoteConfigInfoResponse, String> {
    Ok(app.state::<AppRemote>().0.lock().await.config().clone().into())
}

/// Save, and bring the running server into line with what was saved.
///
/// The token is minted here rather than in the UI, and only when enabling
/// without one: a user who has never turned this on has no token, and asking
/// them to invent one is asking for `1234`.
#[tauri::command]
pub async fn set_remote_config(
    app: tauri::AppHandle,
    request: RemoteConfigUpdateRequest,
) -> Result<RemoteConfigInfoResponse, String> {
    let services = app.services();
    let mut config = ListenConfig::from(request);
    if config.enabled && config.token.as_deref().unwrap_or("").is_empty() {
        config.token = Some(generate_token());
    }
    save_config(&services.db, &config).await?;
    restart(&app, config.clone()).await?;
    Ok(config.into())
}

/// Mint a new token, which disconnects every device using the old one.
#[tauri::command]
pub async fn reset_remote_token(app: tauri::AppHandle) -> Result<RemoteConfigInfoResponse, String> {
    let services = app.services();
    let mut config = load_config(&services.db).await?;
    config.token = Some(generate_token());
    save_config(&services.db, &config).await?;
    restart(&app, config.clone()).await?;
    Ok(config.into())
}

#[tauri::command]
pub async fn start_remote(app: tauri::AppHandle) -> Result<RemoteStatusResponse, String> {
    let services = app.services();
    let mut config = load_config(&services.db).await?;
    config.enabled = true;
    if config.token.as_deref().unwrap_or("").is_empty() {
        config.token = Some(generate_token());
    }
    save_config(&services.db, &config).await?;
    restart(&app, config).await
}

#[tauri::command]
pub async fn stop_remote(app: tauri::AppHandle) -> Result<RemoteStatusResponse, String> {
    let services = app.services();
    let mut config = load_config(&services.db).await?;
    config.enabled = false;
    save_config(&services.db, &config).await?;
    restart(&app, config).await
}

pub type RemoteAddressesResponse = Vec<String>;

/// The addresses a second device could dial.
///
/// Without this the user has to go and find their own IP, which on Windows
/// means reading `ipconfig` output that lists six adapters. Returned newest
/// interface first is not worth the trouble — they are shown as a list and the
/// user picks the one their phone is on.
#[tauri::command]
pub fn list_remote_addresses(_app: tauri::AppHandle) -> Result<RemoteAddressesResponse, String> {
    Ok(local_addresses())
}

fn local_addresses() -> Vec<String> {
    // Deliberately not a dependency: one UDP socket that never sends anything
    // makes the OS pick the interface it would route over, which is the one the
    // phone is most likely to reach. Everything else on the machine is noise --
    // loopback, virtual switches, VPN adapters that are down.
    let mut out = Vec::new();
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        // No packet is sent by `connect` on UDP; it only sets the peer, which
        // is enough to make `local_addr` resolve through the routing table.
        if sock.connect("8.8.8.8:80").is_ok()
            && let Ok(addr) = sock.local_addr()
        {
            out.push(addr.ip().to_string());
        }
    }
    // Tailscale and the like will not be picked by the route above unless they
    // are the default, so offer the hostname as well: it resolves on the other
    // device more often than an address stays valid.
    if let Ok(name) = hostname() {
        out.push(name);
    }
    out.dedup();
    out
}

fn hostname() -> Result<String, String> {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .map_err(|e| e.to_string())
}

/// Stop whatever is running and start what the config now says.
///
/// The pause is the port: a listener that has just been dropped is not
/// immediately re-bindable, and without it the restart fails with "address in
/// use" for a server that is on its way out. Same 300ms the hook server uses.
async fn restart(app: &tauri::AppHandle, config: ListenConfig) -> Result<RemoteStatusResponse, String> {
    let services = app.services();
    let holder = app.state::<AppRemote>();
    let mut guard = holder.0.lock().await;

    guard.stop();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let server = RemoteServer::new(services, config, app.clone());
    let enabled = server.config().enabled;
    if enabled {
        server.start()?;
    }
    let status = server.status();
    *guard = server;
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request() -> serde_json::Value {
        json!({
            "enabled": false,
            "host": "0.0.0.0",
            "port": 8787,
            "token": null
        })
    }

    #[test]
    fn remote_config_request_is_a_closed_complete_object() {
        assert!(serde_json::from_value::<RemoteConfigUpdateRequest>(request()).is_ok());

        let mut missing = request();
        missing.as_object_mut().unwrap().remove("token");
        assert!(serde_json::from_value::<RemoteConfigUpdateRequest>(missing).is_err());

        let mut unknown = request();
        unknown["bind_all"] = json!(true);
        assert!(serde_json::from_value::<RemoteConfigUpdateRequest>(unknown).is_err());
    }
}
