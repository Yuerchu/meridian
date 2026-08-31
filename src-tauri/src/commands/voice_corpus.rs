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
/// **只有假名出去。** 这份列表会经远程接口送到另一台设备上，而 `bot_self_id`
/// 就是 bot 的 QQ 号，私聊那一档的 `source_id` 就是对方本人的号——把它们跟着
/// 发出去，等于假名化只做了给人看的那一半。回删也用同一个假名（见
/// `CorpusSelector::Session`），所以真实的号从不出这台机器。
#[derive(serde::Serialize)]
pub struct VoiceCorpusSession {
    /// 假名。既是显示的名字，也是回删时指认这个会话的句柄。
    pub handle: String,
    /// `group` / `private`。哪个群不说，是群还是私聊要说——一份私聊语料和一份
    /// 群语料，该不该留下来是两个判断。
    pub kind: &'static str,
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
                    handle: manage::session_label(&pool, &total)?,
                    kind: session_kind(&total),
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

fn session_kind(total: &SessionTotal) -> &'static str {
    if total.source_type == "onebot_group" {
        "group"
    } else {
        "private"
    }
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
    let corpus = services.corpus.clone();
    #[cfg(not(target_os = "android"))]
    let config = meridian_core::onebot::load_config(&services.db);
    tokio::task::spawn_blocking(move || manage::set_optout(&pool, &corpus, &sender_id, enabled))
        .await
        .map_err(|e| e.to_string())??;
    // 名单立刻生效，不等下一次重启——这是一个人刚刚说的"别录我"。
    #[cfg(not(target_os = "android"))]
    {
        meridian_core::onebot::refresh_voice_policy(&services, &config).await
    }
    // Android 没有 OneBot 采集者；写入持久名单就已经是完整操作。
    #[cfg(target_os = "android")]
    {
        Ok(())
    }
}

/// "把我的声音删掉，以后也别再录。"
///
/// **一个命令，不是两个。** 前端连着调"删除"和"拒绝将来"时，中间那一段屏障
/// 已经撤了而名单还没生效——这中间落盘的录音谁都不会再回头删，而按钮已经报告
/// 成功了。这里顺序是反的：先让拒绝生效，再 drain 并删除。
#[tauri::command]
pub async fn forget_voice_sender(app: tauri::AppHandle, sender_id: String) -> Result<DeleteReport, String> {
    let services = app.services();
    let data_dir = services.paths.data_dir.clone();
    #[cfg(not(target_os = "android"))]
    let config = meridian_core::onebot::load_config(&services.db);
    #[cfg(not(target_os = "android"))]
    let refresh = || {
        let services = services.clone();
        async move { meridian_core::onebot::refresh_voice_policy(&services, &config).await }
    };
    #[cfg(target_os = "android")]
    let refresh = || async { Ok::<(), String>(()) };
    manage::forget_sender(&services.db, &data_dir, &services.corpus, &sender_id, refresh).await
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
