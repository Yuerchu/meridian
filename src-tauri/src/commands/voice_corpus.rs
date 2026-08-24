//! 语料的管理入口：看、导、删。
//!
//! 三个命令的远程可见性是分开决定的，见 `command_table.rs`：导出写本机任意
//! 路径、写出去的内容就是声纹语料本身，所以只有本机能要；而删除恰恰是那个
//! **需要在手机上做**的隐私动作——有人说"把我的声音删掉"时，你手上多半不是
//! 那台电脑。

use crate::ServicesExt;
use meridian_core::voice_corpus::manage::{self, CorpusSelector, DeleteReport, ExportReport, SessionTotal};

/// 一个会话的语料概况。
///
/// 会话用**假名**而不是群号：这份列表会经远程接口送到另一台设备上，而它回答的
/// 问题是"占了多少地方、要不要清"，不需要知道是哪个群。
#[derive(serde::Serialize)]
pub struct VoiceCorpusSession {
    pub label: String,
    pub bot_self_id: i64,
    pub session: String,
    pub clips: i64,
    pub bytes: i64,
    pub untranscribed: i64,
    pub last_captured_at: i64,
}

#[tauri::command]
pub async fn list_voice_corpus(app: tauri::AppHandle) -> Result<Vec<VoiceCorpusSession>, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let totals = manage::list_sessions(&pool)?;
        let untranscribed = manage::untranscribed_counts(&pool)?;
        totals
            .into_iter()
            .map(|total| {
                let key = format!("{}|{}|{}", total.bot_self_id, total.source_type, total.source_id);
                Ok(VoiceCorpusSession {
                    label: manage::session_label(&pool, &total)?,
                    bot_self_id: total.bot_self_id,
                    session: session_string(&total),
                    clips: total.clips,
                    bytes: total.bytes,
                    untranscribed: untranscribed.get(&key).copied().unwrap_or(0),
                    last_captured_at: total.last_captured_at,
                })
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

fn session_string(total: &SessionTotal) -> String {
    let kind = if total.source_type == "onebot_group" {
        "group"
    } else {
        "private"
    };
    format!("{kind}:{}", total.source_id)
}

/// 删除历史。selector 是显式的 tagged union，缺字段会反序列化失败——见
/// `CorpusSelector` 上的说明。
#[tauri::command]
pub async fn delete_voice_corpus(app: tauri::AppHandle, selector: CorpusSelector) -> Result<DeleteReport, String> {
    let services = app.services();
    let data_dir = services.paths.data_dir.clone();
    manage::delete(&services.db, &data_dir, &services.corpus, selector).await
}

/// "以后别再录我"。与删除历史是两件事，所以是两个命令。
#[tauri::command]
pub async fn set_voice_optout(app: tauri::AppHandle, sender_id: String, enabled: bool) -> Result<(), String> {
    let services = app.services();
    let pool = services.db.clone();
    let config = meridian_core::onebot::load_config(&services.db);
    tokio::task::spawn_blocking(move || manage::set_optout(&pool, &sender_id, enabled))
        .await
        .map_err(|e| e.to_string())??;
    // 名单立刻生效，不等下一次重启——这是一个人刚刚说的"别录我"。
    meridian_core::onebot::refresh_voice_policy(&services, &config).await;
    Ok(())
}

/// 导出成 bundle。`local`，见模块头。
#[tauri::command]
pub async fn export_voice_corpus(
    app: tauri::AppHandle,
    output_dir: String,
    include_sender: bool,
    include_untranscribed: bool,
) -> Result<ExportReport, String> {
    let services = app.services();
    let data_dir = services.paths.data_dir.clone();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        manage::export(
            &pool,
            &data_dir,
            std::path::Path::new(&output_dir),
            include_sender,
            include_untranscribed,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
