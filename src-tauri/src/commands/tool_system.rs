use crate::ServicesExt;
use crate::commands::entity_response::{
    CustomToolInfoResponse, CustomToolListResponse, ToolCategoryListResponse, ToolPresetInfoResponse,
    ToolPresetListResponse,
};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db;
use meridian_core::db::models::custom_tool::{CustomToolChangeset, CustomToolInsert};
use meridian_core::db::models::tool_preset::{ToolPresetChangeset, ToolPresetInsert};
use meridian_core::secrets::{SecretName, SecretScope};
use meridian_core::tools::Permission;
use meridian_core::util::{double_option, get_conn, now_ms};

/// Rebuild the runtime registry's custom tool set from the DB so permission
/// changes, disables and deletions apply immediately, not on next restart.
fn reload_custom_tools(app: &tauri::AppHandle) -> Result<(), String> {
    let services = app.services();
    // A reload failure is part of the command result: reporting a successful
    // save while the running registry kept the old definition is not success.
    let mut conn = services.db.get().map_err(|e| e.to_string())?;
    let list = db::ops::custom_tool::list_enabled_tools(&mut conn).map_err(|e| e.to_string())?;
    let tools = list
        .iter()
        .map(|ct| {
            meridian_core::tools::custom::CustomToolExecutor::from_db(ct)
                .map(|tool| std::sync::Arc::new(tool) as std::sync::Arc<dyn meridian_core::tools::Tool>)
        })
        .collect::<Result<Vec<_>, _>>()?;
    services.tools.set_custom_tools(tools);
    Ok(())
}

fn encode_string_list(items: &[String]) -> Result<String, String> {
    serde_json::to_string(items).map_err(|error| error.to_string())
}

fn encode_json_object(object: &serde_json::Map<String, serde_json::Value>) -> Result<String, String> {
    serde_json::to_string(object).map_err(|error| error.to_string())
}

fn default_parameters_schema() -> serde_json::Map<String, serde_json::Value> {
    let mut schema = serde_json::Map::new();
    schema.insert("type".to_string(), serde_json::Value::String("object".to_string()));
    schema.insert(
        "properties".to_string(),
        serde_json::Value::Object(serde_json::Map::new()),
    );
    schema
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomToolCreateRequest {
    name: String,
    description: String,
    command: String,
    category_id: RequiredNullable<String>,
    parameters_schema: RequiredNullable<serde_json::Map<String, serde_json::Value>>,
    args_template: RequiredNullable<String>,
    working_directory: RequiredNullable<String>,
    timeout_ms: RequiredNullable<i32>,
    permission: RequiredNullable<Permission>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomToolUpdateRequest {
    id: String,
    name: Option<String>,
    description: Option<String>,
    command: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    category_id: Option<Option<String>>,
    parameters_schema: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default, deserialize_with = "double_option")]
    args_template: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    working_directory: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    timeout_ms: Option<Option<i32>>,
    permission: Option<Permission>,
    is_enabled: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolPresetUpdateRequest {
    id: String,
    name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    description: Option<Option<String>>,
    tool_names: Option<Vec<String>>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolPresetCreateRequest {
    name: String,
    description: RequiredNullable<String>,
    tool_names: Vec<String>,
}

#[tauri::command]
pub fn list_tool_categories(app: tauri::AppHandle) -> Result<ToolCategoryListResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::tool_category::list_categories(&mut conn)
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_custom_tools(app: tauri::AppHandle) -> Result<CustomToolListResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let rows = db::ops::custom_tool::list_tools(&mut conn).map_err(|e| e.to_string())?;
    rows.into_iter().map(TryInto::try_into).collect()
}

#[tauri::command]
pub fn create_custom_tool(
    app: tauri::AppHandle,
    request: CustomToolCreateRequest,
) -> Result<CustomToolInfoResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    let parameters_schema = request.parameters_schema.0.unwrap_or_else(default_parameters_schema);
    let encoded_parameters_schema = encode_json_object(&parameters_schema)?;
    let permission = request.permission.0.unwrap_or(Permission::Ask);
    let perm = permission.as_str();
    let created = db::ops::custom_tool::create_tool(
        &mut conn,
        &CustomToolInsert {
            id: &id,
            name: &request.name,
            description: &request.description,
            category_id: request.category_id.0.as_deref(),
            parameters_schema: &encoded_parameters_schema,
            command: &request.command,
            args_template: request.args_template.0.as_deref(),
            working_directory: request.working_directory.0.as_deref(),
            timeout_ms: request.timeout_ms.0,
            permission: perm,
            is_enabled: 1,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        },
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    reload_custom_tools(&app)?;
    created.try_into()
}

#[tauri::command]
pub fn update_custom_tool(
    app: tauri::AppHandle,
    request: CustomToolUpdateRequest,
) -> Result<CustomToolInfoResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let parameters_schema = request.parameters_schema.as_ref().map(encode_json_object).transpose()?;
    let updated = db::ops::custom_tool::update_tool(
        &mut conn,
        &request.id,
        &CustomToolChangeset {
            name: request.name,
            description: request.description,
            command: request.command,
            category_id: request.category_id,
            parameters_schema,
            args_template: request.args_template,
            working_directory: request.working_directory,
            timeout_ms: request.timeout_ms,
            permission: request.permission.map(|permission| permission.as_str().to_string()),
            is_enabled: request.is_enabled.map(i32::from),
            updated_at: Some(now_ms()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    reload_custom_tools(&app)?;
    updated.try_into()
}

#[tauri::command]
pub fn delete_custom_tool(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::custom_tool::delete_tool(&mut conn, &id).map_err(|e| e.to_string())?;
    drop(conn);
    reload_custom_tools(&app)?;
    Ok(())
}

#[tauri::command]
pub fn list_tool_presets(app: tauri::AppHandle) -> Result<ToolPresetListResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let rows = db::ops::tool_preset::list_presets(&mut conn).map_err(|e| e.to_string())?;
    rows.into_iter().map(TryInto::try_into).collect()
}

#[tauri::command]
pub fn create_tool_preset(
    app: tauri::AppHandle,
    request: ToolPresetCreateRequest,
) -> Result<ToolPresetInfoResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    let encoded_tool_names = encode_string_list(&request.tool_names)?;
    let row = db::ops::tool_preset::create_preset(
        &mut conn,
        &ToolPresetInsert {
            id: &id,
            name: &request.name,
            description: request.description.0.as_deref(),
            icon: None,
            tool_names: &encoded_tool_names,
            is_builtin: 0,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        },
    )
    .map_err(|e| e.to_string())?;
    row.try_into()
}

#[tauri::command]
pub fn update_tool_preset(
    app: tauri::AppHandle,
    request: ToolPresetUpdateRequest,
) -> Result<ToolPresetInfoResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let tool_names = request.tool_names.as_deref().map(encode_string_list).transpose()?;
    let row = db::ops::tool_preset::update_preset(
        &mut conn,
        &request.id,
        &ToolPresetChangeset {
            name: request.name,
            description: request.description,
            tool_names,
            updated_at: Some(now_ms()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    row.try_into()
}

#[tauri::command]
pub fn delete_tool_preset(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::tool_preset::delete_preset(&mut conn, &id).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServiceKey {
    Tavily,
    ZhipuSearch,
    FishAudio,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceKeyUpdateRequest {
    pub service: ServiceKey,
    pub key: String,
}

impl ServiceKey {
    fn secret_name(self) -> &'static str {
        match self {
            Self::Tavily => "SERVICE_TAVILY_KEY",
            Self::ZhipuSearch => "SERVICE_ZHIPU_SEARCH_KEY",
            Self::FishAudio => "SERVICE_FISH_AUDIO_KEY",
        }
    }
}

#[tauri::command]
pub fn set_service_key(app: tauri::AppHandle, request: ServiceKeyUpdateRequest) -> Result<(), String> {
    let services = app.services();
    let name = SecretName::new(request.service.secret_name()).expect("service key names are static and valid");
    services
        .secrets
        .set(&SecretScope::Global, &name, &request.key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_service_key_exists(app: tauri::AppHandle, service: ServiceKey) -> Result<bool, String> {
    let services = app.services();
    let name = SecretName::new(service.secret_name()).expect("service key names are static and valid");
    services
        .secrets
        .get(&SecretScope::Global, &name)
        .map(|value| value.is_some())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_tool_update_rejects_unknown_permissions_and_fields() {
        assert!(
            serde_json::from_value::<CustomToolUpdateRequest>(serde_json::json!({
                "id": "tool-1",
                "permission": "future"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<CustomToolUpdateRequest>(serde_json::json!({
                "id": "tool-1",
                "permission": "ask",
                "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<CustomToolUpdateRequest>(serde_json::json!({
                "id": "tool-1",
                "isEnabled": 1
            }))
            .is_err()
        );
    }

    #[test]
    fn service_key_update_request_is_closed_and_typed() {
        assert!(
            serde_json::from_value::<ServiceKeyUpdateRequest>(serde_json::json!({
                "service": "TAVILY",
                "key": "secret"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<ServiceKeyUpdateRequest>(serde_json::json!({
                "service": "FUTURE_SEARCH",
                "key": "secret"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ServiceKeyUpdateRequest>(serde_json::json!({
                "service": "TAVILY",
                "key": "secret",
                "scope": "global"
            }))
            .is_err()
        );
    }

    #[test]
    fn custom_tool_parameters_schema_is_a_json_object() {
        assert!(
            serde_json::from_value::<CustomToolUpdateRequest>(serde_json::json!({
                "id": "tool-1",
                "parametersSchema": {"type": "object", "properties": {}}
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<CustomToolUpdateRequest>(serde_json::json!({
                "id": "tool-1",
                "parametersSchema": "{\"type\":\"object\"}"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<CustomToolUpdateRequest>(serde_json::json!({
                "id": "tool-1",
                "parametersSchema": []
            }))
            .is_err()
        );
    }

    #[test]
    fn service_keys_are_closed() {
        assert!(serde_json::from_str::<ServiceKey>(r#""TAVILY""#).is_ok());
        assert!(serde_json::from_str::<ServiceKey>(r#""FUTURE_SEARCH""#).is_err());
    }
}
