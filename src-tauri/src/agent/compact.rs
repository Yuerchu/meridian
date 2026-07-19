use crate::db::{self, DbPool};
use crate::db::models::assistant::Assistant;
use crate::db::models::message::NewMessage;
use crate::provider;
use crate::secrets::SecretsManager;
use crate::util::{get_conn, now_ms};
use super::provider_config::resolve_provider_config;

pub(crate) const COMPACT_PROMPT: &str = "You are a summarization assistant. Given the conversation below, produce a concise structured summary that preserves all essential context for continuing the task. Include:\n\n1. **Primary Request**: What the user originally asked for\n2. **Key Context**: Important facts, constraints, decisions, file paths, and code details\n3. **Current State**: What has been accomplished so far\n4. **Pending Tasks**: Any outstanding items or next steps\n\nBe thorough but concise. Do NOT use tool calls. Respond with ONLY the summary text.";

pub(crate) async fn do_compact(
    pool: &DbPool,
    secrets: &SecretsManager,
    conversation_id: &str,
    assistant: Option<&Assistant>,
    keep_recent: usize,
    custom_instructions: Option<&str>,
) -> Result<i32, String> {
    let history = {
        let pool = pool.clone();
        let conv_id = conversation_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::message::list_messages(&mut conn, &conv_id).map_err(|e| e.to_string())
        }).await.map_err(|e| e.to_string())??
    };

    let active_messages: Vec<&db::models::message::Message> = history.iter()
        .filter(|m| m.is_compact_summary == 0)
        .collect();

    let min_messages = keep_recent * 2 + 2;
    if active_messages.len() < min_messages {
        return Err("Not enough messages to compact".into());
    }

    let boundary_idx = active_messages.len() - keep_recent * 2;
    let cursor_sort_order = active_messages[boundary_idx].sort_order;

    let mut conversation_text = String::new();
    for m in &active_messages[..boundary_idx] {
        let role_label = match m.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            "tool" => "Tool Result",
            _ => continue,
        };
        conversation_text.push_str(&format!("### {}\n{}\n\n", role_label, m.content));
    }

    let mut compact_system = COMPACT_PROMPT.to_string();
    if let Some(instructions) = custom_instructions {
        compact_system.push_str(&format!("\n\nAdditional instructions: {instructions}"));
    }

    let compact_messages = vec![
        provider::ChatMessage { role: "system".into(), content: compact_system, reasoning_content: None, tool_calls: None, tool_call_id: None },
        provider::ChatMessage::user(&conversation_text),
    ];

    let (provider_type, base_url, api_key, model, api_format) =
        resolve_provider_config(secrets, pool, assistant)?;
    let prov = provider::registry::create_provider(&provider_type, &base_url, &api_key, Some(&api_format));

    let params = provider::ChatParams {
        model,
        temperature: Some(0.3),
        max_tokens: Some(4096),
        ..provider::ChatParams::default()
    };

    let summary = prov.chat(compact_messages, params).await
        .map_err(|e| format!("Compact summarization failed: {e}"))?;

    {
        let pool = pool.clone();
        let conv_id = conversation_id.to_string();
        let summary_content = summary;
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::message::delete_compact_summaries(&mut conn, &conv_id)
                .map_err(|e| e.to_string())?;
            let msg_id = uuid::Uuid::new_v4().to_string();
            let now = now_ms();
            db::ops::message::insert_message(&mut conn, &NewMessage {
                id: &msg_id, conversation_id: &conv_id, role: "user",
                content: &summary_content,
                provider_id: None, model_id: None,
                input_tokens: None, output_tokens: None,
                tool_calls: None, tool_call_id: None,
                sort_order: -1, created_at: now,
                reasoning_content: None, rating: None,
                schema_version: 2, is_compact_summary: 1,
            }).map_err(|e| e.to_string())?;
            db::ops::conversation::update_compact_cursor(&mut conn, &conv_id, Some(cursor_sort_order), now)
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    Ok(cursor_sort_order)
}
