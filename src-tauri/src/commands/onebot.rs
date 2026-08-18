use tauri::Manager;

use crate::ServicesExt;
use crate::onebot;

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
    let services = app.services();
    Ok(onebot::load_config(&services.db))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn save_onebot_config(app: tauri::AppHandle, config: onebot::OneBotConfig) -> Result<(), String> {
    let services = app.services();
    onebot::save_config(&services.db, &config)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn start_onebot(app: tauri::AppHandle) -> Result<(), String> {
    let services = app.services();
    let config = onebot::load_config(&services.db);

    let ob = app.state::<onebot::AppOneBot>();
    let mut server_guard = ob.0.lock().await;

    // Stop the previous instance before replacing it so its accept loop exits and
    // releases the listener, instead of hot-spinning on a closed shutdown channel
    // and keeping the old port/token alive. Brief pause lets the socket free up.
    server_guard.stop();
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
    server.stop();
    Ok(())
}
