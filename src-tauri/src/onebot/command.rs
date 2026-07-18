use strum::{EnumIter, IntoEnumIterator};

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter)]
pub enum SlashCommand {
    New,
    Compact,
    Model,
    Status,
    Help,
}

impl SlashCommand {
    pub fn from_name(s: &str) -> Option<Self> {
        match s {
            "new" | "reset" => Some(Self::New),
            "compact" => Some(Self::Compact),
            "model" => Some(Self::Model),
            "status" => Some(Self::Status),
            "help" => Some(Self::Help),
            _ => None,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Compact => "compact",
            Self::Model => "model",
            Self::Status => "status",
            Self::Help => "help",
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            Self::New => "重置对话，创建新会话",
            Self::Compact => "压缩上下文",
            Self::Model => "查看或切换模型",
            Self::Status => "查看当前会话状态",
            Self::Help => "显示此帮助",
        }
    }

    pub fn args_hint(&self) -> &'static str {
        match self {
            Self::Compact => " [说明]",
            Self::Model => " [模型名]",
            _ => "",
        }
    }

    pub fn help_text() -> String {
        let mut lines = vec!["可用指令:".to_string()];
        for cmd in Self::iter() {
            lines.push(format!("/{}{} — {}", cmd.name(), cmd.args_hint(), cmd.description()));
        }
        lines.join("\n")
    }
}

/// An admin decision on a pending friend/group request, e.g. "同意 3" / "拒绝3 广告".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestDecision {
    pub approve: bool,
    pub id: u32,
    pub reason: Option<String>,
}

pub fn parse_request_decision(input: &str) -> Option<RequestDecision> {
    let trimmed = input.trim();
    let (approve, rest) = if let Some(r) = trimmed.strip_prefix("同意") {
        (true, r)
    } else if let Some(r) = trimmed.strip_prefix("拒绝") {
        (false, r)
    } else {
        return None;
    };

    let rest = rest.trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let id: u32 = digits.parse().ok()?;
    // The id must be followed by whitespace or end-of-input; otherwise this is
    // ordinary chat like "同意3楼" / "拒绝3个方案", not a request decision.
    let after = &rest[digits.len()..];
    if !after.is_empty() && !after.starts_with(char::is_whitespace) {
        return None;
    }
    let reason = after.trim();
    let reason = (!reason.is_empty()).then(|| reason.to_string());

    Some(RequestDecision { approve, id, reason })
}

pub fn parse_command(input: &str) -> Option<(SlashCommand, &str)> {
    let trimmed = input.trim();
    let without_slash = trimmed.strip_prefix('/')?;
    let (name, args) = match without_slash.find(char::is_whitespace) {
        Some(pos) => (&without_slash[..pos], without_slash[pos..].trim_start()),
        None => (without_slash, ""),
    };
    SlashCommand::from_name(name).map(|cmd| (cmd, args))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_request_decision_approve() {
        assert_eq!(
            parse_request_decision("同意 3"),
            Some(RequestDecision { approve: true, id: 3, reason: None })
        );
        assert_eq!(
            parse_request_decision("同意3"),
            Some(RequestDecision { approve: true, id: 3, reason: None })
        );
    }

    #[test]
    fn test_parse_request_decision_reject_with_reason() {
        assert_eq!(
            parse_request_decision("拒绝3 广告"),
            Some(RequestDecision { approve: false, id: 3, reason: Some("广告".into()) })
        );
    }

    #[test]
    fn test_parse_request_decision_invalid() {
        assert_eq!(parse_request_decision("同意 abc"), None);
        assert_eq!(parse_request_decision("同意"), None);
        assert_eq!(parse_request_decision("hello"), None);
    }

    #[test]
    fn test_parse_request_decision_boundary() {
        // Digits glued to non-space text are ordinary chat, not a decision.
        assert_eq!(parse_request_decision("同意3楼"), None);
        assert_eq!(parse_request_decision("拒绝3个方案"), None);
        // A space before the reason keeps it a valid decision.
        assert_eq!(
            parse_request_decision("同意 3 广告"),
            Some(RequestDecision { approve: true, id: 3, reason: Some("广告".into()) })
        );
        // Bare id with no trailing text is still valid.
        assert_eq!(
            parse_request_decision("同意3"),
            Some(RequestDecision { approve: true, id: 3, reason: None })
        );
    }
}
