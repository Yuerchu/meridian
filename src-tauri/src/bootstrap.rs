//! Bringing the app up, given somewhere to put it.
//!
//! Everything here used to live in Tauri's `setup` closure, where it was mixed
//! with tray icons and window handles. The two have nothing to do with each
//! other: opening the database, running migrations and seeding built-ins are the
//! same work whether a window follows or not. What the shell still owns is the
//! one thing only it can answer — where `data_dir` is — so that arrives as an
//! argument and everything downstream is framework-free.
//!
//! Failures are still panics rather than a `Result`. An app whose database
//! cannot be opened has nothing to show anyone, and the existing behaviour is
//! that it says so and stops.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::agent::provider_secret_name;
use crate::db::models::assistant::{AssistantUpdate, NewAssistant};
use crate::db::models::provider::NewProvider;
use crate::db::models::tool_category::NewToolCategory;
use crate::db::models::tool_preset::NewToolPreset;
use crate::events::EventBus;
use crate::secrets::{SecretName, SecretScope, SecretsManager};
use crate::services::{Paths, Services, ServicesInner};
use crate::sleep_inhibitor::AppSleepInhibitor;
use crate::state::{AppSubAgentInboxes, ApprovalWaiters, VoiceState};
use crate::util::now_ms;
use crate::{agent, db, mcp, tools, turn};

/// Open everything the app runs on, in the order it has to happen.
pub(crate) fn bootstrap(data_dir: PathBuf, events: EventBus) -> Services {
    std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");
    crate::logging::attach_file_sink(&data_dir);
    let mgr = Arc::new(SecretsManager::new(data_dir.clone()));

    // Skills live in app-private storage, so unlike project instructions
    // this path stays usable on Android without a SAF grant.
    let skills_root = data_dir.join("skills");
    std::fs::create_dir_all(&skills_root).expect("failed to create skills dir");

    let db_path = data_dir.join("meridian.db");
    let pool = db::init_db(db_path.to_str().expect("invalid db path"));
    // The preference lives in the database, so the first few lines above
    // are recorded at the default level.
    crate::logging::apply_saved_level(&pool);

    // Create default assistant on first run
    {
        let mut conn = pool.get().expect("db connection");
        if db::ops::assistant::get_default_assistant(&mut conn)
            .ok()
            .flatten()
            .is_none()
        {
            let id = uuid::Uuid::new_v4().to_string();
            let now = now_ms();
            let _ = db::ops::assistant::create_assistant(
                &mut conn,
                &NewAssistant {
                    id: &id,
                    name: "Default",
                    description: None,
                    avatar: None,
                    system_prompt: "You are a helpful assistant.",
                    provider_id: None,
                    model_id: None,
                    temperature: None,
                    top_p: None,
                    max_tokens: None,
                    is_default: 1,
                    sort_order: 0,
                    created_at: now,
                    updated_at: now,
                    context_limit: 128000,
                    compact_keep_recent: 10,
                    enabled_tools: None,
                    thinking_enabled: 0,
                    thinking_budget: None,
                    tool_preset_id: None,
                    auto_compact_enabled: 0,
                },
            );
        }
    }

    // Migrate legacy secrets-based provider to DB
    {
        let mut conn = pool.get().expect("db connection");
        let count = db::ops::provider::count_providers(&mut conn).unwrap_or(0);
        if count == 0
            && let Some(api_key) = mgr
                .get(&SecretScope::Global, &SecretName::new("API_KEY").unwrap())
                .ok()
                .flatten()
        {
            let provider_type = mgr
                .get(&SecretScope::Global, &SecretName::new("PROVIDER_TYPE").unwrap())
                .ok()
                .flatten()
                .unwrap_or_else(|| "openai".into());
            let base_url = mgr
                .get(&SecretScope::Global, &SecretName::new("API_BASE").unwrap())
                .ok()
                .flatten()
                .unwrap_or_else(|| "https://api.openai.com/v1".into());
            let model = mgr
                .get(&SecretScope::Global, &SecretName::new("MODEL").unwrap())
                .ok()
                .flatten();

            let pid = uuid::Uuid::new_v4().to_string();
            let now = now_ms();
            if let Ok(provider) = db::ops::provider::create_provider(
                &mut conn,
                &NewProvider {
                    id: &pid,
                    name: "Default",
                    provider_type: &provider_type,
                    base_url: &base_url,
                    is_enabled: 1,
                    sort_order: 0,
                    created_at: now,
                    updated_at: now,
                    api_format: "chat_completions",
                },
            ) {
                let key_name = provider_secret_name(&provider.id);
                let _ = mgr.set(&SecretScope::Global, &SecretName::new(&key_name).unwrap(), &api_key);
                // Link default assistant to this provider
                if let Ok(Some(default_assistant)) = db::ops::assistant::get_default_assistant(&mut conn) {
                    let changeset = AssistantUpdate {
                        provider_id: Some(Some(provider.id.clone())),
                        model_id: model.map(Some),
                        updated_at: Some(now),
                        ..Default::default()
                    };
                    let _ = db::ops::assistant::update_assistant(&mut conn, &default_assistant.id, &changeset);
                }
            }
        }
    }

    // `prompt_templates` is user-owned storage for reusable persona
    // prompts; nothing is seeded into it. The built-in agent baseline
    // lives in `agent::base_prompt` instead, so it can be revised on
    // upgrade rather than frozen into a first-run seed.

    // Seed built-in tool categories and presets
    {
        let mut conn = pool.get().expect("db connection");
        if db::ops::tool_category::count_categories(&mut conn).unwrap_or(0) == 0 {
            let now = now_ms();
            let cats = [
                ("cat_interaction", "Interaction", "User interaction tools", 0),
                ("cat_filesystem", "Filesystem", "File and directory operations", 1),
                ("cat_system", "System", "System and shell commands", 2),
                ("cat_coding", "Coding", "Code analysis and editing", 3),
            ];
            for (id, name, desc, order) in &cats {
                let _ = db::ops::tool_category::create_category(
                    &mut conn,
                    &NewToolCategory {
                        id,
                        name,
                        description: Some(desc),
                        icon: None,
                        sort_order: *order,
                        created_at: now,
                    },
                );
            }
        }
        {
            let now = now_ms();
            let presets = [
                (
                    "preset_coding",
                    "Coding Agent",
                    "All tools for coding tasks",
                    r#"["ask_user","update_todos","read_file","write_file","edit_file","apply_patch","run_command","list_directory","search_files","glob","read_app_logs"]"#,
                    0,
                ),
                (
                    "preset_research",
                    "Research",
                    "Minimal tools for research and reading",
                    r#"["ask_user","read_file","list_directory","search_files","glob","web_search","read_app_logs"]"#,
                    1,
                ),
                (
                    "preset_writing",
                    "Writing",
                    "Tools for writing and editing files",
                    r#"["ask_user","read_file","write_file","edit_file"]"#,
                    2,
                ),
            ];
            // Seed per id (not only on an empty table) so existing installs
            // pick up newly added built-in presets.
            for (id, name, desc, tools_json, order) in &presets {
                if db::ops::tool_preset::get_preset(&mut conn, id).is_err() {
                    let _ = db::ops::tool_preset::create_preset(
                        &mut conn,
                        &NewToolPreset {
                            id,
                            name,
                            description: Some(desc),
                            icon: None,
                            tool_names: tools_json,
                            is_builtin: 1,
                            sort_order: *order,
                            created_at: now,
                            updated_at: now,
                        },
                    );
                }
            }
            // Repair presets from earlier seeds: "glob_files" never existed
            // (real tool name is "glob"), the built-in Research preset
            // gained web_search, and Coding gained update_todos.
            if let Ok(existing) = db::ops::tool_preset::list_presets(&mut conn) {
                for p in existing {
                    let Ok(mut names) = serde_json::from_str::<Vec<String>>(&p.tool_names) else {
                        continue;
                    };
                    let mut changed = false;
                    for n in names.iter_mut() {
                        if n == "glob_files" {
                            *n = "glob".into();
                            changed = true;
                        }
                    }
                    if p.id == "preset_research" && p.is_builtin == 1 && !names.iter().any(|n| n == "web_search") {
                        names.push("web_search".into());
                        changed = true;
                    }
                    if p.id == "preset_coding" && p.is_builtin == 1 && !names.iter().any(|n| n == "update_todos") {
                        names.push("update_todos".into());
                        changed = true;
                    }
                    // Diagnosing a failure is useful in both, and this
                    // backfill is what reaches installs that already ran
                    // the seed above.
                    if matches!(p.id.as_str(), "preset_coding" | "preset_research")
                        && p.is_builtin == 1
                        && !names.iter().any(|n| n == "read_app_logs")
                    {
                        names.push("read_app_logs".into());
                        changed = true;
                    }
                    if changed {
                        let _ = db::ops::tool_preset::update_preset(
                            &mut conn,
                            &p.id,
                            &db::models::tool_preset::ToolPresetUpdate {
                                tool_names: serde_json::to_string(&names).ok(),
                                updated_at: Some(now),
                                ..Default::default()
                            },
                        );
                    }
                }
            }
        }
    }

    // Load custom tools from DB into tool registry
    let registry = tools::ToolRegistry::new(skills_root.clone(), data_dir.join("logs"));
    {
        let mut conn = pool.get().expect("db connection");
        match db::ops::custom_tool::list_enabled_tools(&mut conn) {
            Ok(custom_tools) => {
                registry.set_custom_tools(
                    custom_tools
                        .iter()
                        .map(|ct| Arc::new(tools::custom::CustomToolExecutor::from_db(ct)) as Arc<dyn tools::Tool>)
                        .collect(),
                );
            }
            // Silently leaves the registry with no custom tools at all,
            // which the user reads as "my tools are gone".
            Err(e) => tracing::error!(error = %e, "custom tools could not be loaded at startup"),
        }
    }

    // Regenerate the manual against this build's tool set, then index
    // every skill on disk. Order matters: the manual has to exist before
    // the scan or it will not be picked up until the next launch.
    {
        // Run the mode filter even though the manual is mode-agnostic:
        // a mode's exit tool lives in the registry but is only offered
        // inside that mode, so listing it here would point the model at
        // a tool that gets refused in every ordinary conversation.
        let mut tool_defs = agent::tool_defs::collect(&registry, Vec::new(), None);
        agent::tool_defs::apply_mode(
            &mut tool_defs,
            // Switchable: the manual describes what a desktop
            // conversation can do, and entering plan mode is part of it.
            agent::modes::Modes::Switchable(agent::modes::resolve(None)),
            &registry,
        );
        if let Err(e) = agent::manual::write_manual(&skills_root, &tool_defs) {
            tracing::error!(error = %e, "failed to write the manual skill");
        }
        if let Err(e) = agent::diagnostics::write_diagnostics(&skills_root) {
            tracing::error!(error = %e, "failed to write the diagnostics skill");
        }
        let mut conn = pool.get().expect("db connection");
        if let Err(e) = agent::skills::sync_index(&mut conn, &skills_root) {
            tracing::error!(error = %e, "failed to index skills");
        }
        // After the index, which creates the rows the bindings point at.
        agent::skills::seed_builtin_bindings(&mut conn);
    }

    Services::new(ServicesInner {
        db: pool,
        secrets: mgr,
        tools: Arc::new(registry),
        mcp: mcp::McpRegistry::new(),
        turns: Arc::new(turn::TurnCoordinator::new()),
        approvals: ApprovalWaiters::new(),
        sub_agent_inboxes: AppSubAgentInboxes::default(),
        compact_breakers: Mutex::new(HashMap::new()),
        voice: VoiceState::new(),
        sleep: AppSleepInhibitor::new(),
        events,
        paths: Paths { data_dir, skills_root },
    })
}

/// Reconnect whatever the user marked for auto-connect.
///
/// Detached from startup, so a server that takes ten seconds does not hold up
/// the window, and concurrent, so the slowest one does not decide when the rest
/// come up. Going through the same entry point as the settings page matters: its
/// idempotence is what stops this and a hand-clicked Connect from starting two
/// processes for one server.
pub(crate) async fn reconnect_mcp(services: Services) {
    let pool = services.db.clone();
    let servers = tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().ok()?;
        db::ops::mcp_server::list_enabled_mcp_servers(&mut conn).ok()
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_default();
    if servers.is_empty() {
        return;
    }
    let registry = services.mcp.clone();
    let attempts = servers.into_iter().map(|server| {
        let registry = registry.clone();
        async move {
            // Logged rather than surfaced: nobody is looking at
            // the settings page yet, and one broken server must
            // not stop the others from coming up.
            if let Err(e) = registry.connect(&server).await {
                tracing::warn!(
                    server_id = %server.id,
                    server_name = %server.name,
                    error = %e,
                    "MCP server failed to auto-connect at startup"
                );
            }
        }
    });
    futures::future::join_all(attempts).await;
}
