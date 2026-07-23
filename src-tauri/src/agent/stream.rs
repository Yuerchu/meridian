use crate::provider;

pub(crate) struct StreamResult {
    pub(crate) text: String,
    pub(crate) reasoning: String,
    pub(crate) tool_calls: Vec<provider::ToolCall>,
    pub(crate) usage: Option<provider::TokenUsage>,
    pub(crate) finish_reason: Option<String>,
}

pub(crate) const MAX_STREAM_RETRIES: u32 = 5;
pub(crate) const STREAM_RETRY_BASE: std::time::Duration = std::time::Duration::from_millis(200);

pub(crate) fn is_context_window_error(err: &str) -> bool {
    let e = err.to_lowercase();
    e.contains("context_length_exceeded") || e.contains("context window")
        || e.contains("maximum context length") || e.contains("too many tokens")
        || e.contains("exceeds the model") || e.contains("status: 413")
        || e.contains("request_too_large") || e.contains("content_too_large")
}

pub(crate) fn is_retryable_stream_error(err: &str) -> bool {
    if is_context_window_error(err) { return false; }
    let e = err.to_lowercase();
    e.contains("timeout") || e.contains("network") || e.contains("connection")
        || e.contains("status: 429") || e.contains("status: 5")
        || e.contains("idle timeout")
}
