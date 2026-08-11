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
    /// What the person actually typed, with everything we stood in for them
    /// left out — no sentinels, no `[图片]`, no `[表情]`.
    ///
    /// `text` cannot answer this. By the time it exists a picture has become
    /// either a private-use codepoint or the literal characters `[图片]`, and
    /// neither is distinguishable from something the user wrote. That does not
    /// matter where the whole message is context, which is most places; it
    /// matters wherever the message is being read as an answer, because a
    /// sticker sent while a tool waits is not a yes, not a reason, and not a
    /// reply to a question.
    pub typed: String,
    pub images: Vec<MediaRef>,
    pub has_record: bool,
}

impl ParsedMessage {
    /// A message that arrived as text and nothing else, so all of it was typed.
    pub fn from_text(text: &str) -> Self {
        Self { text: text.to_string(), typed: text.to_string(), ..Default::default() }
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
    // Built alongside rather than filtered out of `text` afterwards: once a
    // placeholder is in there it is just characters, and `[图片]` is a string a
    // person can type.
    let mut typed = String::new();
    for seg in segments {
        let seg_type = seg.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let data = seg.get("data");
        match seg_type {
            "text" => {
                if let Some(t) = data.and_then(|d| d.get("text")).and_then(|v| v.as_str()) {
                    text.push_str(t);
                    typed.push_str(t);
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
    // Mentions are deliberately absent. Addressing the bot is how a message
    // gets here at all, not something said in it.
    parsed.typed = typed.trim().to_string();
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

/// `ask_user`'s arguments, as a question rather than as a permission request.
///
/// The chat surface has one prompt shape for everything a tool wants, and for
/// this tool that is wrong twice over: the model is not asking to be allowed to
/// do something, and what it is actually asking never appeared — the person saw
/// the tool's name and its raw JSON and was invited to reply `Y`.
///
/// Arguments that will not parse still produce a prompt. They come from a model
/// and are the only thing anyone has to go on, so a truncated dump beats
/// silence: the alternative is a question the user is given no way to answer,
/// waiting out its minute.
pub fn ask_user_prompt(arguments: &str) -> String {
    const FOOTER: &str = "\n引用本条消息作答（60秒超时）";
    let questions = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get("questions").and_then(|q| q.as_array()).cloned())
        .unwrap_or_default();

    let mut out = String::from("❓ 助手有个问题:\n");
    let mut asked = 0;
    for q in &questions {
        let Some(text) = q.get("question").and_then(|t| t.as_str()) else { continue };
        asked += 1;
        out.push_str(&format!("\n{text}\n"));
        for (i, opt) in q
            .get("options")
            .and_then(|o| o.as_array())
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            let Some(label) = opt.get("label").and_then(|l| l.as_str()) else { continue };
            match opt.get("description").and_then(|d| d.as_str()) {
                Some(desc) if !desc.is_empty() => {
                    out.push_str(&format!("  {}. {label} — {desc}\n", i + 1))
                }
                _ => out.push_str(&format!("  {}. {label}\n", i + 1)),
            }
        }
    }
    if asked == 0 {
        out.push_str(&format!("\n{}\n", crate::util::take_bytes_at_char_boundary(arguments, 500)));
    }
    out.push_str(FOOTER);
    out
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

    /// Everything we stood in for the user, in one message. None of it was
    /// typed, and `text` cannot say so — by then a picture is either a
    /// private-use codepoint or the five characters `[图片]`, and a person can
    /// type the second one.
    #[test]
    fn what_the_user_typed_leaves_out_what_we_wrote_for_them() {
        let msg = serde_json::json!([
            {"type": "image", "data": {"file": "a.jpg"}},
            {"type": "record", "data": {"file": "b.amr"}},
            {"type": "face", "data": {"id": "1"}},
            {"type": "video", "data": {"file": "c.mp4"}},
            {"type": "file", "data": {"file": "d.zip"}},
        ]);
        let parsed = parse_segments(&msg, None);

        assert!(parsed.typed.is_empty(), "got: {:?}", parsed.typed);
        assert!(!parsed.text.is_empty(), "the message itself is not empty");
    }

    /// And when there are words among it, they are what survives — the ones the
    /// person wrote, without the placeholders wrapped around them.
    #[test]
    fn words_sent_alongside_media_are_kept_and_the_media_is_not() {
        let msg = serde_json::json!([
            {"type": "at", "data": {"qq": "12345"}},
            {"type": "image", "data": {"file": "a.jpg"}},
            {"type": "text", "data": {"text": " 用第二个方案"}},
            {"type": "face", "data": {"id": "1"}},
        ]);
        let parsed = parse_segments(&msg, Some(12345));

        assert_eq!(parsed.typed, "用第二个方案");
        assert!(!parsed.typed.contains(IMAGE_SENTINEL));
        assert!(!parsed.typed.contains("[表情]"));
    }

    /// A message that arrived as nothing but text is all of it typed. This is
    /// the fallback for clients that only send `raw_message`, and it must not
    /// quietly answer nothing.
    #[test]
    fn a_message_that_was_only_ever_text_is_all_typed() {
        assert_eq!(ParsedMessage::from_text("y").typed, "y");
    }

    /// What the QQ user used to be shown for this was the tool's name and its
    /// raw JSON, under "回复 Y 批准" — a permission prompt for something that
    /// was not asking permission, and which never showed the question.
    #[test]
    fn a_question_is_shown_as_a_question() {
        let prompt = ask_user_prompt(
            r#"{"questions":[{"id":"q1","question":"先修哪个?","options":[
                {"label":"压缩","description":"上下文爆了"},
                {"label":"审批"}
            ]}]}"#,
        );

        assert!(prompt.contains("先修哪个?"), "{prompt}");
        assert!(prompt.contains("1. 压缩 — 上下文爆了"), "{prompt}");
        assert!(prompt.contains("2. 审批"), "{prompt}");
        assert!(!prompt.contains("批准"), "still worded as a permission: {prompt}");
        assert!(prompt.contains("引用本条消息作答"), "{prompt}");
    }

    /// The arguments come from a model. A prompt that refused to render would
    /// leave a question nobody can answer, waiting out its minute in silence.
    #[test]
    fn a_malformed_question_still_produces_a_prompt() {
        for args in ["", "{", r#"{"questions":[]}"#, r#"{"questions":"soon"}"#] {
            let prompt = ask_user_prompt(args);
            assert!(prompt.contains("引用本条消息作答"), "{args:?} -> {prompt}");
            assert!(prompt.len() > "❓ 助手有个问题:".len(), "{args:?} -> {prompt}");
        }
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
