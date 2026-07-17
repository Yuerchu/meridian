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

pub fn parse_command(input: &str) -> Option<(SlashCommand, &str)> {
    let trimmed = input.trim();
    let without_slash = trimmed.strip_prefix('/')?;
    let (name, args) = match without_slash.find(char::is_whitespace) {
        Some(pos) => (&without_slash[..pos], without_slash[pos..].trim_start()),
        None => (without_slash, ""),
    };
    SlashCommand::from_name(name).map(|cmd| (cmd, args))
}
