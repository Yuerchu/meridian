use async_trait::async_trait;

use super::{Permission, Tool, ToolContext};

/// Asks the user for permission to stop building and plan instead.
///
/// The counterpart to the toolbar switch: the user can always put a
/// conversation into plan mode themselves, and this lets the model raise its
/// hand when it can tell that the approach is not settled. Like `exit_plan` it
/// is a shell — the agent loop intercepts the call, because switching mode and
/// rebuilding the tool set needs the loop's state.
pub struct EnterPlanTool;

#[async_trait]
impl Tool for EnterPlanTool {
    fn name(&self) -> &str {
        "enter_plan"
    }

    fn description(&self) -> &str {
        "Ask the user to switch this conversation into plan mode, where you explore and design \
         instead of building. Use it when the request is open enough that guessing wrong would \
         waste real work — several defensible approaches, unclear requirements, or a change whose \
         shape depends on code you have not read yet. Do not use it for work whose approach is \
         already clear, however long that work is: a plan nobody needed is just a delay. If the \
         user approves, the editing tools go away for the rest of the planning."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "One sentence on what is unsettled and why planning first is \
                                    worth the user's time. Shown to them as-is."
                }
            },
            "required": ["reason"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Always
    }

    async fn execute(&self, _args: serde_json::Value, _context: &ToolContext) -> Result<String, String> {
        Err("enter_plan must be handled by the agent loop".to_string())
    }
}

/// Hands a finished plan to the user for approval and, if they accept, ends
/// plan mode.
///
/// Like `ask_user` this is a shell: it is registered so the manual and the
/// tool schema know it exists, but the agent loop intercepts the call. The work
/// — waiting on the user, recording the plan, switching the conversation's mode
/// and rebuilding the tool set so the same turn can start implementing — needs
/// the loop's state and cannot happen inside `execute`.
pub struct ExitPlanTool;

#[async_trait]
impl Tool for ExitPlanTool {
    fn name(&self) -> &str {
        "exit_plan"
    }

    fn description(&self) -> &str {
        "Present your finished plan to the user and ask to leave plan mode. Pass the whole plan as \
         markdown; the user reads it and either approves it — after which you start implementing \
         straight away — or sends it back with feedback, in which case you stay in plan mode and \
         revise. Call this only when the plan is complete: use `ask_user` for questions along the \
         way, not this tool."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "plan": {
                    "type": "string",
                    "description": "The complete plan, as markdown. Name the files to change and \
                                    what changes in each, point at existing code worth reusing, \
                                    and say how to verify it worked."
                }
            },
            "required": ["plan"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Always
    }

    async fn execute(&self, _args: serde_json::Value, _context: &ToolContext) -> Result<String, String> {
        Err("exit_plan must be handled by the agent loop".to_string())
    }
}
