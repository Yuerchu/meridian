use tauri::Manager;

use crate::ServicesExt;
use crate::hooks;

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_hooks_status(app: tauri::AppHandle) -> Result<hooks::HookStatus, String> {
    let state = app.state::<hooks::AppHooks>();
    let server = state.0.lock().await;
    Ok(server.status())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_hooks_config(app: tauri::AppHandle) -> Result<hooks::HookConfig, String> {
    let services = app.services();
    Ok(hooks::load_config(&services.db))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn save_hooks_config(app: tauri::AppHandle, config: hooks::HookConfig) -> Result<hooks::HookConfig, String> {
    let services = app.services();
    // Minted here rather than in the settings page: the page would have to send
    // it back on every save, and a token that travels twice is a token that can
    // be pasted into a screenshot twice.
    let config = hooks::HookConfig {
        token: match config.token.filter(|t| !t.is_empty()) {
            Some(existing) => Some(existing),
            None => Some(hooks::generate_token()),
        },
        ..config
    };
    hooks::save_config(&services.db, &config)?;
    apply_to_running(&app).await?;
    // Read back rather than echoing what came in: `save_config` clamps, so what
    // is stored is not always what was sent.
    Ok(hooks::load_config(&services.db))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn regenerate_hooks_token(app: tauri::AppHandle) -> Result<String, String> {
    let services = app.services();
    let token = hooks::generate_token();
    let config = hooks::HookConfig {
        token: Some(token.clone()),
        ..hooks::load_config(&services.db)
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
    let config = hooks::load_config(&services.db);

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
