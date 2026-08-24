use tauri::Manager;

use crate::ServicesExt;
use meridian_core::onebot;

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
    onebot::refresh_voice_policy(&services, &config).await;
    Ok(())
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
