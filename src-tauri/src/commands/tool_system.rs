use tauri::Manager;

use crate::db;
use crate::db::models::custom_tool::{CustomTool, CustomToolUpdate, NewCustomTool};
use crate::db::models::tool_category::ToolCategory;
use crate::db::models::tool_preset::{NewToolPreset, ToolPreset, ToolPresetUpdate};
use crate::secrets::{SecretName, SecretScope};
use crate::state::{AppDb, AppSecrets, AppTools};
use crate::util::{double_option, get_conn, now_ms};

/// Rebuild the runtime registry's custom tool set from the DB so permission
/// changes, disables and deletions apply immediately, not on next restart.
fn reload_custom_tools(app: &tauri::AppHandle) {
    let pool = app.state::<AppDb>();
    let registry = app.state::<AppTools>();
    // Callers do not check the outcome, so a failure here means the database was
    // updated but the running registry was not: the user disables a tool, the
    // save succeeds, and the model keeps calling it.
    let mut conn = match pool.0.get() {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!(error = %e, "custom tools not reloaded; the change takes effect on restart");
            return;
        }
    };
    match db::ops::custom_tool::list_enabled_tools(&mut conn) {
        Ok(list) => {
            registry.0.set_custom_tools(
                list.iter()
                    .map(|ct| {
                        std::sync::Arc::new(crate::tools::custom::CustomToolExecutor::from_db(ct))
                            as std::sync::Arc<dyn crate::tools::Tool>
                    })
                    .collect(),
            );
        }
        Err(e) => tracing::warn!(
            error = %e,
            "custom tools not reloaded; the change takes effect on restart"
        ),
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomToolPatch {
    name: Option<String>,
    description: Option<String>,
    command: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    category_id: Option<Option<String>>,
    parameters_schema: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    args_template: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    working_directory: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    timeout_ms: Option<Option<i32>>,
    permission: Option<String>,
    is_enabled: Option<i32>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPresetPatch {
    name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    description: Option<Option<String>>,
    tool_names: Option<String>,
}

#[tauri::command]
pub fn list_tool_categories(app: tauri::AppHandle) -> Result<Vec<ToolCategory>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::tool_category::list_categories(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_custom_tools(app: tauri::AppHandle) -> Result<Vec<CustomTool>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::custom_tool::list_tools(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_custom_tool(
    app: tauri::AppHandle,
    name: String,
    description: String,
    command: String,
    category_id: Option<String>,
    parameters_schema: Option<String>,
    args_template: Option<String>,
    working_directory: Option<String>,
    timeout_ms: Option<i32>,
    permission: Option<String>,
) -> Result<CustomTool, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    let schema = parameters_schema
        .as_deref()
        .unwrap_or(r#"{"type":"object","properties":{}}"#);
    let perm = permission.as_deref().unwrap_or("ask");
    let created = db::ops::custom_tool::create_tool(
        &mut conn,
        &NewCustomTool {
            id: &id,
            name: &name,
            description: &description,
            category_id: category_id.as_deref(),
            parameters_schema: schema,
            command: &command,
            args_template: args_template.as_deref(),
            working_directory: working_directory.as_deref(),
            timeout_ms,
            permission: perm,
            is_enabled: 1,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        },
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    reload_custom_tools(&app);
    Ok(created)
}

#[tauri::command]
pub fn update_custom_tool(app: tauri::AppHandle, id: String, updates: CustomToolPatch) -> Result<CustomTool, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let updated = db::ops::custom_tool::update_tool(
        &mut conn,
        &id,
        &CustomToolUpdate {
            name: updates.name,
            description: updates.description,
            command: updates.command,
            category_id: updates.category_id,
            parameters_schema: updates.parameters_schema,
            args_template: updates.args_template,
            working_directory: updates.working_directory,
            timeout_ms: updates.timeout_ms,
            permission: updates.permission,
            is_enabled: updates.is_enabled,
            updated_at: Some(now_ms()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    reload_custom_tools(&app);
    Ok(updated)
}

#[tauri::command]
pub fn delete_custom_tool(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::custom_tool::delete_tool(&mut conn, &id).map_err(|e| e.to_string())?;
    drop(conn);
    reload_custom_tools(&app);
    Ok(())
}

#[tauri::command]
pub fn list_tool_presets(app: tauri::AppHandle) -> Result<Vec<ToolPreset>, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::tool_preset::list_presets(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tool_preset(
    app: tauri::AppHandle,
    name: String,
    description: Option<String>,
    tool_names: String,
) -> Result<ToolPreset, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    db::ops::tool_preset::create_preset(
        &mut conn,
        &NewToolPreset {
            id: &id,
            name: &name,
            description: description.as_deref(),
            icon: None,
            tool_names: &tool_names,
            is_builtin: 0,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_tool_preset(app: tauri::AppHandle, id: String, updates: ToolPresetPatch) -> Result<ToolPreset, String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::tool_preset::update_preset(
        &mut conn,
        &id,
        &ToolPresetUpdate {
            name: updates.name,
            description: updates.description,
            tool_names: updates.tool_names,
            updated_at: Some(now_ms()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tool_preset(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<AppDb>();
    let mut conn = get_conn(&pool.0)?;
    db::ops::tool_preset::delete_preset(&mut conn, &id).map_err(|e| e.to_string())
}

fn service_secret_name(service: &str) -> String {
    format!("SERVICE_{}_KEY", service.replace('-', "_").to_uppercase())
}

#[tauri::command]
pub fn set_service_key(app: tauri::AppHandle, service: String, key: String) -> Result<(), String> {
    let secrets = app.state::<AppSecrets>();
    let name = service_secret_name(&service);
    let name = SecretName::new(&name).map_err(|e| format!("invalid service name: {e}"))?;
    secrets
        .0
        .set(&SecretScope::Global, &name, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_service_key_exists(app: tauri::AppHandle, service: String) -> Result<bool, String> {
    let secrets = app.state::<AppSecrets>();
    let name = service_secret_name(&service);
    let name = SecretName::new(&name).map_err(|e| format!("invalid service name: {e}"))?;
    let exists = secrets.0.get(&SecretScope::Global, &name).ok().flatten().is_some();
    Ok(exists)
}
