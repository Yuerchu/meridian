use crate::db::models::message::Message;
use crate::provider::{self, ChatMessage};

use super::tool_calls::{extract_tool_calls_from_blocks, parse_openai_tool_calls};

pub(crate) fn build_messages(
    system_prompt: &str,
    history: &[Message],
    user_message: &str,
    compact_cursor: Option<i32>,
) -> Vec<ChatMessage> {
    let mut msgs = Vec::new();
    if !system_prompt.is_empty() {
        msgs.push(ChatMessage { role: "system".into(), content: system_prompt.into(), reasoning_content: None, tool_calls: None, tool_call_id: None });
    }
    if let Some(cursor) = compact_cursor {
        if let Some(summary) = history.iter().find(|m| m.is_compact_summary == 1) {
            msgs.push(ChatMessage::user(&summary.content));
        }
        for m in history.iter().filter(|m| m.sort_order >= cursor && m.is_compact_summary == 0) {
            push_history_message(&mut msgs, m);
        }
    } else {
        for m in history.iter().filter(|m| m.is_compact_summary == 0) {
            push_history_message(&mut msgs, m);
        }
    }
    msgs.push(ChatMessage::user(user_message));
    msgs
}

fn push_history_message(msgs: &mut Vec<ChatMessage>, m: &Message) {
    match m.role.as_str() {
        "user" => msgs.push(ChatMessage::user(&m.content)),
        "assistant" => {
            let tool_calls = if m.schema_version >= 2 {
                parse_openai_tool_calls(m.tool_calls.as_deref())
            } else {
                m.tool_calls.as_deref()
                    .map(|tc| extract_tool_calls_from_blocks(tc))
                    .unwrap_or_default()
            };
            let reasoning = m.reasoning_content.clone();
            if !tool_calls.is_empty() {
                msgs.push(ChatMessage::assistant_with_tools(&m.content, reasoning, tool_calls));
            } else {
                msgs.push(ChatMessage { role: "assistant".into(), content: m.content.clone(), reasoning_content: reasoning, tool_calls: None, tool_call_id: None });
            }
        }
        "tool" => {
            if let Some(ref call_id) = m.tool_call_id {
                msgs.push(ChatMessage::tool_result(call_id, &m.content));
            }
        }
        _ => {}
    }
}

pub(crate) fn resolve_file_uris_in_messages(messages: &mut [ChatMessage]) {
    for msg in messages.iter_mut() {
        if !msg.content.starts_with('[') { continue; }
        let Ok(mut parts) = serde_json::from_str::<Vec<serde_json::Value>>(&msg.content) else { continue };
        let mut changed = false;
        for part in parts.iter_mut() {
            let url = part.pointer("/image_url/url")
                .or_else(|| part.pointer("/file/url"))
                .and_then(|u| u.as_str())
                .map(String::from);
            if let Some(ref uri) = url {
                if let Some(path) = crate::files::resolve_file_uri(uri) {
                    let mime = mime_guess::from_path(&path).first_or_octet_stream().to_string();
                    if let Ok(data_uri) = crate::files::file_to_base64_data_uri(&path, &mime) {
                        if let Some(img_url) = part.pointer_mut("/image_url/url") {
                            *img_url = serde_json::Value::String(data_uri);
                            changed = true;
                        } else if let Some(file_url) = part.pointer_mut("/file/url") {
                            *file_url = serde_json::Value::String(data_uri);
                            changed = true;
                        }
                    }
                }
            }
        }
        if changed {
            if let Ok(json) = serde_json::to_string(&parts) {
                msg.content = json;
            }
        }
    }
}

pub(crate) fn estimate_tokens(content: &str) -> usize {
    content.chars().count() + 4
}

pub(crate) fn trim_to_context_limit(messages: &mut Vec<ChatMessage>, context_limit: usize, keep_recent: usize) {
    let total_tokens: usize = messages.iter().map(|m| estimate_tokens(&m.content)).sum();
    let safe_limit = context_limit * 4 / 5;
    if total_tokens <= safe_limit {
        return;
    }
    let has_system = messages.first().is_some_and(|m| m.role == "system");
    let system_offset = if has_system { 1 } else { 0 };
    let keep = (keep_recent * 2).min(messages.len().saturating_sub(system_offset));
    let start = messages.len() - keep;
    let mut trimmed = Vec::new();
    if has_system {
        trimmed.push(messages[0].clone());
    }
    trimmed.extend_from_slice(&messages[start..]);
    remove_orphan_tool_messages(&mut trimmed);
    *messages = trimmed;
}

pub(crate) fn remove_orphan_tool_messages(messages: &mut Vec<ChatMessage>) {
    let mut valid_call_ids = std::collections::HashSet::new();
    for m in messages.iter() {
        if let Some(ref tcs) = m.tool_calls {
            for tc in tcs {
                valid_call_ids.insert(tc.id.clone());
            }
        }
    }
    messages.retain(|m| {
        if m.role == "tool" {
            if let Some(ref id) = m.tool_call_id {
                return valid_call_ids.contains(id);
            }
        }
        true
    });
    // Also remove assistant tool_calls whose results were dropped
    let mut valid_result_ids = std::collections::HashSet::new();
    for m in messages.iter() {
        if m.role == "tool" {
            if let Some(ref id) = m.tool_call_id {
                valid_result_ids.insert(id.clone());
            }
        }
    }
    for m in messages.iter_mut() {
        if let Some(ref mut tcs) = m.tool_calls {
            tcs.retain(|tc| valid_result_ids.contains(&tc.id));
            if tcs.is_empty() {
                m.tool_calls = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use provider::ToolCall;

    fn msg(id: &str, role: &str, content: &str) -> Message {
        Message {
            id: id.into(),
            conversation_id: "c".into(),
            role: role.into(),
            content: content.into(),
            provider_id: None,
            model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: None,
            sort_order: 0,
            created_at: 0,
            reasoning_content: None,
            rating: None,
            schema_version: 2,
            is_compact_summary: 0,
        }
    }

    fn chat_msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.into(),
            content: content.into(),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
        }
    }

    #[test]
    fn test_build_messages_with_system() {
        let history = vec![msg("1", "user", "hi")];
        let msgs = build_messages("You are a helper", &history, "new question", None);
        assert_eq!(msgs[0].role, "system");
        assert_eq!(msgs[0].content, "You are a helper");
        assert_eq!(msgs[1].role, "user");
        assert_eq!(msgs[1].content, "hi");
        assert_eq!(msgs[2].role, "user");
        assert_eq!(msgs[2].content, "new question");
    }

    #[test]
    fn test_build_messages_empty_system() {
        let msgs = build_messages("", &[], "hello", None);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "user");
    }

    #[test]
    fn test_build_messages_filters_roles() {
        let history = vec![
            msg("1", "user", "q"),
            msg("2", "tool", "result"),
            msg("3", "assistant", "a"),
        ];
        let msgs = build_messages("sys", &history, "new", None);
        assert_eq!(msgs.len(), 4);
        assert_eq!(msgs[0].role, "system");
        assert_eq!(msgs[1].role, "user");
        assert_eq!(msgs[1].content, "q");
        assert_eq!(msgs[2].role, "assistant");
        assert_eq!(msgs[2].content, "a");
        assert_eq!(msgs[3].role, "user");
        assert_eq!(msgs[3].content, "new");
    }

    #[test]
    fn test_trim_no_trim_needed() {
        let mut msgs = vec![chat_msg("system", "sys"), chat_msg("user", "hi")];
        trim_to_context_limit(&mut msgs, 100_000, 5);
        assert_eq!(msgs.len(), 2);
    }

    #[test]
    fn test_trim_preserves_system() {
        let mut msgs = vec![chat_msg("system", &"s".repeat(1000))];
        for i in 0..20 {
            let role = if i % 2 == 0 { "user" } else { "assistant" };
            msgs.push(chat_msg(role, &"x".repeat(200)));
        }
        trim_to_context_limit(&mut msgs, 500, 2);
        assert_eq!(msgs[0].role, "system");
        assert!(msgs.len() < 21);
    }

    #[test]
    fn test_trim_keeps_recent() {
        let mut msgs = Vec::new();
        for i in 0..10 {
            let role = if i % 2 == 0 { "user" } else { "assistant" };
            msgs.push(chat_msg(role, &format!("msg-{i}")));
        }
        trim_to_context_limit(&mut msgs, 10, 2);
        let last = msgs.last().unwrap();
        assert_eq!(last.content, "msg-9");
    }

    #[test]
    fn test_trim_removes_orphan_tool_results() {
        let mut msgs = vec![
            chat_msg("system", "sys"),
            ChatMessage::assistant_with_tools("I'll call a tool", None, vec![
                ToolCall { id: "call_1".into(), name: "read_file".into(), arguments: "{}".into() },
            ]),
            ChatMessage::tool_result("call_1", "file content"),
            chat_msg("user", &"x".repeat(500)),
            chat_msg("assistant", &"y".repeat(500)),
        ];
        trim_to_context_limit(&mut msgs, 100, 2);
        for m in &msgs {
            if m.role == "tool" {
                let id = m.tool_call_id.as_deref().unwrap();
                let has_call = msgs.iter().any(|am| {
                    am.tool_calls.as_ref().is_some_and(|tcs| tcs.iter().any(|tc| tc.id == id))
                });
                assert!(has_call, "orphan tool result with call_id={id} should have been removed");
            }
        }
    }
}
