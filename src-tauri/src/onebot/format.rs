use std::sync::LazyLock;

use regex::Regex;

use super::protocol::MessageSegment;

const MAX_MSG_LEN: usize = 4000;

/// Private-use sentinels standing in for image/voice placeholders inside parsed
/// text. Users cannot type these, so media processing can split on them without
/// colliding with a literal "[图片]"/"[语音]" the user actually wrote.
pub const IMAGE_SENTINEL: char = '\u{E000}';
pub const RECORD_SENTINEL: char = '\u{E001}';

static AT_MENTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[@[^(\]]*\((\d+)\)\]").unwrap());

/// A media reference extracted from an image segment.
#[derive(Debug, Clone, Default)]
pub struct MediaRef {
    pub url: Option<String>,
    pub file: Option<String>,
}

/// Parsed OneBot message: plain text (with placeholders) plus media references.
#[derive(Debug, Clone, Default)]
pub struct ParsedMessage {
    pub text: String,
    pub images: Vec<MediaRef>,
    pub has_record: bool,
}

impl ParsedMessage {
    pub fn from_text(text: &str) -> Self {
        Self { text: text.to_string(), ..Default::default() }
    }

    pub fn has_media(&self) -> bool {
        !self.images.is_empty() || self.has_record
    }
}

/// Extract plain text from OneBot message segments (array format).
/// Strips @bot mentions when `self_id` is provided. Media sentinels are restored
/// to human-readable "[图片]"/"[语音]" for display paths.
pub fn segments_to_text(message: &serde_json::Value, self_id: Option<i64>) -> String {
    parse_segments(message, self_id)
        .text
        .replace(IMAGE_SENTINEL, "[图片]")
        .replace(RECORD_SENTINEL, "[语音]")
}

/// Parse OneBot message segments into text + media references.
/// Image/voice segments become private-use sentinels (`IMAGE_SENTINEL` /
/// `RECORD_SENTINEL`) so downstream media merging can align by position; use
/// `segments_to_text` when a human-readable string is needed instead.
/// Note: when llbot is configured with message_format=string (CQ codes), media
/// references are not extracted and the raw string is returned as text.
pub fn parse_segments(message: &serde_json::Value, self_id: Option<i64>) -> ParsedMessage {
    let segments = match message.as_array() {
        Some(arr) => arr,
        None => {
            // Might be a raw CQ-code string; fall back to raw_message
            return ParsedMessage::from_text(message.as_str().unwrap_or(""));
        }
    };

    let mut parsed = ParsedMessage::default();
    let mut text = String::new();
    for seg in segments {
        let seg_type = seg.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let data = seg.get("data");
        match seg_type {
            "text" => {
                if let Some(t) = data.and_then(|d| d.get("text")).and_then(|v| v.as_str()) {
                    text.push_str(t);
                }
            }
            "at" => {
                let qq_id: Option<i64> = data
                    .and_then(|d| d.get("qq"))
                    .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or(v.as_i64()));
                if let (Some(sid), Some(qid)) = (self_id, qq_id) {
                    if sid == qid {
                        continue;
                    }
                }
                if let Some(qid) = qq_id {
                    let name = data.and_then(|d| d.get("name")).and_then(|v| v.as_str());
                    match name {
                        Some(n) if !n.is_empty() => text.push_str(&format!("[@{}({})]", n, qid)),
                        _ => text.push_str(&format!("[@{}]", qid)),
                    }
                }
            }
            "image" => {
                text.push(IMAGE_SENTINEL);
                let get_str = |key: &str| -> Option<String> {
                    data.and_then(|d| d.get(key))
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                };
                parsed.images.push(MediaRef {
                    url: get_str("url"),
                    file: get_str("file"),
                });
            }
            "face" => {
                text.push_str("[表情]");
            }
            "record" => {
                text.push(RECORD_SENTINEL);
                parsed.has_record = true;
            }
            "video" => {
                text.push_str("[视频]");
            }
            "file" => {
                text.push_str("[文件]");
            }
            "reply" => {
                // Ignore reply context; we use conversation history instead
            }
            _ => {}
        }
    }
    parsed.text = text.trim().to_string();
    parsed
}

/// Check if the bot is @mentioned in a group message.
pub fn is_at_bot(message: &serde_json::Value, self_id: i64) -> bool {
    let segments = match message.as_array() {
        Some(arr) => arr,
        None => return false,
    };
    segments.iter().any(|seg| {
        seg.get("type").and_then(|v| v.as_str()) == Some("at")
            && seg
                .get("data")
                .and_then(|d| d.get("qq"))
                .and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()).or(v.as_i64()))
                == Some(self_id)
    })
}

pub fn extract_reply_message_id(message: &serde_json::Value) -> Option<i64> {
    let segments = message.as_array()?;
    segments.iter().find_map(|seg| {
        if seg.get("type").and_then(|v| v.as_str()) == Some("reply") {
            seg.get("data")
                .and_then(|d| d.get("id"))
                .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or(v.as_i64()))
        } else {
            None
        }
    })
}

pub fn format_enriched_message(
    text: &str,
    sender_prefix: Option<&str>,
    quoted_message: Option<(&str, &str)>,
) -> String {
    let mut result = String::new();
    if let Some((sender, content)) = quoted_message {
        result.push_str(&format!(
            "<quoted_message sender=\"{}\">{}</quoted_message>\n",
            sender, content
        ));
    }
    if let Some(prefix) = sender_prefix {
        result.push_str(&format!("[{}] ", prefix));
    }
    result.push_str(text);
    result
}

pub fn text_to_rich_segments(text: &str) -> Vec<MessageSegment> {
    let mut segments = Vec::new();
    let mut last_end = 0;
    for cap in AT_MENTION_RE.captures_iter(text) {
        let full_match = cap.get(0).unwrap();
        if full_match.start() > last_end {
            segments.push(MessageSegment::text(&text[last_end..full_match.start()]));
        }
        if let Ok(qq) = cap[1].parse::<i64>() {
            segments.push(MessageSegment::at(qq));
        }
        last_end = full_match.end();
    }
    if last_end < text.len() {
        segments.push(MessageSegment::text(&text[last_end..]));
    }
    if segments.is_empty() {
        segments.push(MessageSegment::text(text));
    }
    segments
}

/// Split a long message into chunks respecting a max length.
/// Tries to split on paragraph boundaries first, then sentence boundaries.
pub fn split_long_message(text: &str) -> Vec<String> {
    if text.len() <= MAX_MSG_LEN {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        if remaining.len() <= MAX_MSG_LEN {
            chunks.push(remaining.to_string());
            break;
        }

        let split_at = find_split_point(remaining, MAX_MSG_LEN);
        let (chunk, rest) = remaining.split_at(split_at);
        chunks.push(chunk.trim_end().to_string());
        remaining = rest.trim_start();
    }

    chunks
}

fn find_split_point(text: &str, max_len: usize) -> usize {
    let mut end = max_len;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    let search_range = &text[..end];

    // Try paragraph boundary
    if let Some(pos) = search_range.rfind("\n\n") {
        if pos > max_len / 4 {
            return pos + 1;
        }
    }

    // Try line boundary
    if let Some(pos) = search_range.rfind('\n') {
        if pos > max_len / 4 {
            return pos + 1;
        }
    }

    // Try sentence boundary (Chinese and English)
    for sep in &["。", ".", "！", "!", "？", "?", "；", ";"] {
        if let Some(pos) = search_range.rfind(sep) {
            if pos > max_len / 4 {
                return pos + sep.len();
            }
        }
    }

    // Last resort: split at char boundary near max_len
    end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_segments_to_text_basic() {
        let msg = serde_json::json!([
            {"type": "text", "data": {"text": "hello "}},
            {"type": "text", "data": {"text": "world"}}
        ]);
        assert_eq!(segments_to_text(&msg, None), "hello world");
    }

    #[test]
    fn test_segments_to_text_strips_bot_at() {
        let msg = serde_json::json!([
            {"type": "at", "data": {"qq": "12345"}},
            {"type": "text", "data": {"text": " hi there"}}
        ]);
        assert_eq!(segments_to_text(&msg, Some(12345)), "hi there");
    }

    #[test]
    fn test_is_at_bot() {
        let msg = serde_json::json!([
            {"type": "at", "data": {"qq": "12345"}},
            {"type": "text", "data": {"text": " hello"}}
        ]);
        assert!(is_at_bot(&msg, 12345));
        assert!(!is_at_bot(&msg, 99999));
    }

    #[test]
    fn test_parse_segments_image() {
        let msg = serde_json::json!([
            {"type": "text", "data": {"text": "看这个 "}},
            {"type": "image", "data": {"file": "a.jpg", "url": "https://example.com/a.jpg", "file_size": "123"}}
        ]);
        let parsed = parse_segments(&msg, None);
        assert_eq!(parsed.text, format!("看这个 {IMAGE_SENTINEL}"));
        assert_eq!(parsed.images.len(), 1);
        assert_eq!(parsed.images[0].url.as_deref(), Some("https://example.com/a.jpg"));
        assert!(parsed.has_media());
    }

    #[test]
    fn test_parse_segments_record() {
        let msg = serde_json::json!([
            {"type": "record", "data": {"file": "b.amr"}}
        ]);
        let parsed = parse_segments(&msg, None);
        assert_eq!(parsed.text, RECORD_SENTINEL.to_string());
        assert!(parsed.has_record);
        assert!(parsed.has_media());
    }

    #[test]
    fn test_segments_to_text_restores_sentinels() {
        let msg = serde_json::json!([
            {"type": "text", "data": {"text": "看这个 "}},
            {"type": "image", "data": {"file": "a.jpg"}},
            {"type": "record", "data": {"file": "b.amr"}}
        ]);
        // parse_segments keeps sentinels; segments_to_text restores them.
        assert_eq!(
            parse_segments(&msg, None).text,
            format!("看这个 {IMAGE_SENTINEL}{RECORD_SENTINEL}")
        );
        assert_eq!(segments_to_text(&msg, None), "看这个 [图片][语音]");
    }

    #[test]
    fn test_split_short_message() {
        let text = "short message";
        let chunks = split_long_message(text);
        assert_eq!(chunks, vec!["short message"]);
    }

    #[test]
    fn test_split_long_chinese_no_panic() {
        let text = "中".repeat(3000); // 9000 bytes, no separators
        let chunks = split_long_message(&text);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn test_split_long_message_on_paragraph() {
        let para1 = "a".repeat(2000);
        let para2 = "b".repeat(2000);
        let text = format!("{}\n\n{}", para1, para2);
        let chunks = split_long_message(&text);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0], para1);
        assert_eq!(chunks[1], para2);
    }
}
