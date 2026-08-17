//! Moving a conversation between collaboration modes, in the middle of a turn.
//!
//! A switch is not one write. The conversation row changes, the turn is
//! re-resolved against the new mode, and four things in the running loop have to
//! change together: which mode it thinks it is in, the tool definitions the next
//! request carries, the set that authorises a tool call, and the system prompt.
//! Land three of the four and the turn spends the rest of itself being told that
//! the tools it just gained do not exist.
//!
//! So nothing here changes the loop directly. Both paths hand back a
//! [`TransitionEffect`], and applying one is a single call that does all four or
//! none of them. The half-done switch — row written, rebuild refused — is a real
//! outcome with its own wording, not an error, and it deliberately leaves the
//! tool set exactly where it was.
//!
//! The port is one method wide because that is all that needs the outside: the
//! assistant row, its persona, the context blocks, the MCP snapshot and the tool
//! registry are assembled long before the loop starts. A runner with no modes
//! passes no [`Transitions`] at all, which is what keeps OneBot's current
//! behaviour — see the drift list.

use std::collections::HashSet;
use std::future::Future;

use crate::agent::modes::ModeSpec;
use crate::agent::turn_config::TurnConfig;
use crate::db;
use crate::db::DbPool;
use crate::provider::{ChatMessage, ToolDefinition};
use crate::util::{get_conn, now_ms};

use super::{ApprovalDecision, Emit};

/// Re-resolving the turn for another mode.
#[async_trait::async_trait]
pub(crate) trait Transitions: Send + Sync {
    /// The outer `Err` is the worker never coming back, and ends the turn — the
    /// same as it does today. A rebuild that merely fails is `Ok(Err(_))`: the
    /// model is told, and nothing in the loop moves. The two are not the same
    /// failure and folding them together would turn a panicked worker into a
    /// sentence the model reads and carries on from.
    async fn rebuild(&self, mode: &'static ModeSpec) -> Result<Result<TurnConfig, String>, String>;
}

/// A switch that went all the way through: conversation row written *and* turn
/// re-resolved.
///
/// The two travel as one value rather than as two `Option` fields so that a
/// mode without its config cannot be built in the first place. As two fields the
/// pairing was a comment, and `apply` had to be trusted to honour it; the shape
/// that carries a mode nobody can act on simply does not exist now.
struct TransitionNext {
    mode: &'static ModeSpec,
    config: TurnConfig,
}

/// What a transition did: what the model is told, and what the loop has to
/// change to match.
pub(crate) struct TransitionEffect {
    pub result: String,
    pub outcome: &'static str,
    next: Option<TransitionNext>,
}

impl TransitionEffect {
    /// A transition that did not happen, whether because the user said no or
    /// because a write did. All that is left is what to say.
    fn said(result: impl Into<String>, outcome: &'static str) -> Self {
        Self {
            result: result.into(),
            outcome,
            next: None,
        }
    }

    /// A switch that landed, with the turn it resolved to.
    fn switched(result: impl Into<String>, mode: &'static ModeSpec, config: TurnConfig) -> Self {
        Self {
            result: result.into(),
            outcome: "success",
            next: Some(TransitionNext { mode, config }),
        }
    }

    /// Put the switch into effect, if there was one, and hand back the tool
    /// result.
    pub(crate) fn apply(
        self,
        mode: &mut &'static ModeSpec,
        chat_messages: &mut [ChatMessage],
        tool_defs: &mut Vec<ToolDefinition>,
        offered: &mut HashSet<String>,
    ) -> (String, &'static str) {
        if let Some(next) = self.next {
            *mode = next.mode;
            apply_turn_config(chat_messages, tool_defs, offered, next.config);
        }
        (self.result, self.outcome)
    }

    /// Whether the loop would move. Only the tests ask; the loop calls `apply`.
    #[cfg(test)]
    fn moves(&self) -> bool {
        self.next.is_some()
    }
}

/// Put a re-resolved turn into effect: prompt, definitions and authorisation
/// together.
pub(crate) fn apply_turn_config(
    chat_messages: &mut [ChatMessage],
    tool_defs: &mut Vec<ToolDefinition>,
    offered: &mut HashSet<String>,
    config: TurnConfig,
) {
    replace_system_prompt(chat_messages, &config.system_prompt);
    *tool_defs = config.tool_defs;
    *offered = config.offered;
}

/// Swap the system prompt, and only that.
///
/// The first message, and only if it is a system message — never a search
/// through the transcript. By the time a switch happens the history holds
/// assistant turns, tool results and injected context, and the loop has a second
/// user of the same slot with the opposite intent: steering appends, and must
/// not touch the prefix the prompt cache is keyed on.
pub(crate) fn replace_system_prompt(chat_messages: &mut [ChatMessage], prompt: &str) {
    if let Some(first) = chat_messages.first_mut()
        && first.role == "system"
    {
        first.content = prompt.trim().to_string();
    }
}

/// The user was asked to move into a mode, and answered.
///
/// The mirror of [`exit`], minus the artifact: entering a mode produces nothing
/// to record, it only narrows what the rest of the turn may do. Which is why the
/// decision arrives already made — there is no work on the near side of the
/// question to get the order wrong.
pub(crate) async fn enter(
    pool: &DbPool,
    transitions: &dyn Transitions,
    emit: Option<&dyn Emit>,
    conversation_id: &str,
    target: &'static ModeSpec,
    decision: Option<ApprovalDecision>,
) -> Result<TransitionEffect, String> {
    match decision {
        Some(ApprovalDecision::Approved) => {}
        Some(ApprovalDecision::Denied(Some(reason))) => {
            return Ok(TransitionEffect::said(
                format!("The user would rather not plan first: {reason}\n\nCarry on as you were."),
                "denied",
            ));
        }
        _ => {
            return Ok(TransitionEffect::said(
                "The user declined to switch to plan mode. Carry on as you were.",
                "denied",
            ));
        }
    }

    let rebuilt = match store_mode(pool, conversation_id, Some(target.id)).await? {
        Err(e) => Err(e),
        Ok(()) => transitions.rebuild(target).await?,
    };
    Ok(match rebuilt {
        Ok(next) => {
            announce(emit, conversation_id);
            TransitionEffect::switched(
                "The user agreed. You are in plan mode from here: the tools that \
                 change anything are gone for the rest of this conversation until \
                 the plan is approved. Explore and design — do not describe edits \
                 as though you had made them.",
                target,
                next,
            )
        }
        Err(e) => TransitionEffect::said(
            format!(
                "The user agreed, but switching into plan mode failed: {e}. You \
                 are still in the previous mode — tell the user rather than \
                 pretending to plan."
            ),
            "error",
        ),
    })
}

/// The model asked to leave a mode, handing over the artifact it produced.
///
/// Takes the question rather than its answer because there is work on both sides
/// of it. The plan is recorded first, so one the user rejects is still on file
/// and the approved one can be re-injected into later turns without depending on
/// the transcript surviving. Sequencing that ahead of the question rather than
/// matching on the two together is deliberate: a tuple match evaluates both, so
/// a failed write would still put the card in front of the user and then throw
/// their answer away.
pub(crate) async fn exit<A>(
    pool: &DbPool,
    transitions: &dyn Transitions,
    emit: Option<&dyn Emit>,
    conversation_id: &str,
    from: &'static ModeSpec,
    arguments: &str,
    ask: A,
) -> Result<TransitionEffect, String>
where
    A: Future<Output = Result<Option<ApprovalDecision>, String>>,
{
    let plan_text = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get("plan").and_then(|p| p.as_str()).map(str::to_string))
        .unwrap_or_default();
    if plan_text.trim().is_empty() {
        // Nothing recorded and nothing asked: the user is not shown a card for a
        // plan that does not exist.
        return Ok(TransitionEffect::said(
            "exit_plan needs a `plan`: pass the whole plan as markdown.",
            "error",
        ));
    }

    let recorded = {
        let pool = pool.clone();
        let conv_id = conversation_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            db::ops::plan::record_plan(&mut conn, &conv_id, &plan_text, now_ms()).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let row = match recorded {
        Ok(row) => row,
        Err(e) => {
            return Ok(TransitionEffect::said(
                format!("Could not record the plan: {e}"),
                "error",
            ));
        }
    };

    let decision = ask.await?;
    if !matches!(decision, Some(ApprovalDecision::Approved)) {
        mark_rejected(pool, &row.id).await?;
        return Ok(match decision {
            Some(ApprovalDecision::Denied(Some(reason))) => TransitionEffect::said(
                format!(
                    "The user sent the plan back: {reason}\n\nYou are still in \
                     plan mode. Revise the plan and call exit_plan again."
                ),
                "denied",
            ),
            _ => TransitionEffect::said(
                "The user did not approve the plan. You are still in plan mode.",
                "denied",
            ),
        });
    }

    // One worker, but not one transaction — approving and leaving the mode can
    // still land half. Inherited as it was; it is on the list of things this
    // refactor deliberately does not fix.
    let switched = {
        let pool = pool.clone();
        let conv_id = conversation_id.to_string();
        let plan_id = row.id.clone();
        let next_mode = from.exit_to;
        tokio::task::spawn_blocking(move || {
            let mut conn = get_conn(&pool)?;
            let now = now_ms();
            db::ops::plan::approve(&mut conn, &plan_id, now).map_err(|e| e.to_string())?;
            db::ops::conversation::update_mode(&mut conn, &conv_id, next_mode, now).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    };
    // Re-resolve the turn so the same reply can start implementing. Both this
    // and the write above have to succeed before the model is told the tools are
    // back — otherwise it acts on a promise the tool set does not keep and burns
    // the turn on "unknown tool" retries.
    let target = crate::agent::modes::resolve(from.exit_to);
    let rebuilt = match switched {
        Err(e) => Err(e),
        Ok(()) => transitions.rebuild(target).await?,
    };
    Ok(match rebuilt {
        Ok(next) => {
            announce(emit, conversation_id);
            TransitionEffect::switched(
                "The user approved the plan. You are out of plan mode and the \
                 editing tools are available again — start implementing now, in \
                 this reply. The approved plan is in your system prompt.",
                target,
                next,
            )
        }
        Err(e) => TransitionEffect::said(
            format!(
                "The user approved the plan, but switching out of plan mode \
                 failed: {e}. You are still in plan mode and the editing tools \
                 are still unavailable. Tell the user, and do not try to \
                 implement anything this turn."
            ),
            "error",
        ),
    })
}

async fn store_mode(
    pool: &DbPool,
    conversation_id: &str,
    mode: Option<&'static str>,
) -> Result<Result<(), String>, String> {
    let pool = pool.clone();
    let conv_id = conversation_id.to_string();
    tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        db::ops::conversation::update_mode(&mut conn, &conv_id, mode, now_ms()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

/// Refusing a plan is bookkeeping. The user has already been answered by the
/// time it runs, so a database that will not take it changes nothing they can
/// see and is not worth ending the turn over.
async fn mark_rejected(pool: &DbPool, plan_id: &str) -> Result<(), String> {
    let pool = pool.clone();
    let plan_id = plan_id.to_string();
    let _ = tokio::task::spawn_blocking(move || {
        let mut conn = get_conn(&pool)?;
        db::ops::plan::reject(&mut conn, &plan_id, now_ms()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// The toolbar reads the mode off the conversation row, which just changed.
///
/// Ignored if it fails, on both paths and as it always was: the row is already
/// written and this only asks a window to re-read it. It is the one send in the
/// turn that is not part of the answer.
fn announce(emit: Option<&dyn Emit>, conversation_id: &str) {
    if let Some(e) = emit {
        let _ = e.emit("conversation-updated", serde_json::json!({ "id": conversation_id }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::modes::{PLAN_MODE, WORK_MODE};
    use crate::db::test_db;
    use crate::provider::ChatMessage;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    fn plan_mode() -> &'static ModeSpec {
        crate::agent::modes::resolve(Some(PLAN_MODE))
    }

    fn work_mode() -> &'static ModeSpec {
        crate::agent::modes::resolve(Some(WORK_MODE))
    }

    fn conversation(pool: &DbPool) {
        let mut conn = pool.get().unwrap();
        db::ops::conversation::create_conversation(&mut conn, "c1", Some("t"), None, None, 1).unwrap();
    }

    fn stored_mode(pool: &DbPool) -> Option<String> {
        let mut conn = pool.get().unwrap();
        db::ops::conversation::get_conversation(&mut conn, "c1").unwrap().mode
    }

    fn plans(pool: &DbPool) -> Vec<crate::db::models::plan::Plan> {
        let mut conn = pool.get().unwrap();
        db::ops::plan::list_plans(&mut conn, "c1").unwrap()
    }

    fn def(name: &str) -> ToolDefinition {
        ToolDefinition {
            name: name.to_string(),
            description: String::new(),
            parameters: serde_json::json!({}),
        }
    }

    fn config(prompt: &str, tools: &[&str]) -> TurnConfig {
        TurnConfig {
            tool_defs: tools.iter().map(|t| def(t)).collect(),
            system_prompt: prompt.to_string(),
            offered: tools.iter().map(|t| t.to_string()).collect(),
        }
    }

    /// Hands back a fixed config, or refuses. Records which mode it was asked
    /// for, which is how the switch's destination is checked without a real
    /// resolver.
    struct FakeRebuild {
        answer: Result<Result<TurnConfig, String>, String>,
        asked: Mutex<Vec<&'static str>>,
    }

    impl FakeRebuild {
        fn giving(prompt: &str, tools: &[&str]) -> Self {
            Self {
                answer: Ok(Ok(config(prompt, tools))),
                asked: Mutex::new(Vec::new()),
            }
        }
        fn refusing() -> Self {
            Self {
                answer: Ok(Err("no connection".into())),
                asked: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait::async_trait]
    impl Transitions for FakeRebuild {
        async fn rebuild(&self, mode: &'static ModeSpec) -> Result<Result<TurnConfig, String>, String> {
            self.asked.lock().unwrap().push(mode.id);
            match &self.answer {
                Ok(Ok(c)) => Ok(Ok(TurnConfig {
                    tool_defs: c.tool_defs.clone(),
                    system_prompt: c.system_prompt.clone(),
                    offered: c.offered.clone(),
                })),
                Ok(Err(e)) => Ok(Err(e.clone())),
                Err(e) => Err(e.clone()),
            }
        }
    }

    /// Records every send so a path that emits nothing can be told from one that
    /// emits. Never fails: the desktop ignores this particular send too.
    #[derive(Default)]
    struct Recorder(Mutex<Vec<String>>);

    impl Emit for Recorder {
        fn emit(&self, channel: &str, _payload: serde_json::Value) -> Result<(), String> {
            self.0.lock().unwrap().push(channel.to_string());
            Ok(())
        }
    }

    struct Loop {
        mode: &'static ModeSpec,
        messages: Vec<ChatMessage>,
        tool_defs: Vec<ToolDefinition>,
        offered: HashSet<String>,
    }

    impl Loop {
        fn in_work() -> Self {
            let mut first = ChatMessage::user("you are helpful");
            first.role = "system".into();
            Self {
                mode: work_mode(),
                messages: vec![first, ChatMessage::user("do the thing")],
                tool_defs: vec![def("write_file")],
                offered: ["write_file".to_string()].into_iter().collect(),
            }
        }
        fn apply(&mut self, effect: TransitionEffect) -> (String, &'static str) {
            effect.apply(
                &mut self.mode,
                &mut self.messages,
                &mut self.tool_defs,
                &mut self.offered,
            )
        }
        fn names(&self) -> Vec<&str> {
            self.tool_defs.iter().map(|d| d.name.as_str()).collect()
        }
    }

    /// The whole reason the effect is one value: all four move, or none do.
    #[tokio::test]
    async fn entering_moves_the_mode_the_tools_the_authorisation_and_the_prompt() {
        let pool = test_db();
        conversation(&pool);
        let rebuild = FakeRebuild::giving("# Plan mode\n\nyou are planning", &["read_file"]);
        let emit = Recorder::default();
        let mut state = Loop::in_work();

        let effect = enter(
            &pool,
            &rebuild,
            Some(&emit),
            "c1",
            plan_mode(),
            Some(ApprovalDecision::Approved),
        )
        .await
        .unwrap();
        let (_, outcome) = state.apply(effect);

        assert_eq!(outcome, "success");
        assert_eq!(state.mode.id, PLAN_MODE);
        assert_eq!(state.names(), ["read_file"]);
        assert!(state.offered.contains("read_file") && !state.offered.contains("write_file"));
        assert_eq!(state.messages[0].content, "# Plan mode\n\nyou are planning");
        assert_eq!(
            state.messages[1].content, "do the thing",
            "and nothing else in the history"
        );
        assert_eq!(stored_mode(&pool).as_deref(), Some(PLAN_MODE));
        assert_eq!(*rebuild.asked.lock().unwrap(), [PLAN_MODE]);
        assert_eq!(*emit.0.lock().unwrap(), ["conversation-updated"]);
    }

    /// The next request is built from `tool_defs` and checked against `offered`,
    /// so "immediately" is exactly this: no second round trip, no re-resolve at
    /// the top of the next iteration.
    #[tokio::test]
    async fn the_next_request_carries_the_new_tools_without_asking_again() {
        let pool = test_db();
        conversation(&pool);
        let rebuild = FakeRebuild::giving("planning", &["read_file", "run_command"]);
        let mut state = Loop::in_work();

        let effect = enter(
            &pool,
            &rebuild,
            None,
            "c1",
            plan_mode(),
            Some(ApprovalDecision::Approved),
        )
        .await
        .unwrap();
        state.apply(effect);

        // What the loop would send and what it would authorise, one iteration
        // later, with nothing in between.
        assert_eq!(state.names(), ["read_file", "run_command"]);
        assert!(
            !state.offered.contains("write_file"),
            "the withheld tool is refused too"
        );
        assert_eq!(rebuild.asked.lock().unwrap().len(), 1);
    }

    /// The row is written and the rebuild is not. The model is told; the tool set
    /// must not pretend otherwise, or the turn burns itself on calls to tools it
    /// does not have.
    #[tokio::test]
    async fn a_switch_that_only_half_happened_does_not_move_the_tool_set() {
        let pool = test_db();
        conversation(&pool);
        let rebuild = FakeRebuild::refusing();
        let emit = Recorder::default();
        let mut state = Loop::in_work();

        let effect = enter(
            &pool,
            &rebuild,
            Some(&emit),
            "c1",
            plan_mode(),
            Some(ApprovalDecision::Approved),
        )
        .await
        .unwrap();
        let (result, outcome) = state.apply(effect);

        assert_eq!(outcome, "error");
        assert!(
            result.contains("no connection"),
            "the model is told what went wrong: {result}"
        );
        assert_eq!(state.mode.id, WORK_MODE, "still where it was");
        assert_eq!(state.names(), ["write_file"]);
        assert!(state.offered.contains("write_file"));
        assert_eq!(state.messages[0].content, "you are helpful");
        assert!(emit.0.lock().unwrap().is_empty(), "nothing to tell the window about");
        // The row did move, which is the whole reason this case exists.
        assert_eq!(stored_mode(&pool).as_deref(), Some(PLAN_MODE));
    }

    #[tokio::test]
    async fn a_refused_entry_carries_the_reason_back_and_changes_nothing() {
        let pool = test_db();
        conversation(&pool);
        let rebuild = FakeRebuild::giving("planning", &["read_file"]);
        let mut state = Loop::in_work();

        let effect = enter(
            &pool,
            &rebuild,
            None,
            "c1",
            plan_mode(),
            Some(ApprovalDecision::Denied(Some("just do it".into()))),
        )
        .await
        .unwrap();
        let (result, outcome) = state.apply(effect);

        assert_eq!(outcome, "denied");
        assert!(result.contains("just do it"));
        assert_eq!(state.mode.id, WORK_MODE);
        assert_eq!(stored_mode(&pool), None, "the row is not touched before the answer");
        assert!(rebuild.asked.lock().unwrap().is_empty());
    }

    /// A card that goes away unanswered reads the same as a refusal, and must
    /// not be read as one that said yes.
    #[tokio::test]
    async fn an_unanswered_entry_is_a_refusal() {
        let pool = test_db();
        conversation(&pool);
        let rebuild = FakeRebuild::giving("planning", &["read_file"]);

        let effect = enter(&pool, &rebuild, None, "c1", plan_mode(), None).await.unwrap();

        assert_eq!(effect.outcome, "denied");
        assert!(!effect.moves());
        assert_eq!(stored_mode(&pool), None);
    }

    fn answer(d: Option<ApprovalDecision>) -> impl Future<Output = Result<Option<ApprovalDecision>, String>> {
        std::future::ready(Ok(d))
    }

    #[tokio::test]
    async fn an_approved_plan_is_recorded_the_mode_ends_and_the_tools_come_back() {
        let pool = test_db();
        conversation(&pool);
        {
            let mut conn = pool.get().unwrap();
            db::ops::conversation::update_mode(&mut conn, "c1", Some(PLAN_MODE), 1).unwrap();
        }
        let rebuild = FakeRebuild::giving("you are helpful", &["write_file", "read_file"]);
        let emit = Recorder::default();
        let mut state = Loop::in_work();
        state.mode = plan_mode();
        state.tool_defs = vec![def("read_file")];
        state.offered = ["read_file".to_string()].into_iter().collect();

        let effect = exit(
            &pool,
            &rebuild,
            Some(&emit),
            "c1",
            plan_mode(),
            r##"{"plan":"# Plan\n\nStep one."}"##,
            answer(Some(ApprovalDecision::Approved)),
        )
        .await
        .unwrap();
        let (_, outcome) = state.apply(effect);

        assert_eq!(outcome, "success");
        assert_eq!(state.mode.id, WORK_MODE);
        assert_eq!(state.names(), ["write_file", "read_file"]);
        // Written out rather than cleared: `exit_to` names a mode, and the row
        // resolves the same either way.
        assert_eq!(stored_mode(&pool).as_deref(), Some(WORK_MODE));
        assert_eq!(*rebuild.asked.lock().unwrap(), [WORK_MODE]);
        assert_eq!(*emit.0.lock().unwrap(), ["conversation-updated"]);

        let plans = plans(&pool);
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].status, "approved");
        assert_eq!(plans[0].content, "# Plan\n\nStep one.");
    }

    /// Approving writes the artifact and the row together, so a rebuild that
    /// then refuses leaves an approved plan in a conversation whose tools have
    /// not moved. Telling the model it is still planning is the honest read of
    /// that, and it is what stops it from trying to implement.
    #[tokio::test]
    async fn an_approved_plan_that_cannot_be_rebuilt_leaves_the_tools_alone() {
        let pool = test_db();
        conversation(&pool);
        let rebuild = FakeRebuild::refusing();
        let mut state = Loop::in_work();
        state.mode = plan_mode();
        state.tool_defs = vec![def("read_file")];
        state.offered = ["read_file".to_string()].into_iter().collect();

        let effect = exit(
            &pool,
            &rebuild,
            None,
            "c1",
            plan_mode(),
            r#"{"plan":"the plan"}"#,
            answer(Some(ApprovalDecision::Approved)),
        )
        .await
        .unwrap();
        let (result, outcome) = state.apply(effect);

        assert_eq!(outcome, "error");
        assert!(result.contains("still in plan mode"), "{result}");
        assert_eq!(state.mode.id, PLAN_MODE);
        assert_eq!(state.names(), ["read_file"]);
        assert_eq!(plans(&pool)[0].status, "approved", "the artifact write did land");
    }

    #[tokio::test]
    async fn a_plan_sent_back_is_kept_on_file_and_the_mode_holds() {
        let pool = test_db();
        conversation(&pool);
        let rebuild = FakeRebuild::giving("work", &["write_file"]);
        let emit = Recorder::default();
        let mut state = Loop::in_work();
        state.mode = plan_mode();

        let effect = exit(
            &pool,
            &rebuild,
            Some(&emit),
            "c1",
            plan_mode(),
            r#"{"plan":"half a plan"}"#,
            answer(Some(ApprovalDecision::Denied(Some("say more about the tests".into())))),
        )
        .await
        .unwrap();
        let (result, outcome) = state.apply(effect);

        assert_eq!(outcome, "denied");
        assert!(result.contains("say more about the tests"));
        assert_eq!(state.mode.id, PLAN_MODE);
        assert!(rebuild.asked.lock().unwrap().is_empty());
        assert!(emit.0.lock().unwrap().is_empty());

        let plans = plans(&pool);
        assert_eq!(plans[0].status, "rejected");
        assert_eq!(plans[0].content, "half a plan", "still on file, so it can be revised");
    }

    /// Recorded first, on purpose: matching on the write and the answer together
    /// would evaluate both, putting a card in front of the user for a plan that
    /// was never stored and then throwing their answer away.
    #[tokio::test]
    async fn the_plan_is_on_file_before_the_user_is_asked() {
        let pool = test_db();
        conversation(&pool);
        let rebuild = FakeRebuild::giving("work", &["write_file"]);
        let stored_when_asked = Arc::new(AtomicBool::new(false));

        let seen = stored_when_asked.clone();
        let pool2 = pool.clone();
        let ask = async move {
            seen.store(!plans(&pool2).is_empty(), Ordering::SeqCst);
            Ok(Some(ApprovalDecision::Approved))
        };

        exit(&pool, &rebuild, None, "c1", plan_mode(), r#"{"plan":"p"}"#, ask)
            .await
            .unwrap();

        assert!(stored_when_asked.load(Ordering::SeqCst));
    }

    /// No plan means no card. Asking would show the user an empty proposal and
    /// spend their attention on the model's mistake.
    #[tokio::test]
    async fn an_empty_plan_is_answered_without_asking_anyone() {
        let pool = test_db();
        conversation(&pool);
        let rebuild = FakeRebuild::giving("work", &["write_file"]);
        let asked = Arc::new(AtomicBool::new(false));

        for arguments in [r#"{"plan":"   "}"#, "{}", "not json"] {
            let seen = asked.clone();
            let ask = async move {
                seen.store(true, Ordering::SeqCst);
                Ok(Some(ApprovalDecision::Approved))
            };
            let effect = exit(&pool, &rebuild, None, "c1", plan_mode(), arguments, ask)
                .await
                .unwrap();

            assert_eq!(effect.outcome, "error", "for {arguments}");
            assert!(!effect.moves());
        }

        assert!(!asked.load(Ordering::SeqCst));
        assert!(plans(&pool).is_empty(), "and nothing on file either");
    }

    fn system(content: &str) -> ChatMessage {
        let mut m = ChatMessage::user(content);
        m.role = "system".into();
        m
    }

    /// A second system message is not hypothetical: a compaction summary and an
    /// injected block can both land with that role. Only the first one is the
    /// prompt, and rewriting the others would overwrite them with it.
    #[test]
    fn the_prompt_is_swapped_in_the_first_slot_and_only_there() {
        let mut messages = vec![
            system("old"),
            ChatMessage::user("hello"),
            system("a summary of what came before"),
        ];

        replace_system_prompt(&mut messages, "  new  ");

        assert_eq!(messages[0].content, "new", "trimmed, as the resolver's output is");
        assert_eq!(messages[1].content, "hello");
        assert_eq!(
            messages[2].content, "a summary of what came before",
            "a later system message is not the prompt",
        );
    }

    /// A transcript whose first message is not a system message belongs to a
    /// runner that builds its prompt some other way. Inserting one would move
    /// every other message and invalidate the cached prefix.
    #[test]
    fn a_transcript_with_no_system_message_is_left_alone() {
        let mut messages = vec![ChatMessage::user("hello")];
        replace_system_prompt(&mut messages, "new");
        assert_eq!(messages[0].content, "hello");

        let mut empty: Vec<ChatMessage> = Vec::new();
        replace_system_prompt(&mut empty, "new");
        assert!(empty.is_empty());
    }
}
