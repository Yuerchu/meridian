use std::sync::Arc;

use diesel::sqlite::SqliteConnection;
use tauri::{Emitter, Manager};

use crate::db;
use crate::db::DbPool;
use crate::db::models::assistant::Assistant;
use crate::db::models::conversation::Conversation;
use crate::provider;
use crate::state::{AppDb, AppMcp, AppSecrets, AppTools, CompactBreakers};
use crate::template;
use crate::util::now_ms;
use crate::agent::{do_compact, resolve_provider_config, base_prompt, build_file_access, build_messages, estimate_tokens, file_access_prompt, instruction_budget, load_project_instructions, CompactCircuitBreaker, TokenBudget};

#[tauri::command]
pub async fn compact(
    app: tauri::AppHandle,
    conversation_id: String,
    custom_instructions: Option<String>,
) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    let secrets = app.state::<AppSecrets>();

    let (assistant, keep_recent) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = crate::util::get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let assistant = conv.assistant_id.as_deref()
                .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let keep_recent = assistant.as_ref().map(|a| a.compact_keep_recent as usize).unwrap_or(10);
            Ok::<_, String>((assistant, keep_recent))
        }).await.map_err(|e| e.to_string())??
    };

    app.emit("compact-start", serde_json::json!({
        "conversation_id": &conversation_id,
    })).map_err(|e| e.to_string())?;

    let result = do_compact(&pool, &secrets.0, &conversation_id, assistant.as_ref(), keep_recent, custom_instructions.as_deref()).await;

    app.emit("compact-done", serde_json::json!({
        "conversation_id": &conversation_id,
    })).map_err(|e| e.to_string())?;

    result?;
    Ok(())
}

#[tauri::command]
pub async fn get_conversation(app: tauri::AppHandle, id: String) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::get_conversation(&mut conn, &id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_conversations(app: tauri::AppHandle, archived: bool) -> Result<Vec<Conversation>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::list_conversations(&mut conn, archived).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_conversation(app: tauri::AppHandle, title: Option<String>, project_id: Option<String>) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let default_assistant = db::ops::assistant::get_default_assistant(&mut conn)
            .map_err(|e| e.to_string())?;
        let assistant_id = default_assistant.as_ref().map(|a| a.id.as_str());
        db::ops::conversation::create_conversation(&mut conn, &id, title.as_deref(), assistant_id, project_id.as_deref(), now_ms())
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_conversation_assistant(
    app: tauri::AppHandle,
    id: String,
    assistant_id: Option<String>,
) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::update_assistant(&mut conn, &id, assistant_id.as_deref(), now_ms())
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_conversation_reasoning_prefs(
    app: tauri::AppHandle,
    id: String,
    thinking_level: Option<String>,
    fast_mode: bool,
) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::update_reasoning_prefs(
            &mut conn,
            &id,
            thinking_level.as_deref(),
            fast_mode,
            now_ms(),
        )
        .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_conversation_title(app: tauri::AppHandle, id: String, title: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::update_title(&mut conn, &id, &title, now_ms()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_pin_conversation(app: tauri::AppHandle, id: String) -> Result<Conversation, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::toggle_pin(&mut conn, &id, now_ms()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_conversation(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>().0.clone();
    let attachments_dir = app.path().app_data_dir().ok()
        .map(|d| crate::files::conversation_files_dir(&d, &id));
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::delete_conversation(&mut conn, &id).map_err(|e| e.to_string())?;
        // Remove the conversation's on-disk attachments (best-effort); the DB row
        // is the source of truth, so a failed cleanup must not fail the delete.
        if let Some(dir) = attachments_dir {
            if dir.exists() {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
        Ok::<_, String>(())
    }).await.map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
pub struct ContextInfo {
    pub estimated_tokens: usize,
    pub context_limit: usize,
    pub compact_threshold: usize,
    pub auto_compact_enabled: bool,
    pub circuit_breaker_state: String,
    pub message_count: usize,
}

/// Concatenate the system prompt from its parts, in the order
/// `commands::chat::chat` assembles them: agent baseline, resolved assistant
/// persona, project instructions, file-access notice.
///
/// The memory block is not part of this any more — it is sent as a user-role
/// message — but it still has to be counted, so it is added to the total
/// separately by the caller.
fn compose_system_prompt(
    base_block: Option<&str>,
    persona: &str,
    instructions: &str,
    file_access: &str,
) -> String {
    let base = base_block.map(|b| format!("{b}\n\n")).unwrap_or_default();
    format!("{base}{persona}{instructions}{file_access}")
}

/// The persona (template variables resolved) and the project memory block — the
/// system-prompt parts that come straight out of the database. Split out from
/// `assemble_system_prompt` so it can be exercised without an app handle.
fn load_persona_and_memory(
    conn: &mut SqliteConnection,
    assistant: Option<&Assistant>,
    project_id: Option<&str>,
) -> (String, String) {
    let raw_prompt = assistant.map(|a| a.system_prompt.as_str()).unwrap_or("");
    let user_name = db::ops::preference::get_preference(conn, "user_name").ok().flatten();
    let mut ctx = template::build_context(
        assistant.map(|a| a.name.as_str()),
        user_name.as_deref(),
    );
    if let Some(a) = assistant {
        if let Some(block) = db::ops::emoji::format_emoji_list_block(conn, &a.id) {
            ctx.set("emoji_list", &block);
        }
    }
    let persona = template::resolve(raw_prompt, &ctx);
    let memory = crate::agent::load_memory_block_sync(
        conn,
        &crate::agent::MemoryRequest::desktop(
            project_id.map(|s| s.to_string()),
            // Counting uses the largest bracket: an under-reported figure is
            // worse than a slightly generous one.
            crate::agent::memory_budget(usize::MAX),
        ),
    )
    .unwrap_or_default();
    (persona, memory)
}

/// Rebuild the system prompt the way `commands::chat::chat` does, so the token
/// figure the UI reports covers what a turn actually sends. Counting the
/// history alone understated it by the whole baseline + persona + project
/// instructions + memory, which on a project session is the larger share.
///
/// Deliberately still outside the count (the chat loop's own budget does not
/// count them either): the JSON tool schemas sent alongside the messages, and
/// anything the loop injects mid-turn — skill bodies pulled in by `load_skill`,
/// and tool results that are not persisted yet.
/// Returns `(system_prompt, memory_block)`. They are counted together but sent
/// separately: the memory block travels as a user-role message.
async fn assemble_system_prompt(
    app: &tauri::AppHandle,
    pool: &DbPool,
    assistant: Option<&Assistant>,
    project_path: Option<&str>,
    project_id: Option<&str>,
    context_limit: usize,
) -> (String, String) {
    // Tools are resolved first because the agent baseline only emits lines for
    // tools that are actually enabled — same ordering as the chat path.
    let enabled_tools: Option<Vec<String>> =
        if let Some(preset_id) = assistant.and_then(|a| a.tool_preset_id.as_ref()) {
            let pool2 = pool.clone();
            let pid = preset_id.clone();
            tokio::task::spawn_blocking(move || {
                let mut conn = pool2.get().ok()?;
                let preset = db::ops::tool_preset::get_preset(&mut conn, &pid).ok()?;
                serde_json::from_str(&preset.tool_names).ok()
            }).await.ok().flatten()
        } else {
            assistant
                .and_then(|a| a.enabled_tools.as_ref())
                .and_then(|json| serde_json::from_str(json).ok())
        };
    let mcp_defs = {
        let mcp = app.state::<AppMcp>();
        let mgr = mcp.0.lock().await;
        mgr.all_tool_definitions()
    };
    let registry = app.state::<AppTools>().0.clone();
    let mut tool_defs =
        crate::agent::tool_defs::collect(&registry, mcp_defs, enabled_tools.as_deref());
    {
        let pool2 = pool.clone();
        let pid = project_id.map(str::to_string);
        let aid = assistant.map(|a| a.id.clone());
        let available = tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            db::ops::skill_binding::resolve_available(&mut conn, pid.as_deref(), aid.as_deref()).ok()
        }).await.ok().flatten().unwrap_or_default();
        crate::agent::tool_defs::apply_skill_catalog(&mut tool_defs, &available);
    }

    let (persona, memory_block) = {
        let pool2 = pool.clone();
        let assistant = assistant.cloned();
        let pid = project_id.map(str::to_string);
        tokio::task::spawn_blocking(move || {
            let mut conn = pool2.get().ok()?;
            Some(load_persona_and_memory(&mut conn, assistant.as_ref(), pid.as_deref()))
        }).await.ok().flatten().unwrap_or_default()
    };

    let instruction_block = {
        let budget = instruction_budget(context_limit);
        if budget > 0 {
            load_project_instructions(project_path, budget).await
        } else {
            None
        }
    };
    let file_access = build_file_access(pool).await;

    (
        compose_system_prompt(
            base_prompt(&tool_defs).as_deref(),
            &persona,
            instruction_block.as_deref().unwrap_or(""),
            &file_access_prompt(&file_access),
        ),
        memory_block,
    )
}

#[tauri::command]
pub async fn get_context_info(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<ContextInfo, String> {
    let pool = app.state::<AppDb>().0.clone();
    let secrets = app.state::<AppSecrets>();

    let (assistant, history, compact_cursor, project_path, project_id) = {
        let pool = pool.clone();
        let conv_id = conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = crate::util::get_conn(&pool)?;
            let conv = db::ops::conversation::get_conversation(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let assistant = conv.assistant_id.as_deref()
                .and_then(|aid| db::ops::assistant::get_assistant(&mut conn, aid).ok());
            let history = db::ops::message::list_messages(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let project = conv.project_id.as_deref()
                .and_then(|pid| db::ops::project::get_project(&mut conn, pid).ok());
            let project_path = project.as_ref().and_then(|p| p.path.clone());
            let project_id = project.as_ref().map(|p| p.id.clone());
            Ok::<_, String>((assistant, history, conv.compact_cursor, project_path, project_id))
        }).await.map_err(|e| e.to_string())??
    };

    let context_limit = assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128_000);
    let auto_compact_enabled = assistant.as_ref().map(|a| a.auto_compact_enabled != 0).unwrap_or(false);

    let (provider_type, _, _, model, api_format) =
        resolve_provider_config(&secrets.0, &pool, assistant.as_ref())
            .unwrap_or_else(|_| ("openai".into(), String::new(), String::new(), "gpt-4.1-mini".into(), "chat".into()));

    let caps = provider::capabilities::resolve(&provider_type, Some(&api_format), &model);
    let max_output = caps.max_output_tokens.map(|t| t as usize).unwrap_or(16_384);
    let budget = TokenBudget::new(&provider_type, &model, context_limit, max_output, None);

    let (system_prompt, memory_block) = assemble_system_prompt(
        &app,
        &pool,
        assistant.as_ref(),
        project_path.as_deref(),
        project_id.as_deref(),
        context_limit,
    ).await;

    // Mirrors the chat path exactly, memory block included, so the figure the
    // UI shows covers what a turn actually sends.
    let msgs = crate::agent::build_messages_with_senders(
        system_prompt.trim(),
        &history,
        crate::agent::trailing_with_memory(Some(&memory_block), ""),
        compact_cursor,
        &Default::default(),
    );
    let active_messages: Vec<_> = if let Some(cursor) = compact_cursor {
        history.iter().filter(|m| m.sort_order >= cursor || m.is_compact_summary == 1).collect()
    } else {
        history.iter().collect()
    };
    let estimated_tokens = budget.counter.count_messages(&msgs);

    let cb_state = {
        let breakers = app.state::<CompactBreakers>();
        let map = breakers.0.lock().await;
        map.get(&conversation_id)
            .map(|cb| cb.state_label().to_string())
            .unwrap_or_else(|| "closed".to_string())
    };

    Ok(ContextInfo {
        estimated_tokens,
        context_limit,
        compact_threshold: budget.compact_threshold,
        auto_compact_enabled,
        circuit_breaker_state: cb_state,
        message_count: active_messages.len(),
    })
}

#[tauri::command]
pub async fn list_conversations_by_project(app: tauri::AppHandle, project_id: String, archived: bool) -> Result<Vec<Conversation>, String> {
    let pool = app.state::<AppDb>().0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|e| e.to_string())?;
        db::ops::conversation::list_conversations_by_project(&mut conn, &project_id, archived).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::assistant::NewAssistant;
    use crate::db::models::emoji::NewEmoji;
    use crate::db::models::emoji_pack::NewEmojiPack;
    use crate::db::models::memory::NewMemory;
    use crate::db::models::project::NewProject;
    use crate::db::test_db;

    fn make_assistant(conn: &mut SqliteConnection, id: &str, name: &str, prompt: &str) -> Assistant {
        db::ops::assistant::create_assistant(conn, &NewAssistant {
            id,
            name,
            description: None,
            avatar: None,
            system_prompt: prompt,
            provider_id: None,
            model_id: None,
            temperature: None,
            top_p: None,
            max_tokens: None,
            is_default: 0,
            sort_order: 0,
            created_at: 1000,
            updated_at: 1000,
            context_limit: 128_000,
            compact_keep_recent: 10,
            enabled_tools: None,
            thinking_enabled: 0,
            thinking_budget: None,
            tool_preset_id: None,
            auto_compact_enabled: 0,
        }).unwrap()
    }

    fn make_project(conn: &mut SqliteConnection, id: &str) {
        db::ops::project::create_project(conn, &NewProject {
            id,
            name: "Proj",
            path: None,
            source_type: "local",
            source_id: None,
            assistant_id: None,
            description: None,
            created_at: 1000,
            updated_at: 1000,
        }).unwrap();
    }

    #[test]
    fn compose_keeps_the_chat_path_section_order() {
        let out = compose_system_prompt(
            Some("BASE"),
            "PERSONA",
            "\n\nINSTRUCTIONS",
            "\n\nFILEACCESS",
        );
        // Memory is absent by design: it ships as a user-role message now.
        assert_eq!(out, "BASE\n\nPERSONA\n\nINSTRUCTIONS\n\nFILEACCESS");
        // No baseline (no file-editing tools enabled) must not leave padding.
        assert_eq!(compose_system_prompt(None, "PERSONA", "", ""), "PERSONA");
    }

    #[test]
    fn persona_resolves_template_variables_and_memory_is_appended() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        db::ops::preference::set_preference(&mut conn, "user_name", "Yuerchu", 1000).unwrap();
        let assistant = make_assistant(&mut conn, "a1", "Nova", "You are {{assistant_name}} helping {{user_name}}.");
        make_project(&mut conn, "p1");
        db::ops::memory::upsert_memory(&mut conn, &NewMemory {
            id: "m1",
            scope_type: "project",
            scope_id: "p1",
            key: "stack",
            content: "Rust + Tauri",
            memory_type: "general",
            subject_scope_id: None,
            origin: "desktop",
            visibility: "normal",
            source_session_id: None,
            created_at: 1000,
            updated_at: 1000,
        }).unwrap();

        let (persona, memory) = load_persona_and_memory(&mut conn, Some(&assistant), Some("p1"));
        assert_eq!(persona, "You are Nova helping Yuerchu.");
        assert!(memory.contains("<project_memories>"), "got: {memory}");
        assert!(memory.contains("stack: Rust + Tauri"), "got: {memory}");

        // Without a project there is no memory block at all.
        let (_, none) = load_persona_and_memory(&mut conn, Some(&assistant), None);
        assert!(none.is_empty());
    }

    #[test]
    fn persona_expands_the_assigned_sticker_list() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let assistant = make_assistant(&mut conn, "a1", "Nova", "{{emoji_list}}");

        // Nothing assigned: the variable stays literal rather than expanding to
        // an instruction about an empty set.
        let (persona, _) = load_persona_and_memory(&mut conn, Some(&assistant), None);
        assert_eq!(persona, "{{emoji_list}}");

        db::ops::emoji_pack::create_pack(&mut conn, &NewEmojiPack {
            id: "pack1",
            name: "Pack",
            description: None,
            cover_image: None,
            is_builtin: 0,
            sort_order: 0,
            created_at: 1000,
            updated_at: 1000,
        }).unwrap();
        db::ops::emoji::create_emoji(&mut conn, &NewEmoji {
            id: "e1",
            pack_id: "pack1",
            name: "shocked",
            tags: None,
            file_name: "shocked.png",
            file_format: "png",
            sort_order: 0,
            created_at: 1000,
        }).unwrap();
        db::ops::emoji_pack::assign_pack(&mut conn, "a1", "pack1", 1000).unwrap();

        let (persona, _) = load_persona_and_memory(&mut conn, Some(&assistant), None);
        assert!(persona.contains("[emoji:shocked]"), "got: {persona}");
    }

    #[test]
    fn estimated_tokens_account_for_the_system_prompt() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let assistant = make_assistant(
            &mut conn,
            "a1",
            "Nova",
            "You are {{assistant_name}}, a meticulous engineering assistant. \
             Answer precisely and cite the files you touched.",
        );
        make_project(&mut conn, "p1");
        db::ops::memory::upsert_memory(&mut conn, &NewMemory {
            id: "m1",
            scope_type: "project",
            scope_id: "p1",
            key: "stack",
            content: "Rust backend, React frontend, SQLite storage",
            memory_type: "general",
            subject_scope_id: None,
            origin: "desktop",
            visibility: "normal",
            source_session_id: None,
            created_at: 1000,
            updated_at: 1000,
        }).unwrap();

        let (persona, memory) = load_persona_and_memory(&mut conn, Some(&assistant), Some("p1"));
        let system_prompt = compose_system_prompt(
            base_prompt(&[]).as_deref(),
            &persona,
            "",
            "",
        );

        let budget = TokenBudget::new("openai", "gpt-4o", 128_000, 16_384, None);
        // Counted the way the chat path sends it: prompt plus the memory block
        // that now rides along as a user-role message.
        let with_prompt = budget.counter.count_messages(&crate::agent::build_messages_with_senders(
            system_prompt.trim(),
            &[],
            crate::agent::trailing_with_memory(Some(&memory), ""),
            None,
            &Default::default(),
        ));
        let history_only = budget.counter.count_messages(&build_messages("", &[], "", None));

        // The regression this guards: get_context_info used to pass an empty
        // system prompt, so the UI reported a number that excluded it entirely.
        assert!(
            with_prompt > history_only + 20,
            "system prompt must be counted: {with_prompt} vs {history_only}"
        );
    }
}
