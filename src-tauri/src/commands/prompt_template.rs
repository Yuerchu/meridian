use crate::ServicesExt;
use crate::db;
use crate::db::models::prompt_template::{NewPromptTemplate, PromptTemplate, PromptTemplateUpdate};
use crate::template;
use crate::util::{double_option, get_conn, now_ms};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplatePatch {
    name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    description: Option<Option<String>>,
    category: Option<String>,
    template_text: Option<String>,
}

#[tauri::command]
pub fn list_prompt_templates(app: tauri::AppHandle) -> Result<Vec<PromptTemplate>, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::prompt_template::list_templates(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_prompt_template(
    app: tauri::AppHandle,
    name: String,
    category: String,
    template_text: String,
    description: Option<String>,
) -> Result<PromptTemplate, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    db::ops::prompt_template::create_template(
        &mut conn,
        &NewPromptTemplate {
            id: &id,
            name: &name,
            description: description.as_deref(),
            category: &category,
            template_text: &template_text,
            is_builtin: 0,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_prompt_template(
    app: tauri::AppHandle,
    id: String,
    updates: PromptTemplatePatch,
) -> Result<PromptTemplate, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::prompt_template::update_template(
        &mut conn,
        &id,
        &PromptTemplateUpdate {
            name: updates.name,
            description: updates.description,
            category: updates.category,
            template_text: updates.template_text,
            updated_at: Some(now_ms()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_prompt_template(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::prompt_template::delete_template(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_template_variables() -> Result<serde_json::Value, String> {
    let vars: Vec<serde_json::Value> = template::available_variables()
        .into_iter()
        .map(|v| {
            serde_json::json!({
                "name": v.name,
                "description_en": v.description_en,
                "description_zh": v.description_zh,
            })
        })
        .collect();
    Ok(serde_json::json!(vars))
}
