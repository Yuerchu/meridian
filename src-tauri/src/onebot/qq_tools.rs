//! Session-scoped QQ tools exposed to the model during OneBot chats.
//!
//! Security: the target group/user is fixed to the current session at
//! construction time and is NOT part of the tool parameters, so the model
//! cannot read other chats.

use std::sync::Arc;

use super::protocol::OneBotAction;
use super::session::{SessionKey, SessionKind};
use super::{call_api, SharedState};

pub const QQ_HISTORY_TOOL: &str = "qq_get_chat_history";
const MAX_HISTORY_COUNT: i64 = 50;
const MAX_OUTPUT_CHARS: usize = 8000;

pub struct QqToolExecutor {
    state: Arc<SharedState>,
    session: SessionKey,
}

impl QqToolExecutor {
    pub fn new(state: Arc<SharedState>, session: SessionKey) -> Self {
        Self { state, session }
    }

    pub fn definitions(&self) -> Vec<crate::provider::ToolDefinition> {
        let scope = match self.session.kind {
            SessionKind::Group => "本群",
            SessionKind::Private => "本私聊",
        };
        vec![crate::provider::ToolDefinition {
            name: QQ_HISTORY_TOOL.into(),
            description: format!(
                "获取当前 QQ 会话({scope})的历史消息记录。用于了解最近的聊天上下文,\
                 例如回答\"刚才聊了什么\"之类的问题。"
            ),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "count": {
                        "type": "integer",
                        "description": "获取最近多少条消息,1-50,默认 20",
                    },
                },
            }),
        }]
    }

    pub fn owns(&self, name: &str) -> bool {
        name == QQ_HISTORY_TOOL
    }

    pub async fn execute(&self, name: &str, arguments: &str) -> Result<String, String> {
        if name != QQ_HISTORY_TOOL {
            return Err(format!("Unknown QQ tool: {name}"));
        }
        let args: serde_json::Value =
            serde_json::from_str(arguments).unwrap_or_else(|_| serde_json::json!({}));
        let count = args
            .get("count")
            .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
            .unwrap_or(20)
            .clamp(1, MAX_HISTORY_COUNT);

        // Paging by message_seq isn't exposed: the model never sees real seq
        // numbers, so it can only fetch the most recent `count` messages.
        let echo = uuid::Uuid::new_v4().to_string();
        let action = match self.session.kind {
            SessionKind::Group => {
                OneBotAction::get_group_msg_history(self.session.id, None, count, echo)
            }
            SessionKind::Private => {
                OneBotAction::get_friend_msg_history(self.session.id, None, count, echo)
            }
        };

        let data = call_api(&self.state, action).await?;
        let messages = data
            .get("messages")
            .and_then(|m| m.as_array())
            .ok_or("no messages in response")?;
        if messages.is_empty() {
            return Ok("没有获取到历史消息".into());
        }
        Ok(format_history(messages))
    }
}

fn format_history(messages: &[serde_json::Value]) -> String {
    let mut lines = Vec::with_capacity(messages.len());
    for msg in messages {
        let time = msg
            .get("time")
            .and_then(|v| v.as_i64())
            .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
            .map(|dt| {
                dt.with_timezone(&chrono::Local)
                    .format("%m-%d %H:%M")
                    .to_string()
            })
            .unwrap_or_default();
        let sender = msg
            .get("sender")
            .map(|s| {
                s.get("card")
                    .and_then(|v| v.as_str())
                    .filter(|c| !c.is_empty())
                    .or_else(|| s.get("nickname").and_then(|v| v.as_str()))
                    .unwrap_or("?")
            })
            .unwrap_or("?");
        let text = msg
            .get("message")
            .map(|m| super::format::segments_to_text(m, None))
            .filter(|t| !t.is_empty())
            .or_else(|| {
                msg.get("raw_message")
                    .and_then(|v| v.as_str())
                    .map(String::from)
            })
            .unwrap_or_default();
        if text.is_empty() {
            continue;
        }
        lines.push(format!("[{time}] {sender}: {text}"));
    }

    let mut out = lines.join("\n");
    let char_count = out.chars().count();
    if char_count > MAX_OUTPUT_CHARS {
        let skip = char_count - MAX_OUTPUT_CHARS;
        let cut = out.char_indices().nth(skip).map(|(i, _)| i).unwrap_or(0);
        out = format!("(更早的消息已截断)\n{}", &out[cut..]);
    }
    out
}
