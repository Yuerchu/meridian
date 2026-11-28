//! Desktop/mobile Tauri character assembly built additively on top of
//! [`meridian_core::agent::character::CharacterBase`].
//!
//! `meridian-core` owns only `CharacterBase` and atomic capability mixins.
//! This module composes the full interactive desktop (and Android) character
//! profile — mounting only capabilities backed by live runtime ports — plus
//! helper builders for delegated sub-agent turns.

use std::sync::Arc;

use meridian_core::agent::character::{CharacterAssembly, CharacterBase};
use meridian_core::agent::hooks::{DeclaredTool, ToolMixin};
use meridian_core::agent::mixins::BuiltinMixin;
use meridian_core::agent::modes::Modes;
use meridian_core::agent::sub_agents::SubAgentCatalog;
use meridian_core::provider::ServerToolKind;
use meridian_core::tools::command_shell::CommandShell;

/// Interactive Meridian desktop / mobile character profile.
pub struct DesktopCharacter;

pub struct DesktopCharacterSpec {
    pub persona: String,
    pub context_blocks: Vec<String>,
    pub mode: Modes,
    pub supports_tools: bool,
    pub server_tools: Vec<ServerToolKind>,
    pub sub_agents: Option<SubAgentCatalog>,
    pub mcp_tools: Vec<DeclaredTool>,
    pub command_shell: Option<CommandShell>,
    pub plugin_mixins: Vec<Arc<dyn ToolMixin>>,
}

impl DesktopCharacter {
    /// Assemble a foreground desktop/mobile conversation character.
    pub fn assemble(spec: DesktopCharacterSpec) -> CharacterAssembly {
        let mut builder = CharacterBase::new(spec.persona)
            .with_mode(spec.mode)
            .with_supports_tools(spec.supports_tools)
            .with_server_tools(spec.server_tools)
            .with_context_blocks(spec.context_blocks)
            .with_builtin(BuiltinMixin::workspace_fs());

        #[cfg(not(target_os = "android"))]
        {
            builder = builder
                .with_builtin(BuiltinMixin::shell_exec(spec.command_shell))
                .with_builtin(BuiltinMixin::BackgroundJobs);
        }
        #[cfg(target_os = "android")]
        let _ = spec.command_shell;

        builder = builder
            .with_builtin(BuiltinMixin::InteractiveUi)
            .with_builtin(BuiltinMixin::PlanMode)
            .with_builtin(BuiltinMixin::Todo)
            .with_builtin(BuiltinMixin::WebSearch)
            .with_builtin(BuiltinMixin::Skills)
            .with_builtin(BuiltinMixin::diagnostics())
            .with_builtin(BuiltinMixin::MediaGen)
            .with_builtin(BuiltinMixin::RedactionTools);

        if let Some(catalog) = spec.sub_agents {
            builder = builder.with_builtin(BuiltinMixin::SubAgent { catalog });
        }

        builder
            .with_builtin(BuiltinMixin::Mcp { tools: spec.mcp_tools })
            .with_builtin(BuiltinMixin::memory())
            .with_builtin(BuiltinMixin::CustomTools)
            .with_plugin_mixins(spec.plugin_mixins)
            .build()
    }
}
