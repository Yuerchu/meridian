use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct OneBotResponse {
    pub status: Option<String>,
    pub retcode: Option<i32>,
    pub data: Option<serde_json::Value>,
    pub echo: Option<String>,
}

pub enum OneBotFrame {
    Event(OneBotEvent),
    Response(OneBotResponse),
}

pub fn parse_frame(text: &str) -> Option<OneBotFrame> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    if v.get("post_type").is_some() {
        serde_json::from_value(v).ok().map(OneBotFrame::Event)
    } else if v.get("retcode").is_some() || v.get("echo").is_some() {
        serde_json::from_value(v).ok().map(OneBotFrame::Response)
    } else {
        None
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct OneBotEvent {
    #[serde(default)]
    pub time: i64,
    pub self_id: Option<i64>,
    pub post_type: String,
    pub message_type: Option<String>,
    pub sub_type: Option<String>,
    pub message_id: Option<i64>,
    pub user_id: Option<i64>,
    pub group_id: Option<i64>,
    pub message: Option<serde_json::Value>,
    pub raw_message: Option<String>,
    pub sender: Option<Sender>,
    pub meta_event_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Sender {
    pub user_id: Option<i64>,
    pub nickname: Option<String>,
    pub card: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageSegment {
    #[serde(rename = "type")]
    pub seg_type: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct OneBotAction {
    pub action: String,
    pub params: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub echo: Option<String>,
}

impl OneBotAction {
    pub fn get_msg(message_id: i64, echo: String) -> Self {
        Self {
            action: "get_msg".into(),
            params: serde_json::json!({ "message_id": message_id }),
            echo: Some(echo),
        }
    }

    pub fn send_private_msg(user_id: i64, message: Vec<MessageSegment>) -> Self {
        Self {
            action: "send_private_msg".into(),
            params: serde_json::json!({
                "user_id": user_id,
                "message": message,
            }),
            echo: None,
        }
    }

    pub fn send_group_msg(group_id: i64, message: Vec<MessageSegment>) -> Self {
        Self {
            action: "send_group_msg".into(),
            params: serde_json::json!({
                "group_id": group_id,
                "message": message,
            }),
            echo: None,
        }
    }
}

impl MessageSegment {
    pub fn text(text: &str) -> Self {
        Self {
            seg_type: "text".into(),
            data: serde_json::json!({ "text": text }),
        }
    }

    pub fn at(user_id: i64) -> Self {
        Self {
            seg_type: "at".into(),
            data: serde_json::json!({ "qq": user_id.to_string() }),
        }
    }

    pub fn reply(message_id: i64) -> Self {
        Self {
            seg_type: "reply".into(),
            data: serde_json::json!({ "id": message_id.to_string() }),
        }
    }
}
