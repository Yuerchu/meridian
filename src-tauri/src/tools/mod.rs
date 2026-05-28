pub mod apply_patch;
pub mod ask_user;
pub mod edit_file;
pub mod glob_files;
pub mod list_directory;
pub mod read_file;
pub mod run_command;
pub mod search_files;
pub mod write_file;

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Permission {
    Always,
    Ask,
    Never,
}

#[derive(Debug, Clone)]
pub struct ToolContext {
    pub working_directory: Option<String>,
    pub shell: ShellType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellType {
    Cmd,
    PowerShell,
    Bash,
}

impl ShellType {
    pub fn from_str(s: &str) -> Self {
        match s {
            "powershell" => Self::PowerShell,
            "bash" => Self::Bash,
            _ => Self::default_for_platform(),
        }
    }

    pub fn default_for_platform() -> Self {
        if cfg!(target_os = "windows") {
            Self::Bash
        } else {
            Self::Bash
        }
    }
}

impl ToolContext {
    pub fn resolve_path(&self, path: &str) -> PathBuf {
        let p = Path::new(path);
        if p.is_absolute() {
            p.to_path_buf()
        } else if let Some(ref wd) = self.working_directory {
            PathBuf::from(wd).join(path)
        } else {
            p.to_path_buf()
        }
    }

    pub fn validate_path(&self, resolved: &Path) -> Result<(), String> {
        if let Some(ref wd) = self.working_directory {
            let wd_canonical = std::fs::canonicalize(wd).unwrap_or_else(|_| PathBuf::from(wd));
            let target = std::fs::canonicalize(resolved).unwrap_or_else(|_| resolved.to_path_buf());
            if !target.starts_with(&wd_canonical) {
                return Err(format!(
                    "Access denied: path '{}' is outside the project directory",
                    resolved.display()
                ));
            }
        }
        Ok(())
    }

    pub fn working_dir_or_current(&self) -> PathBuf {
        self.working_directory
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
    }
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    fn default_permission(&self) -> Permission;
    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String>;
}

pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        let tools: Vec<Box<dyn Tool>> = vec![
            Box::new(ask_user::AskUserTool),
            Box::new(read_file::ReadFileTool),
            Box::new(write_file::WriteFileTool),
            Box::new(run_command::RunCommandTool),
            Box::new(list_directory::ListDirectoryTool),
            Box::new(search_files::SearchFilesTool),
            Box::new(apply_patch::ApplyPatchTool),
            Box::new(edit_file::EditFileTool),
            Box::new(glob_files::GlobFilesTool),
        ];
        Self { tools }
    }

    pub fn definitions(&self) -> Vec<crate::provider::ToolDefinition> {
        self.tools
            .iter()
            .map(|t| crate::provider::ToolDefinition {
                name: t.name().to_string(),
                description: t.description().to_string(),
                parameters: t.parameters_schema(),
            })
            .collect()
    }

    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        self.tools.iter().find(|t| t.name() == name).map(|t| t.as_ref())
    }
}
