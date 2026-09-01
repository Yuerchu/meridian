use crate::ServicesExt;
use crate::commands::entity_response::{PromptTemplateInfoResponse, PromptTemplateListResponse};
use crate::commands::model_config::RequiredNullable;
use meridian_core::db;
use meridian_core::db::models::prompt_template::{PromptTemplateChangeset, PromptTemplateInsert};
use meridian_core::template;
use meridian_core::util::{double_option, get_conn, now_ms};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTemplateCreateRequest {
    name: String,
    category: String,
    template_text: String,
    description: RequiredNullable<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptTemplateUpdateRequest {
    id: String,
    name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    description: Option<Option<String>>,
    category: Option<String>,
    template_text: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TemplateVariableInfoResponse {
    pub name: String,
    pub description_en: String,
    pub description_zh: String,
}

pub type TemplateVariableListResponse = Vec<TemplateVariableInfoResponse>;

#[tauri::command]
pub fn list_prompt_templates(app: tauri::AppHandle) -> Result<PromptTemplateListResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let rows = db::ops::prompt_template::list_templates(&mut conn).map_err(|e| e.to_string())?;
    rows.into_iter().map(TryInto::try_into).collect()
}

#[tauri::command]
pub fn create_prompt_template(
    app: tauri::AppHandle,
    request: PromptTemplateCreateRequest,
) -> Result<PromptTemplateInfoResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    db::ops::prompt_template::create_template(
        &mut conn,
        &PromptTemplateInsert {
            id: &id,
            name: &request.name,
            description: request.description.0.as_deref(),
            category: &request.category,
            template_text: &request.template_text,
            is_builtin: 0,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        },
    )
    .map_err(|e| e.to_string())?
    .try_into()
}

#[tauri::command]
pub fn update_prompt_template(
    app: tauri::AppHandle,
    request: PromptTemplateUpdateRequest,
) -> Result<PromptTemplateInfoResponse, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::prompt_template::update_template(
        &mut conn,
        &request.id,
        &PromptTemplateChangeset {
            name: request.name,
            description: request.description,
            category: request.category,
            template_text: request.template_text,
            updated_at: Some(now_ms()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?
    .try_into()
}

#[tauri::command]
pub fn delete_prompt_template(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::prompt_template::delete_template(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_template_variables(_app: tauri::AppHandle) -> Result<TemplateVariableListResponse, String> {
    Ok(template::available_variables()
        .into_iter()
        .map(|variable| TemplateVariableInfoResponse {
            name: variable.name.to_owned(),
            description_en: variable.description_en.to_owned(),
            description_zh: variable.description_zh.to_owned(),
        })
        .collect())
}
