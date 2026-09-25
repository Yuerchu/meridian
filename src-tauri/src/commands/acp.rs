//! Driving a hosted Claude Code session from the window.
//!
//! Thin on purpose: everything these do lives in `meridian_core::acp`, because
//! a session has to be startable from something without a window before this is
//! more than one frontend's feature.

use crate::ServicesExt;
use crate::commands::model_config::RequiredNullable;
use meridian_core::acp::{self, AcpConfig};

#[cfg(not(target_os = "android"))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpSessionOpenRequest {
    pub cwd: String,
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpPromptSendRequest {
    pub conversation_id: String,
    pub message: String,
    pub turn_id: RequiredNullable<String>,
    pub context_refs: RequiredNullable<Vec<meridian_core::workspace::reference::WorkspaceReferenceRequest>>,
    /// Conversations dragged into the composer, as ids — validated on their
    /// own terms, since a drag leaves no `@` marker for reconcile to hold.
    pub conversation_refs: RequiredNullable<Vec<String>>,
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpSessionAttachRequest {
    pub conversation_id: String,
    pub session_id: String,
    pub cwd: String,
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpSessionListRequest {
    /// `None` means every project. A present value narrows discovery to that
    /// directory and its worktrees.
    pub cwd: RequiredNullable<String>,
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpDiscoveredSessionInfoResponse {
    pub session_id: String,
    pub cwd: String,
    pub title: Option<String>,
    pub updated_at: Option<String>,
    pub owned_by: Option<String>,
}

#[cfg(not(target_os = "android"))]
impl From<acp::import::DiscoveredSession> for AcpDiscoveredSessionInfoResponse {
    fn from(session: acp::import::DiscoveredSession) -> Self {
        Self {
            session_id: session.session_id,
            cwd: session.cwd,
            title: session.title,
            updated_at: session.updated_at,
            owned_by: session.owned_by,
        }
    }
}

#[cfg(not(target_os = "android"))]
pub type AcpDiscoveredSessionListResponse = Vec<AcpDiscoveredSessionInfoResponse>;

#[cfg(not(target_os = "android"))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpImportSessionRequest {
    pub session_id: String,
    pub cwd: String,
    /// Nullable keys are still required: absence is not another spelling of
    /// `null` in a first-party request.
    pub title: RequiredNullable<String>,
    pub updated_at: RequiredNullable<String>,
}

#[cfg(not(target_os = "android"))]
impl From<AcpImportSessionRequest> for acp::import::ImportRequest {
    fn from(session: AcpImportSessionRequest) -> Self {
        Self {
            session_id: session.session_id,
            cwd: session.cwd,
            title: session.title.0,
            updated_at: session.updated_at.0,
        }
    }
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpImportSessionResponse {
    pub conversation_id: String,
    pub truncated: bool,
    pub messages: usize,
}

#[cfg(not(target_os = "android"))]
impl From<acp::import::ImportedSession> for AcpImportSessionResponse {
    fn from(response: acp::import::ImportedSession) -> Self {
        Self {
            conversation_id: response.conversation_id,
            truncated: response.truncated,
            messages: response.messages,
        }
    }
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpSessionConfigReadRequest {
    pub conversation_id: String,
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpSessionConfigUpdateRequest {
    pub conversation_id: String,
    pub config_id: String,
    /// ACP defines config values as protocol-owned JSON. The shell keeps that
    /// dynamic leaf but closes the surrounding first-party request object.
    pub value: serde_json::Value,
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpConfigOptionValueInfoResponse {
    pub value: String,
    pub name: String,
    pub description: Option<String>,
}

#[cfg(not(target_os = "android"))]
impl From<acp::protocol::ConfigOptionValue> for AcpConfigOptionValueInfoResponse {
    fn from(value: acp::protocol::ConfigOptionValue) -> Self {
        Self {
            value: value.value,
            name: value.name,
            description: value.description,
        }
    }
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpConfigOptionInfoResponse {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub current_value: Option<serde_json::Value>,
    pub options: Vec<AcpConfigOptionValueInfoResponse>,
}

#[cfg(not(target_os = "android"))]
impl From<acp::protocol::SessionConfigOption> for AcpConfigOptionInfoResponse {
    fn from(option: acp::protocol::SessionConfigOption) -> Self {
        Self {
            id: option.id,
            name: option.name,
            description: option.description,
            category: option.category,
            kind: option.kind,
            current_value: option.current_value,
            options: option.options.into_iter().map(Into::into).collect(),
        }
    }
}

#[cfg(not(target_os = "android"))]
pub type AcpConfigOptionListResponse = Vec<AcpConfigOptionInfoResponse>;

#[cfg(not(target_os = "android"))]
pub type AcpLiveConversationIdsResponse = Vec<String>;

#[derive(Debug, serde::Serialize)]
pub struct AcpConfigInfoResponse {
    pub command: String,
    pub args: Vec<String>,
}

impl From<AcpConfig> for AcpConfigInfoResponse {
    fn from(config: AcpConfig) -> Self {
        Self {
            command: config.command,
            args: config.args,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcpConfigUpdateRequest {
    pub command: String,
    pub args: Vec<String>,
}

impl From<AcpConfigUpdateRequest> for AcpConfig {
    fn from(config: AcpConfigUpdateRequest) -> Self {
        Self {
            command: config.command,
            args: config.args,
        }
    }
}

/// Start an adapter in `cwd` and give it a conversation. Returns the
/// conversation id, which is what everything else here is keyed by.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_open_session(app: tauri::AppHandle, request: AcpSessionOpenRequest) -> Result<String, String> {
    let cwd = request.cwd.trim();
    if cwd.is_empty() {
        return Err("choose a folder for the session to work in".into());
    }
    // Checked here rather than left to the adapter: `session/new` with a
    // directory that does not exist fails with the adapter's own wording, in
    // the middle of a JSON-RPC error, which reads as a protocol fault.
    if !std::path::Path::new(cwd).is_dir() {
        return Err(format!("`{cwd}` is not a folder"));
    }
    acp::open_session(&app.services(), cwd).await
}

/// Send one prompt and run the turn to completion.
///
/// Awaited rather than spawned, exactly like `chat`: the answer arrives on
/// `chat-stream` while this call is still outstanding, and its return is how the
/// caller learns the turn is over and whether it failed.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_send(app: tauri::AppHandle, request: AcpPromptSendRequest) -> Result<(), String> {
    let AcpPromptSendRequest {
        conversation_id,
        message,
        turn_id,
        context_refs,
        conversation_refs,
    } = request;
    let turn_id = turn_id.0;
    let services = app.services();
    if meridian_core::agent::queue::has_plan_review_barrier(&services, &conversation_id).await? {
        return Err(
            "This conversation is waiting for plan review or its continuation. Finish it before sending another ACP prompt."
                .into(),
        );
    }
    let parsed = meridian_core::workspace::reference::parse_message_references(&message);
    let references =
        meridian_core::workspace::reference::reconcile_references(context_refs.0.unwrap_or_default(), parsed)?;
    let context = if references.is_empty() {
        Vec::new()
    } else {
        let pool = services.db.clone();
        let conversation = conversation_id.clone();
        let cwd = tokio::task::spawn_blocking(move || {
            let mut conn = meridian_core::util::get_conn(&pool)?;
            meridian_core::db::ops::acp_session::get(&mut conn, &conversation)
                .map_err(|e| e.to_string())?
                .map(|row| row.cwd)
                .ok_or_else(|| "this conversation has no Claude Code working directory".to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        let file_access = meridian_core::agent::build_file_access(&services.db).await?;
        let tool_context = meridian_core::tools::ToolContext {
            working_directory: Some(cwd),
            shell: meridian_core::tools::ShellType::default_for_platform(),
            file_access,
            project_id: None,
            conversation_id: Some(conversation_id.clone()),
            turn_id: turn_id.clone(),
            assistant_id: None,
            db_pool: Some(services.db.clone()),
            sandbox_policy: meridian_core::sandbox::CommandSandbox::UNCONFINED,
            tool_secrets: Default::default(),
            cancel: tokio_util::sync::CancellationToken::new(),
            journal: None,
        };
        let counter = meridian_core::agent::TokenCounter::new(meridian_core::agent::TokenizerKind::Cl100kBase);
        meridian_core::workspace::reference::prepare_references(&tool_context, &references, &counter, None).await?
    };
    // Dragged-in conversations, through the same freeze the native turn uses,
    // against what the workspace references left of the same budget.
    let conv_refs = conversation_refs.0.unwrap_or_default();
    let context = if conv_refs.is_empty() {
        context
    } else {
        let mut context = context;
        let spent: usize = context.iter().map(|item| item.token_count.max(0) as usize).sum();
        let budget_left = meridian_core::workspace::reference::turn_context_token_limit(None).saturating_sub(spent);
        let pool = services.db.clone();
        let current = conversation_id.clone();
        let frozen = tokio::task::spawn_blocking(move || {
            let mut conn = meridian_core::util::get_conn(&pool)?;
            meridian_core::agent::conversation_excerpt::freeze_conversation_refs(
                &mut conn,
                &current,
                &conv_refs,
                budget_left,
            )
        })
        .await
        .map_err(|e| e.to_string())??;
        context.extend(frozen);
        context
    };
    // Reopens a conversation whose adapter died with the last run of the app.
    // The transcript is still here; the agent's memory of it is not.
    let session = acp::reopen_session(&services, &conversation_id).await?;
    session.prompt_with_context(&services, &message, turn_id, context).await
}

/// Every Claude Code session on this machine, with the ones a conversation here
/// already follows marked.
///
/// `cwd` narrows it to one directory (and its git worktrees, which is the SDK's
/// own behaviour); absent means every project. A short-lived adapter, so this
/// costs an `npx` start each time the picker is opened — the same wait the
/// settings page's check button has.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_list_sessions(
    app: tauri::AppHandle,
    request: AcpSessionListRequest,
) -> Result<AcpDiscoveredSessionListResponse, String> {
    let cwd = request
        .cwd
        .0
        .map(|cwd| cwd.trim().to_string())
        .filter(|cwd| !cwd.is_empty());
    acp::import::discover(&app.services(), cwd.as_deref())
        .await
        .map(|sessions| sessions.into_iter().map(Into::into).collect())
}

/// Take a session over and give it a conversation here.
///
/// The transcript comes back with it: `session/load` recites the history and
/// this is the one caller that writes the recital down rather than throwing it
/// away. The answer is more than the conversation id because it has to carry
/// `truncated` — a long session comes back only from its last compaction, and
/// nothing else on screen would ever say so.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_import_session(
    app: tauri::AppHandle,
    request: AcpImportSessionRequest,
) -> Result<AcpImportSessionResponse, String> {
    let session = request.into();
    acp::import::import(&app.services(), &session).await.map(Into::into)
}

/// Point an existing conversation at a session on disk.
///
/// For a conversation from before `acp_sessions` existed: it has a directory and
/// no session id, so every reopen starts a blank agent under a transcript it
/// cannot see. Nothing is written but the id — the rows are already here, and
/// they came from this same session.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_attach_session(app: tauri::AppHandle, request: AcpSessionAttachRequest) -> Result<(), String> {
    let services = app.services();
    if meridian_core::agent::queue::has_plan_review_barrier(&services, &request.conversation_id).await? {
        return Err(
            "This conversation is waiting for plan review or its continuation. Finish it before attaching another ACP session."
                .into(),
        );
    }
    acp::import::attach(&services, &request.conversation_id, &request.session_id, &request.cwd).await
}

/// Which agent session a conversation follows, and where it works.
///
/// What the attach picker opens with: the directory to narrow the list to, and
/// whether there is already an id — a conversation that resumes perfectly well
/// is not one to repoint by accident.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_conversation_session(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Option<AcpConversationSessionInfoResponse>, String> {
    let services = app.services();
    let pool = services.db.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = meridian_core::util::get_conn(&pool)?;
        meridian_core::db::ops::acp_session::get(&mut conn, &conversation_id)
            .map(|row| {
                row.map(|row| AcpConversationSessionInfoResponse {
                    cwd: row.cwd,
                    acp_session_id: row.acp_session_id,
                })
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "android"))]
#[derive(serde::Serialize)]
pub struct AcpConversationSessionInfoResponse {
    pub cwd: String,
    /// `None` is a state rather than a gap: a conversation from before the
    /// table, or one whose adapter came up and never opened a session.
    pub acp_session_id: Option<String>,
}

/// Stop the turn in flight, leaving the session open.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_cancel(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    if let Some(session) = app.services().acp.get(&conversation_id) {
        session.cancel().await;
    }
    // Absent is success: the turn this was meant to stop has already ended.
    Ok(())
}

/// End the session and the process behind it. The conversation stays.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_close(app: tauri::AppHandle, conversation_id: String) -> Result<(), String> {
    app.services().acp.close(&conversation_id).await;
    Ok(())
}

/// Which conversations have a live adapter behind them right now.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_live_sessions(app: tauri::AppHandle) -> Result<AcpLiveConversationIdsResponse, String> {
    Ok(app.services().acp.live_conversations())
}

/// The knobs the agent exposes for this session: model, mode, effort, and
/// whatever else it invents.
///
/// Empty for a conversation with no live session — including one whose adapter
/// died with the last run of the app. The composer reads that as "nothing to
/// offer" and falls back to showing the model recorded on the transcript, which
/// is the honest answer: there is no session to change anything on.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_session_config(
    app: tauri::AppHandle,
    request: AcpSessionConfigReadRequest,
) -> Result<AcpConfigOptionListResponse, String> {
    Ok(app
        .services()
        .acp
        .get(&request.conversation_id)
        .map(|session| session.config_options())
        .unwrap_or_default()
        .into_iter()
        .map(Into::into)
        .collect())
}

/// Change one of them, and hand back the whole set as it now stands.
///
/// The whole set, because changing one reshapes others: picking a model
/// re-derives which modes are available, and a caller that updated only the
/// option it set would offer a mode that no longer exists.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_set_session_config(
    app: tauri::AppHandle,
    request: AcpSessionConfigUpdateRequest,
) -> Result<AcpConfigOptionListResponse, String> {
    let session = app
        .services()
        .acp
        .get(&request.conversation_id)
        .ok_or("this conversation has no running Claude Code session")?;
    session
        .set_config_option(&request.config_id, request.value)
        .await
        .map(|options| options.into_iter().map(Into::into).collect())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_get_config(app: tauri::AppHandle) -> Result<AcpConfigInfoResponse, String> {
    AcpConfig::load(&app.services().db).map(Into::into)
}

/// `local`, and this is the one row here where that is load-bearing:
/// `acp.command` names a binary this app will execute. A remote caller able to
/// write it has arbitrary code execution on the machine running Meridian, which
/// is a different order of thing from the self-lockout the other `local` rows
/// guard. It is deliberately absent from the closed public `PreferenceKey`, so
/// the typed preference command cannot reach the same row.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_save_config(
    app: tauri::AppHandle,
    request: AcpConfigUpdateRequest,
) -> Result<AcpConfigInfoResponse, String> {
    let services = app.services();
    let config = AcpConfig::from(request);
    config.save(&services.db)?;
    AcpConfig::load(&services.db).map(Into::into)
}

/// What a working adapter says about itself.
#[cfg(not(target_os = "android"))]
#[derive(serde::Serialize)]
pub struct AcpCheckResponse {
    pub ok: bool,
    /// The adapter's name and version, when it got far enough to say.
    pub agent: Option<String>,
    pub protocol_version: Option<u32>,
    pub load_session: bool,
    /// Present exactly when `ok` is false. Carries the adapter's own stderr,
    /// which is where "command not found" and a node stack trace both end up.
    pub error: Option<String>,
}

/// Start an adapter, greet it, and shut it down.
///
/// The settings page's "is this configured correctly" button. `local` because
/// it launches a process on this machine, and because the answer is about this
/// machine.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn acp_check_adapter(app: tauri::AppHandle) -> Result<AcpCheckResponse, String> {
    let config = AcpConfig::load(&app.services().db)?;
    match acp::check_adapter(&config).await {
        Ok(report) => Ok(AcpCheckResponse {
            ok: true,
            agent: report.agent,
            protocol_version: Some(report.protocol_version),
            load_session: report.load_session,
            error: None,
        }),
        // A failed check is a successful command: the page wants to draw the
        // reason, not catch an exception.
        Err(e) => Ok(AcpCheckResponse {
            ok: false,
            agent: None,
            protocol_version: None,
            load_session: false,
            error: Some(e),
        }),
    }
}

#[cfg(test)]
mod config_dto_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn acp_config_request_is_a_closed_complete_object() {
        let complete = json!({"command": "npx", "args": ["-y", "adapter"]});
        assert!(serde_json::from_value::<AcpConfigUpdateRequest>(complete).is_ok());

        let missing = json!({"command": "npx"});
        assert!(serde_json::from_value::<AcpConfigUpdateRequest>(missing).is_err());

        let unknown = json!({"command": "npx", "args": [], "shell": true});
        assert!(serde_json::from_value::<AcpConfigUpdateRequest>(unknown).is_err());
    }

    #[test]
    fn acp_session_requests_are_closed_complete_objects() {
        assert!(
            serde_json::from_value::<AcpSessionOpenRequest>(json!({
                "cwd": "C:/work/project"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<AcpSessionOpenRequest>(json!({
                "cwd": "C:/work/project",
                "reuse": true
            }))
            .is_err()
        );

        let prompt = json!({
            "conversationId": "conversation-1",
            "message": "inspect it",
            "turnId": null,
            "contextRefs": null,
            "conversationRefs": null
        });
        assert!(serde_json::from_value::<AcpPromptSendRequest>(prompt).is_ok());
        assert!(
            serde_json::from_value::<AcpPromptSendRequest>(json!({
                "conversationId": "conversation-1",
                "message": "inspect @src/main.rs",
                "turnId": null,
                "contextRefs": [{
                    "path": "src/main.rs",
                    "lineStart": null
                }],
                "conversationRefs": null
            }))
            .is_err(),
            "nested reference range keys must be complete"
        );
        assert!(
            serde_json::from_value::<AcpPromptSendRequest>(json!({
                "conversationId": "conversation-1",
                "message": "inspect it"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<AcpPromptSendRequest>(json!({
                "conversationId": "conversation-1",
                "message": "inspect it",
                "turnId": null,
                "contextRefs": null,
                "conversationRefs": null,
                "legacyMode": true
            }))
            .is_err()
        );

        assert!(
            serde_json::from_value::<AcpSessionAttachRequest>(json!({
                "conversationId": "conversation-1",
                "sessionId": "session-1",
                "cwd": "C:/work/project"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<AcpSessionAttachRequest>(json!({
                "conversationId": "conversation-1",
                "sessionId": "session-1",
                "cwd": "C:/work/project",
                "copyTranscript": false
            }))
            .is_err()
        );

        let list = json!({"cwd": null});
        assert!(serde_json::from_value::<AcpSessionListRequest>(list).is_ok());
        assert!(serde_json::from_value::<AcpSessionListRequest>(json!({})).is_err());
        assert!(serde_json::from_value::<AcpSessionListRequest>(json!({"cwd": null, "all": true})).is_err());

        let complete = json!({
            "sessionId": "session-1",
            "cwd": "C:/work/project",
            "title": null,
            "updatedAt": null
        });
        assert!(serde_json::from_value::<AcpImportSessionRequest>(complete).is_ok());
        assert!(
            serde_json::from_value::<AcpImportSessionRequest>(json!({
                "sessionId": "session-1",
                "cwd": "C:/work/project"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<AcpImportSessionRequest>(json!({
                "sessionId": "session-1",
                "cwd": "C:/work/project",
                "title": null,
                "updatedAt": null,
                "owner": null
            }))
            .is_err()
        );
    }

    #[test]
    fn acp_session_config_requests_are_closed_complete_objects() {
        assert!(
            serde_json::from_value::<AcpSessionConfigReadRequest>(json!({
                "conversationId": "conversation-1"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<AcpSessionConfigReadRequest>(json!({
                "conversationId": "conversation-1",
                "cached": true
            }))
            .is_err()
        );

        assert!(
            serde_json::from_value::<AcpSessionConfigUpdateRequest>(json!({
                "conversationId": "conversation-1",
                "configId": "model",
                "value": "sonnet"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<AcpSessionConfigUpdateRequest>(json!({
                "conversationId": "conversation-1",
                "configId": "model"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<AcpSessionConfigUpdateRequest>(json!({
                "conversationId": "conversation-1",
                "configId": "model",
                "value": "sonnet",
                "optimistic": true
            }))
            .is_err()
        );
    }

    #[test]
    fn acp_session_config_response_serializes_nullable_keys_as_null() {
        let response = AcpConfigOptionInfoResponse {
            id: "model".into(),
            name: "Model".into(),
            description: None,
            category: None,
            kind: None,
            current_value: None,
            options: vec![AcpConfigOptionValueInfoResponse {
                value: "sonnet".into(),
                name: "Sonnet".into(),
                description: None,
            }],
        };
        let value = serde_json::to_value(response).unwrap();

        assert_eq!(value["description"], serde_json::Value::Null);
        assert_eq!(value["category"], serde_json::Value::Null);
        assert_eq!(value["type"], serde_json::Value::Null);
        assert_eq!(value["currentValue"], serde_json::Value::Null);
        assert_eq!(value["options"][0]["description"], serde_json::Value::Null);
    }
}
