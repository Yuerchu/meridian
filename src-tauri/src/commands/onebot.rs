use tauri::Manager;

use crate::onebot;
use crate::state::{AppDb, AppMcp, AppSecrets, AppTools};

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_onebot_status(app: tauri::AppHandle) -> Result<onebot::OneBotStatus, String> {
    let ob = app.state::<onebot::AppOneBot>();
    let server = ob.0.lock().await;
    Ok(server.status())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_onebot_config(app: tauri::AppHandle) -> Result<onebot::OneBotConfig, String> {
    let pool = app.state::<AppDb>().0.clone();
    Ok(onebot::load_config(&pool))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn save_onebot_config(app: tauri::AppHandle, config: onebot::OneBotConfig) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    onebot::save_config(&pool, &config)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn start_onebot(app: tauri::AppHandle) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    let config = onebot::load_config(&pool);

    let ob = app.state::<onebot::AppOneBot>();
    let mut server_guard = ob.0.lock().await;

    // Stop the previous instance before replacing it so its accept loop exits and
    // releases the listener, instead of hot-spinning on a closed shutdown channel
    // and keeping the old port/token alive. Brief pause lets the socket free up.
    server_guard.stop();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Recreate server with fresh config
    let new_server = onebot::OneBotServer::new(
        pool,
        app.state::<AppSecrets>().0.clone(),
        app.state::<AppTools>().0.clone(),
        app.state::<AppMcp>().0.clone(),
        // The one the desktop uses. Restarting OneBot rebuilds everything else
        // in its shared state; a coordinator rebuilt with it would forget the
        // conversations desktop turns are holding.
        app.state::<crate::state::AppTurns>().0.clone(),
        config,
        Some(app.clone()),
    );
    new_server.start()?;
    *server_guard = new_server;
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn stop_onebot(app: tauri::AppHandle) -> Result<(), String> {
    let ob = app.state::<onebot::AppOneBot>();
    let server = ob.0.lock().await;
    server.stop();
    Ok(())
}
