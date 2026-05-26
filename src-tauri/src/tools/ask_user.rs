use async_trait::async_trait;
use super::{Permission, Tool};

pub struct AskUserTool;

#[async_trait]
impl Tool for AskUserTool {
    fn name(&self) -> &str {
        "ask_user"
    }

    fn description(&self) -> &str {
        "Ask the user one or more questions and wait for their responses. Each question must provide 2-4 mutually exclusive options. The client automatically adds a free-form \"Other\" option, so do not include one. Put the recommended option first and suffix its label with \"(Recommended)\"."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "description": "Stable snake_case identifier for mapping answers"
                            },
                            "question": {
                                "type": "string",
                                "description": "Single-sentence prompt shown to the user"
                            },
                            "options": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {
                                            "type": "string",
                                            "description": "User-facing label (1-5 words)"
                                        },
                                        "description": {
                                            "type": "string",
                                            "description": "One short sentence explaining impact or tradeoff"
                                        }
                                    },
                                    "required": ["label"]
                                },
                                "description": "2-4 mutually exclusive choices. Do not include an \"Other\" option; the client adds one automatically."
                            },
                            "multi_select": {
                                "type": "boolean",
                                "description": "If true, user can select multiple options. Default false."
                            }
                        },
                        "required": ["id", "question", "options"]
                    },
                    "description": "1-4 questions to show the user. Prefer fewer questions."
                }
            },
            "required": ["questions"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Always
    }

    async fn execute(&self, _args: serde_json::Value) -> Result<String, String> {
        Err("ask_user must be handled by the agent loop".to_string())
    }
}
