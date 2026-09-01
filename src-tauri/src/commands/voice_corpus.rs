//! 语料的管理入口：看、导、删。
//!
//! 三个命令的远程可见性是分开决定的，见 `command_table.rs`：导出写本机任意
//! 路径、写出去的内容就是声纹语料本身，所以只有本机能要；而删除恰恰是那个
//! **需要在手机上做**的隐私动作——有人说"把我的声音删掉"时，你手上多半不是
//! 那台电脑。

use crate::ServicesExt;
use meridian_core::db::models::voice_corpus::VoiceCorpusSourceType;
use meridian_core::voice_corpus::manage::{self, CorpusSelector, DeleteReport, ExportReport, SessionTotal};

/// The exact target of a corpus deletion. This tagged union lives at the shell
/// boundary so the core management model is never itself an IPC contract.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum VoiceCorpusDeleteSelector {
    Session { handle: String },
    Sender { id: String },
    All { confirmation: String },
}

impl From<VoiceCorpusDeleteSelector> for CorpusSelector {
    fn from(value: VoiceCorpusDeleteSelector) -> Self {
        match value {
            VoiceCorpusDeleteSelector::Session { handle } => Self::Session { handle },
            VoiceCorpusDeleteSelector::Sender { id } => Self::Sender { id },
            VoiceCorpusDeleteSelector::All { confirmation } => Self::All { confirmation },
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceCorpusDeleteRequest {
    selector: VoiceCorpusDeleteSelector,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceCorpusOptoutUpdateRequest {
    sender_id: String,
    enabled: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceCorpusForgetRequest {
    sender_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceCorpusExportRequest {
    output_dir: String,
    include_sender: bool,
    include_untranscribed: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct VoiceCorpusDeleteResponse {
    pub clips: usize,
    pub files: usize,
    pub bytes: i64,
    pub failures: Vec<String>,
}

impl From<DeleteReport> for VoiceCorpusDeleteResponse {
    fn from(value: DeleteReport) -> Self {
        Self {
            clips: value.clips,
            files: value.files,
            bytes: value.bytes,
            failures: value.failures,
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct VoiceCorpusForgetResponse {
    pub clips: usize,
    pub files: usize,
    pub bytes: i64,
    pub failures: Vec<String>,
}

impl From<DeleteReport> for VoiceCorpusForgetResponse {
    fn from(value: DeleteReport) -> Self {
        Self {
            clips: value.clips,
            files: value.files,
            bytes: value.bytes,
            failures: value.failures,
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct VoiceCorpusExportResponse {
    pub clips: usize,
    pub skipped: usize,
    pub bytes: i64,
    pub path: String,
}

impl From<ExportReport> for VoiceCorpusExportResponse {
    fn from(value: ExportReport) -> Self {
        Self {
            clips: value.clips,
            skipped: value.skipped,
            bytes: value.bytes,
            path: value.path,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceCorpusSessionKind {
    Group,
    Private,
}

/// 一个会话的语料概况。
///
/// **只有假名出去。** 这份列表会经远程接口送到另一台设备上，而 `bot_self_id`
/// 就是 bot 的 QQ 号，私聊那一档的 `source_id` 就是对方本人的号——把它们跟着
/// 发出去，等于假名化只做了给人看的那一半。回删也用同一个假名（见
/// `VoiceCorpusDeleteSelector::Session`），所以真实的号从不出这台机器。
#[derive(serde::Serialize)]
pub struct VoiceCorpusSessionInfoResponse {
    /// 假名。既是显示的名字，也是回删时指认这个会话的句柄。
    pub handle: String,
    /// `group` / `private`。哪个群不说，是群还是私聊要说——一份私聊语料和一份
    /// 群语料，该不该留下来是两个判断。
    pub kind: VoiceCorpusSessionKind,
    pub clips: i64,
    pub bytes: i64,
    pub untranscribed: i64,
    pub last_captured_at: i64,
}

pub type VoiceCorpusSessionListResponse = Vec<VoiceCorpusSessionInfoResponse>;

#[tauri::command]
pub async fn list_voice_corpus(app: tauri::AppHandle) -> Result<VoiceCorpusSessionListResponse, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let totals = manage::list_sessions(&pool)?;
        let untranscribed = manage::untranscribed_counts(&pool)?;
        totals
            .into_iter()
            .map(|total| {
                let key = format!("{}|{}|{}", total.bot_self_id, total.source_type, total.source_id);
                Ok(VoiceCorpusSessionInfoResponse {
                    handle: manage::session_label(&pool, &total)?,
                    kind: session_kind(&total)?,
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

fn session_kind(total: &SessionTotal) -> Result<VoiceCorpusSessionKind, String> {
    match VoiceCorpusSourceType::parse(&total.source_type)? {
        VoiceCorpusSourceType::OnebotGroup => Ok(VoiceCorpusSessionKind::Group),
        VoiceCorpusSourceType::OnebotPrivate => Ok(VoiceCorpusSessionKind::Private),
    }
}

/// 删除历史。selector 是显式的 tagged union，缺字段会反序列化失败。
#[tauri::command]
pub async fn delete_voice_corpus(
    app: tauri::AppHandle,
    request: VoiceCorpusDeleteRequest,
) -> Result<VoiceCorpusDeleteResponse, String> {
    let services = app.services();
    let data_dir = services.paths.data_dir.clone();
    manage::delete(&services.db, &data_dir, &services.corpus, request.selector.into())
        .await
        .map(Into::into)
}

/// "以后别再录我"。与删除历史是两件事，所以是两个命令。
#[tauri::command]
pub async fn set_voice_optout(app: tauri::AppHandle, request: VoiceCorpusOptoutUpdateRequest) -> Result<(), String> {
    let VoiceCorpusOptoutUpdateRequest { sender_id, enabled } = request;
    let services = app.services();
    let pool = services.db.clone();
    let corpus = services.corpus.clone();
    #[cfg(not(target_os = "android"))]
    let config = meridian_core::onebot::load_config(&services.db)?;
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
pub async fn forget_voice_sender(
    app: tauri::AppHandle,
    request: VoiceCorpusForgetRequest,
) -> Result<VoiceCorpusForgetResponse, String> {
    let sender_id = request.sender_id;
    let services = app.services();
    let data_dir = services.paths.data_dir.clone();
    #[cfg(not(target_os = "android"))]
    let config = meridian_core::onebot::load_config(&services.db)?;
    #[cfg(not(target_os = "android"))]
    let refresh = || {
        let services = services.clone();
        async move { meridian_core::onebot::refresh_voice_policy(&services, &config).await }
    };
    #[cfg(target_os = "android")]
    let refresh = || async { Ok::<(), String>(()) };
    manage::forget_sender(&services.db, &data_dir, &services.corpus, &sender_id, refresh)
        .await
        .map(Into::into)
}

/// 导出成 bundle。`local`，见模块头。
#[tauri::command]
pub async fn export_voice_corpus(
    app: tauri::AppHandle,
    request: VoiceCorpusExportRequest,
) -> Result<VoiceCorpusExportResponse, String> {
    let VoiceCorpusExportRequest {
        output_dir,
        include_sender,
        include_untranscribed,
    } = request;
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
    .map(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn total(source_type: &str) -> SessionTotal {
        SessionTotal {
            bot_self_id: 1,
            source_type: source_type.to_string(),
            source_id: "123".to_string(),
            clips: 1,
            bytes: 2,
            last_captured_at: 3,
        }
    }

    #[test]
    fn response_session_kind_is_closed() {
        assert_eq!(
            session_kind(&total("onebot_group")).unwrap(),
            VoiceCorpusSessionKind::Group
        );
        assert_eq!(
            session_kind(&total("onebot_private")).unwrap(),
            VoiceCorpusSessionKind::Private
        );

        let error = session_kind(&total("onebot_channel")).unwrap_err();
        assert!(error.contains("unknown voice corpus source_type"), "{error}");
    }

    #[test]
    fn response_session_kind_uses_the_canonical_wire_values() {
        assert_eq!(
            serde_json::to_value(VoiceCorpusSessionKind::Group).unwrap(),
            serde_json::json!("group")
        );
        assert_eq!(
            serde_json::to_value(VoiceCorpusSessionKind::Private).unwrap(),
            serde_json::json!("private")
        );
    }

    #[test]
    fn deletion_request_is_a_strict_tagged_union() {
        let request: VoiceCorpusDeleteRequest = serde_json::from_value(serde_json::json!({
            "selector": { "kind": "sender", "id": "alice" }
        }))
        .unwrap();
        assert!(matches!(request.selector, VoiceCorpusDeleteSelector::Sender { .. }));

        assert!(
            serde_json::from_value::<VoiceCorpusDeleteRequest>(serde_json::json!({
                "selector": { "kind": "all" }
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<VoiceCorpusDeleteRequest>(serde_json::json!({
                "selector": { "kind": "sender", "id": "alice", "future": true }
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<VoiceCorpusDeleteRequest>(serde_json::json!({
                "selector": { "kind": "future", "id": "alice" }
            }))
            .is_err()
        );
    }

    #[test]
    fn export_request_rejects_unknown_fields() {
        assert!(
            serde_json::from_value::<VoiceCorpusExportRequest>(serde_json::json!({
                "outputDir": "voice-corpus",
                "includeSender": false,
                "includeUntranscribed": false,
                "format": "future"
            }))
            .is_err()
        );
    }
}
