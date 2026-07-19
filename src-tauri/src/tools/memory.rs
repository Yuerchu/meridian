use async_trait::async_trait;
use serde_json::{json, Value};

use super::{Permission, Tool, ToolContext};
use crate::db::models::memory::NewMemory;

fn get_pool_and_project(context: &ToolContext) -> Result<(crate::db::DbPool, String), String> {
    let pool = context.db_pool.as_ref()
        .ok_or("Memory tools require a project context")?
        .clone();
    let project_id = context.project_id.as_ref()
        .ok_or("Memory tools require a project context")?
        .clone();
    Ok((pool, project_id))
}

pub struct SaveMemoryTool;

#[async_trait]
impl Tool for SaveMemoryTool {
    fn name(&self) -> &str { "save_memory" }

    fn description(&self) -> &str {
        "Save or update a persistent memory for the current project. Memories persist across conversations and are automatically injected into your context."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "A short, descriptive key for this memory (e.g. 'user_preference_language', 'important_dates')"
                },
                "content": {
                    "type": "string",
                    "description": "The memory content to store"
                },
                "memory_type": {
                    "type": "string",
                    "enum": ["general", "preference", "fact", "instruction"],
                    "description": "Type of memory. Defaults to 'general'"
                }
            },
            "required": ["key", "content"]
        })
    }

    fn default_permission(&self) -> Permission { Permission::Always }

    async fn execute(&self, args: Value, context: &ToolContext) -> Result<String, String> {
        let (pool, project_id) = get_pool_and_project(context)?;
        let key = args.get("key").and_then(|v| v.as_str())
            .ok_or("Missing required parameter: key")?
            .to_string();
        let content = args.get("content").and_then(|v| v.as_str())
            .ok_or("Missing required parameter: content")?
            .to_string();
        let memory_type = args.get("memory_type").and_then(|v| v.as_str())
            .unwrap_or("general")
            .to_string();

        if content.len() > 10000 {
            return Err("Memory content exceeds maximum length of 10000 characters".to_string());
        }

        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;

            let count = crate::db::ops::memory::count_memories(&mut conn, &project_id)
                .map_err(|e| e.to_string())?;
            let existing = crate::db::ops::memory::get_memory_by_key(&mut conn, &project_id, &key)
                .map_err(|e| e.to_string())?;
            if existing.is_none() && count >= 100 {
                return Err("Maximum of 100 memories per project reached. Delete some before adding new ones.".to_string());
            }

            let id = uuid::Uuid::new_v4().to_string();
            let now = crate::util::now_ms();
            crate::db::ops::memory::upsert_memory(&mut conn, &NewMemory {
                id: &id,
                project_id: &project_id,
                key: &key,
                content: &content,
                memory_type: &memory_type,
                created_at: now,
                updated_at: now,
            }).map_err(|e| e.to_string())?;

            if existing.is_some() {
                Ok(format!("Updated memory '{key}'."))
            } else {
                Ok(format!("Saved memory '{key}'."))
            }
        }).await.map_err(|e| e.to_string())?
    }
}

pub struct RecallMemoryTool;

#[async_trait]
impl Tool for RecallMemoryTool {
    fn name(&self) -> &str { "recall_memory" }

    fn description(&self) -> &str {
        "Recall a specific memory by key from the current project."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "The key of the memory to recall"
                }
            },
            "required": ["key"]
        })
    }

    fn default_permission(&self) -> Permission { Permission::Always }

    async fn execute(&self, args: Value, context: &ToolContext) -> Result<String, String> {
        let (pool, project_id) = get_pool_and_project(context)?;
        let key = args.get("key").and_then(|v| v.as_str())
            .ok_or("Missing required parameter: key")?
            .to_string();

        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            match crate::db::ops::memory::get_memory_by_key(&mut conn, &project_id, &key)
                .map_err(|e| e.to_string())? {
                Some(m) => Ok(format!("[{}] {}: {}", m.memory_type, m.key, m.content)),
                None => Ok(format!("No memory found for key '{key}'.")),
            }
        }).await.map_err(|e| e.to_string())?
    }
}

pub struct ListMemoriesTool;

#[async_trait]
impl Tool for ListMemoriesTool {
    fn name(&self) -> &str { "list_memories" }

    fn description(&self) -> &str {
        "List all stored memories for the current project."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {}
        })
    }

    fn default_permission(&self) -> Permission { Permission::Always }

    async fn execute(&self, _args: Value, context: &ToolContext) -> Result<String, String> {
        let (pool, project_id) = get_pool_and_project(context)?;

        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let memories = crate::db::ops::memory::list_memories(&mut conn, &project_id)
                .map_err(|e| e.to_string())?;

            if memories.is_empty() {
                return Ok("No memories stored.".to_string());
            }

            let mut out = format!("{} memories:\n", memories.len());
            for m in &memories {
                let preview: String = m.content.chars().take(80).collect();
                let ellipsis = if m.content.len() > 80 { "..." } else { "" };
                out.push_str(&format!("- [{}] {}: {}{}\n", m.memory_type, m.key, preview, ellipsis));
            }
            Ok(out)
        }).await.map_err(|e| e.to_string())?
    }
}

pub struct DeleteMemoryTool;

#[async_trait]
impl Tool for DeleteMemoryTool {
    fn name(&self) -> &str { "delete_memory" }

    fn description(&self) -> &str {
        "Delete a memory by key from the current project."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "The key of the memory to delete"
                }
            },
            "required": ["key"]
        })
    }

    fn default_permission(&self) -> Permission { Permission::Always }

    async fn execute(&self, args: Value, context: &ToolContext) -> Result<String, String> {
        let (pool, project_id) = get_pool_and_project(context)?;
        let key = args.get("key").and_then(|v| v.as_str())
            .ok_or("Missing required parameter: key")?
            .to_string();

        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let existing = crate::db::ops::memory::get_memory_by_key(&mut conn, &project_id, &key)
                .map_err(|e| e.to_string())?;
            if existing.is_none() {
                return Ok(format!("No memory found for key '{key}'."));
            }
            crate::db::ops::memory::delete_memory_by_key(&mut conn, &project_id, &key)
                .map_err(|e| e.to_string())?;
            Ok(format!("Deleted memory '{key}'."))
        }).await.map_err(|e| e.to_string())?
    }
}
