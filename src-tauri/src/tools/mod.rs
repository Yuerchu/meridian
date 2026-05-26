pub mod read_file;
pub mod run_command;
pub mod write_file;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Permission {
    Always,
    Ask,
    Never,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    fn default_permission(&self) -> Permission;
    async fn execute(&self, args: serde_json::Value) -> Result<String, String>;
}

pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        let tools: Vec<Box<dyn Tool>> = vec![
            Box::new(read_file::ReadFileTool),
            Box::new(write_file::WriteFileTool),
            Box::new(run_command::RunCommandTool),
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
