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
    // request events
    pub request_type: Option<String>,
    pub comment: Option<String>,
    pub flag: Option<String>,
    pub via: Option<String>,
    pub invitor_id: Option<i64>,
    pub source_group_id: Option<i64>,
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

    /// Private-chat only: shows the "typing…" indicator (event_type 1 = typing).
    pub fn set_input_status(user_id: i64, event_type: i32) -> Self {
        Self {
            action: "set_input_status".into(),
            params: serde_json::json!({
                "user_id": user_id,
                "event_type": event_type,
            }),
            echo: None,
        }
    }

    /// Group-chat only: reacts to a message with a QQ emoji.
    pub fn set_msg_emoji_like(message_id: i64, emoji_id: &str) -> Self {
        let emoji: serde_json::Value = match emoji_id.parse::<i64>() {
            Ok(n) => n.into(),
            Err(_) => emoji_id.into(),
        };
        Self {
            action: "set_msg_emoji_like".into(),
            params: serde_json::json!({
                "message_id": message_id,
                "emoji_id": emoji,
                "set": true,
            }),
            echo: None,
        }
    }

    pub fn voice_msg_to_text(message_id: i64, echo: String) -> Self {
        Self {
            action: "voice_msg_to_text".into(),
            params: serde_json::json!({ "message_id": message_id }),
            echo: Some(echo),
        }
    }

    pub fn ocr_image(image: &str, echo: String) -> Self {
        Self {
            action: "ocr_image".into(),
            params: serde_json::json!({ "image": image }),
            echo: Some(echo),
        }
    }

    pub fn get_group_msg_history(
        group_id: i64,
        message_seq: Option<i64>,
        count: i64,
        echo: String,
    ) -> Self {
        let mut params = serde_json::json!({ "group_id": group_id, "count": count });
        if let Some(seq) = message_seq {
            params["message_seq"] = seq.into();
        }
        Self { action: "get_group_msg_history".into(), params, echo: Some(echo) }
    }

    pub fn get_friend_msg_history(
        user_id: i64,
        message_seq: Option<i64>,
        count: i64,
        echo: String,
    ) -> Self {
        let mut params = serde_json::json!({ "user_id": user_id, "count": count });
        if let Some(seq) = message_seq {
            params["message_seq"] = seq.into();
        }
        Self { action: "get_friend_msg_history".into(), params, echo: Some(echo) }
    }

    pub fn set_friend_add_request(flag: &str, approve: bool, remark: Option<&str>, echo: String) -> Self {
        let mut params = serde_json::json!({ "flag": flag, "approve": approve });
        if let Some(r) = remark.filter(|r| !r.is_empty()) {
            params["remark"] = r.into();
        }
        Self { action: "set_friend_add_request".into(), params, echo: Some(echo) }
    }

    pub fn set_group_add_request(
        flag: &str,
        sub_type: &str,
        approve: bool,
        reason: Option<&str>,
        echo: String,
    ) -> Self {
        let mut params = serde_json::json!({ "flag": flag, "sub_type": sub_type, "approve": approve });
        if let Some(r) = reason.filter(|r| !r.is_empty()) {
            params["reason"] = r.into();
        }
        Self { action: "set_group_add_request".into(), params, echo: Some(echo) }
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
