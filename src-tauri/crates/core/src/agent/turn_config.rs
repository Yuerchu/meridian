//! What the assistant may do this turn, and what it is told.
//!
//! Three loops need this — the desktop chat, the OneBot chat, and the token
//! estimator — and for a long time each built it separately. They drifted:
//! `tool_preset_id` was only ever honoured on the desktop path, so a OneBot
//! assistant configured with a preset silently got the wrong tools, and the
//! estimator left the checklist block out of its count. Resolving it once, here,
//! is what stops modes from becoming a fourth thing to keep in sync.

use std::collections::HashSet;

use diesel::sqlite::SqliteConnection;

use crate::db::models::assistant::Assistant;
use crate::provider::ToolDefinition;
use crate::tools::ToolRegistry;

use super::modes::Modes;

pub struct TurnConfigInput {
    pub assistant: Option<Assistant>,
    pub conversation_id: String,
    pub project_id: Option<String>,
    /// Where the conversation is, and whether this runner can move it. The
    /// second half is not a preference — it is whether there is anywhere to put
    /// the question a transition asks.
    pub mode: Modes,
    /// Fetched by the caller: the MCP manager sits behind an async lock.
    pub mcp_defs: Vec<ToolDefinition>,
    /// False for OneBot's non-admin sessions, which get no tools at all.
    pub include_tools: bool,
    /// Whether this runner can delegate, and to which models.
    ///
    /// `None` is not "no models" — it is "there is no `SubAgents` port here", so
    /// `run_agent` is taken out of the tool set entirely. It has to be decided
    /// at this level rather than at the call site or at dispatch, because
    /// `PlanTransitions` re-resolves mid-turn and would undo anything a call
    /// site had filtered.
    pub sub_agents: Option<crate::agent::sub_agents::SubAgentCatalog>,
    /// The assistant's own prompt, template variables already resolved.
    pub persona: String,
    /// Slotted in after the persona: project instructions, file access notes.
    /// Each carries its own leading blank line.
    pub context_blocks: Vec<String>,
}

pub struct TurnConfig {
    pub tool_defs: Vec<ToolDefinition>,
    pub system_prompt: String,
    /// The only thing that authorises a tool call. The dispatch loop checks
    /// against this rather than against the assistant's configuration, because
    /// a tool the mode removed is still in the registry and a model that names
    /// it would otherwise be obeyed.
    pub offered: HashSet<String>,
}

pub fn resolve(conn: &mut SqliteConnection, registry: &ToolRegistry, input: TurnConfigInput) -> TurnConfig {
    let TurnConfigInput {
        assistant,
        conversation_id,
        project_id,
        mode,
        mcp_defs,
        include_tools,
        sub_agents,
        persona,
        context_blocks,
    } = input;

    let tool_defs = if include_tools {
        let enabled = enabled_tools(conn, assistant.as_ref());
        let mut defs = super::tool_defs::collect(registry, mcp_defs, enabled.as_deref());
        // Sticker availability is data, not an assistant preset. Keep the two
        // fixed-schema tools present whenever this assistant has a confirmed
        // roster, even if an older preset predates the feature.
        if let Some(assistant_id) = assistant.as_ref().map(|value| value.id.as_str()) {
            let has_stickers = crate::db::ops::emoji_pack::list_assigned_pack_ids(conn, assistant_id)
                .and_then(|packs| crate::db::ops::emoji::list_confirmed_for_packs(conn, &packs))
                .is_ok_and(|stickers| !stickers.is_empty());
            if has_stickers {
                for name in ["list_stickers", "send_sticker"] {
                    if defs.iter().any(|definition| definition.name == name) {
                        continue;
                    }
                    if let Some(tool) = registry.get(name) {
                        defs.push(crate::provider::ToolDefinition {
                            name: tool.name().to_string(),
                            description: tool.description().to_string(),
                            parameters: tool.parameters_schema(),
                        });
                    }
                }
            }
        }
        super::tool_defs::apply_mode(&mut defs, mode, registry);
        let available = crate::db::ops::skill_binding::resolve_available(
            conn,
            project_id.as_deref(),
            assistant.as_ref().map(|a| a.id.as_str()),
        )
        .unwrap_or_else(|e| {
            // An empty list makes `apply_skill_catalog` remove `load_skill`
            // entirely, so a failed query and "no skills bound" look the same:
            // the model is never told skills exist.
            tracing::warn!(
                assistant_id = assistant.as_ref().map(|a| a.id.as_str()).unwrap_or(""),
                error = %e,
                "skill bindings could not be read; no skills will be offered this turn"
            );
            Vec::new()
        });
        super::tool_defs::apply_skill_catalog(&mut defs, &available);
        super::tool_defs::apply_sub_agent_catalog(&mut defs, sub_agents.as_ref());
        defs
    } else {
        Vec::new()
    };

    let mut prompt = String::new();
    // The mode goes first: it is the strongest constraint in force, and in plan
    // mode the file-editing baseline below is absent anyway because those tools
    // were removed.
    if let Some(instructions) = mode.spec().instructions {
        prompt.push_str(instructions);
        prompt.push_str("\n\n");
    }
    if let Some(base) = super::base_prompt(&tool_defs) {
        prompt.push_str(&base);
        prompt.push_str("\n\n");
    }
    prompt.push_str(&persona);
    for block in &context_blocks {
        prompt.push_str(block);
    }
    // State blocks last, and re-derived from the database rather than read back
    // out of the transcript, which is what carries them across compaction.
    // Anything appended after them would be evicted from the provider's prompt
    // cache every time they change.
    //
    // The same reasoning orders these two against each other: an approved plan
    // does not change for the whole of an implementation, while the checklist
    // changes several times per turn. Plan first keeps it inside the cached
    // prefix instead of behind every checkbox tick.
    //
    // Both are per-conversation and deliberately do not follow branch switches:
    // paging back to an earlier answer still shows the plan and checklist as
    // they stand now. They describe the work in progress rather than the
    // transcript, and the rest of that work — files edited, commands run,
    // memories written — cannot be rewound by switching branches either. Making
    // these two alone branch-aware would imply the whole world rewinds, which
    // is a harder model to explain than "branches switch the transcript only".
    // A read failure drops the block from the prompt, and the model then ignores
    // a plan it agreed to or forgets the checklist — read as "it went off the
    // rails again" rather than as an error. `Ok(None)` is the ordinary case and
    // stays quiet.
    match crate::db::ops::plan::get_active(conn, &conversation_id) {
        Ok(Some(plan)) => {
            if let Some(block) = crate::db::ops::plan::format_plan_block(&plan) {
                prompt.push_str(&block);
            }
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(
            conversation_id = %conversation_id, block = "plan", error = %e,
            "could not read the active plan; it will be missing from this turn"
        ),
    }
    match crate::db::ops::todo::get_active_view(conn, &conversation_id) {
        Ok(Some(view)) => {
            if let Some(block) = crate::db::ops::todo::format_todo_block(&view) {
                prompt.push_str(&block);
            }
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(
            conversation_id = %conversation_id, block = "todo", error = %e,
            "could not read the todo list; it will be missing from this turn"
        ),
    }

    let offered = tool_defs.iter().map(|d| d.name.clone()).collect();
    TurnConfig {
        tool_defs,
        system_prompt: prompt,
        offered,
    }
}

/// Tool filtering as configured on the assistant: preset wins over an explicit
/// list, and neither means every tool is allowed.
///
/// An assistant that names a preset gets an empty set if that preset cannot be
/// read, not the full toolset. Since this list now also decides what may
/// *execute*, failing open would turn a deleted preset or a corrupt
/// `tool_names` into a silent grant of `write_file` and `run_command` to an
/// assistant the user had deliberately restricted.
fn enabled_tools(conn: &mut SqliteConnection, assistant: Option<&Assistant>) -> Option<Vec<String>> {
    let assistant = assistant?;
    if let Some(preset_id) = assistant.tool_preset_id.as_ref() {
        let preset = crate::db::ops::tool_preset::get_preset(conn, preset_id).ok();
        let names = preset
            .as_ref()
            .and_then(|p| serde_json::from_str::<Vec<String>>(&p.tool_names).ok());
        if names.is_none() {
            // Failing closed is deliberate, but from the outside "the preset row
            // is unreadable" and "this model cannot use tools" look identical:
            // the assistant simply stops using tools. Only this line separates
            // them.
            tracing::warn!(
                assistant_id = %assistant.id,
                tool_preset_id = %preset_id,
                reason = if preset.is_none() { "preset_missing" } else { "tool_names_unparseable" },
                "tool preset could not be read; the assistant gets no tools this turn"
            );
        }
        return Some(names.unwrap_or_default());
    }
    assistant
        .enabled_tools
        .as_ref()
        .and_then(|json| serde_json::from_str(json).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::tool_preset::NewToolPreset;
    use crate::db::{DbPool, test_db};
    use diesel::prelude::*;

    fn registry() -> ToolRegistry {
        ToolRegistry::new(
            std::path::PathBuf::from("/nonexistent"),
            std::path::PathBuf::from("/nonexistent"),
        )
    }

    fn seed_conversation(conn: &mut SqliteConnection, id: &str) {
        use crate::db::schema::conversations;
        diesel::insert_into(conversations::table)
            .values((
                conversations::id.eq(id),
                conversations::created_at.eq(1),
                conversations::updated_at.eq(1),
            ))
            .execute(conn)
            .unwrap();
    }

    fn assistant_with(preset: Option<&str>, enabled: Option<&str>) -> Assistant {
        Assistant {
            id: "a1".into(),
            name: "A".into(),
            description: None,
            avatar: None,
            system_prompt: String::new(),
            provider_id: None,
            model_id: None,
            temperature: None,
            top_p: None,
            max_tokens: None,
            is_default: 0,
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
            context_limit: 128000,
            compact_keep_recent: 10,
            enabled_tools: enabled.map(str::to_string),
            thinking_enabled: 0,
            thinking_budget: None,
            tool_preset_id: preset.map(str::to_string),
            auto_compact_enabled: 0,
        }
    }

    fn seed_preset(conn: &mut SqliteConnection, id: &str, tools: &str) {
        crate::db::ops::tool_preset::create_preset(
            conn,
            &NewToolPreset {
                id,
                name: id,
                description: None,
                icon: None,
                tool_names: tools,
                is_builtin: 0,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
            },
        )
        .unwrap();
    }

    /// A desktop-shaped runner: it has a transitions port, so it is offered the
    /// way between modes.
    fn switchable(id: Option<&str>) -> Modes {
        Modes::Switchable(super::super::modes::resolve(id))
    }

    fn input(mode: Modes, assistant: Option<Assistant>) -> TurnConfigInput {
        TurnConfigInput {
            assistant,
            conversation_id: "c1".into(),
            project_id: None,
            mode,
            sub_agents: None,
            mcp_defs: Vec::new(),
            include_tools: true,
            persona: "You are a test.".into(),
            context_blocks: Vec::new(),
        }
    }

    fn setup() -> (DbPool, ToolRegistry) {
        let pool = test_db();
        {
            let mut conn = pool.get().unwrap();
            seed_conversation(&mut conn, "c1");
        }
        (pool, registry())
    }

    #[test]
    fn no_assistant_means_every_tool() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let cfg = resolve(&mut conn, &reg, input(switchable(None), None));

        assert!(cfg.offered.contains("read_file"));
        assert!(cfg.offered.contains("write_file"));
        assert!(!cfg.offered.contains("exit_plan"), "not in the work mode");
    }

    /// The bug this refactor exists to kill: the OneBot loop only ever read
    /// `enabled_tools`, so an assistant configured with a preset got a
    /// different tool set there than on the desktop. One resolver, one answer.
    #[test]
    fn a_preset_beats_the_explicit_list_for_every_caller() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        seed_preset(&mut conn, "p1", r#"["read_file","glob"]"#);

        let assistant = assistant_with(Some("p1"), Some(r#"["write_file","run_command"]"#));
        let cfg = resolve(&mut conn, &reg, input(switchable(None), Some(assistant)));

        assert!(cfg.offered.contains("read_file"));
        assert!(cfg.offered.contains("glob"));
        assert!(
            !cfg.offered.contains("write_file"),
            "the preset wins over enabled_tools"
        );
        assert!(!cfg.offered.contains("run_command"));
    }

    /// `offered` is what authorises execution, so a preset that cannot be read
    /// must not degrade into "everything allowed". Mode transitions are the one
    /// exception and are checked separately below.
    #[test]
    fn an_unreadable_preset_grants_no_working_tools() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        // Names a preset that was deleted, leaving a dangling reference.
        let assistant = assistant_with(Some("gone"), None);
        let cfg = resolve(&mut conn, &reg, input(switchable(None), Some(assistant)));

        assert!(!cfg.offered.contains("write_file"), "fails closed, not open");
        assert!(!cfg.offered.contains("read_file"));
        assert!(!cfg.offered.contains("run_command"));
    }

    #[test]
    fn a_corrupt_preset_payload_also_grants_no_working_tools() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        seed_preset(&mut conn, "broken", "not json at all");
        let assistant = assistant_with(Some("broken"), None);
        let cfg = resolve(&mut conn, &reg, input(switchable(None), Some(assistant)));

        assert!(!cfg.offered.contains("write_file"));
        assert!(!cfg.offered.contains("read_file"));
    }

    /// Transitions are not working tools and must survive whatever the
    /// assistant's configuration does. A broken preset that also swallowed
    /// `exit_plan` would strand the conversation in plan mode with no way out.
    #[test]
    fn a_broken_configuration_can_still_leave_plan_mode() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let assistant = assistant_with(Some("gone"), None);
        let cfg = resolve(&mut conn, &reg, input(switchable(Some("plan")), Some(assistant)));

        assert!(cfg.offered.contains("exit_plan"), "must never be stranded");
        assert!(!cfg.offered.contains("read_file"), "but gains nothing else");
    }

    #[test]
    fn the_explicit_list_applies_when_there_is_no_preset() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let assistant = assistant_with(None, Some(r#"["read_file"]"#));
        let cfg = resolve(&mut conn, &reg, input(switchable(None), Some(assistant)));

        assert!(cfg.offered.contains("read_file"));
        assert!(!cfg.offered.contains("write_file"));
        // And no way into plan mode: this assistant is already read-only, so
        // planning first would restrict nothing.
        assert!(!cfg.offered.contains("enter_plan"));
    }

    #[test]
    fn an_assistant_that_can_edit_is_offered_the_way_into_plan() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let assistant = assistant_with(None, Some(r#"["read_file","write_file"]"#));
        let cfg = resolve(&mut conn, &reg, input(switchable(None), Some(assistant)));

        assert!(cfg.offered.contains("enter_plan"));
    }

    /// `offered` is what the dispatch loop authorises against, so a model that
    /// invents `exit_plan` during ordinary work is refused before it can reach
    /// the branch that would switch modes.
    #[test]
    fn work_mode_never_authorises_the_exit_tool() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let cfg = resolve(&mut conn, &reg, input(switchable(None), None));

        assert!(!cfg.offered.contains("exit_plan"));
        assert!(!cfg.tool_defs.iter().any(|d| d.name == "exit_plan"), "not even visible");
    }

    #[test]
    fn plan_mode_narrows_and_adds_its_exit_tool() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let cfg = resolve(&mut conn, &reg, input(switchable(Some("plan")), None));

        assert!(cfg.offered.contains("read_file"));
        assert!(cfg.offered.contains("exit_plan"));
        assert!(!cfg.offered.contains("write_file"));
        assert!(!cfg.offered.contains("apply_patch"));
        assert!(cfg.system_prompt.starts_with("# Plan mode"));
    }

    /// A model that cannot take a tools field is offered nothing, transitions
    /// included. Asserted rather than left to the short-circuit above it,
    /// because that is one restructuring away from letting the mode add
    /// `enter_plan` back to an otherwise empty set.
    #[test]
    fn a_turn_with_no_tools_is_not_offered_a_way_into_plan() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let mut i = input(switchable(None), None);
        i.include_tools = false;
        let cfg = resolve(&mut conn, &reg, i);

        assert!(cfg.offered.is_empty(), "got: {:?}", cfg.offered);
        assert!(cfg.tool_defs.is_empty());
    }

    /// The headless side, end to end. It has every write tool an admin session
    /// gets, which is exactly the condition that used to earn it `enter_plan`.
    #[test]
    fn a_headless_turn_is_not_offered_the_way_into_plan() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let cfg = resolve(&mut conn, &reg, input(Modes::Fixed, None));

        assert!(cfg.offered.contains("write_file"), "it still gets its tools");
        assert!(!cfg.offered.contains("enter_plan"));
        assert!(!cfg.tool_defs.iter().any(|d| d.name == "enter_plan"));
    }

    #[test]
    fn a_mode_cannot_hand_back_what_the_assistant_withheld() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let assistant = assistant_with(None, Some(r#"["read_file"]"#));
        let cfg = resolve(&mut conn, &reg, input(switchable(Some("plan")), Some(assistant)));

        assert!(cfg.offered.contains("read_file"));
        assert!(cfg.offered.contains("exit_plan"), "the exit tool is the one exception");
        assert!(
            !cfg.offered.contains("glob"),
            "plan mode allows it, the assistant does not"
        );
    }

    #[test]
    fn a_session_without_tools_still_gets_a_prompt() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        let mut i = input(switchable(None), None);
        i.include_tools = false;
        let cfg = resolve(&mut conn, &reg, i);

        assert!(cfg.tool_defs.is_empty());
        assert!(cfg.offered.is_empty());
        assert!(cfg.system_prompt.contains("You are a test."));
    }

    #[test]
    fn state_blocks_come_last_and_in_a_fixed_order() {
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        crate::db::ops::todo::replace_active_list(
            &mut conn,
            "c1",
            "Ship it",
            &[crate::db::ops::todo::TodoItemInput {
                content: "step".into(),
                active_form: "stepping".into(),
                status: crate::db::models::todo::ItemStatus::InProgress,
            }],
            10,
        )
        .unwrap();
        let plan = crate::db::ops::plan::record_plan(&mut conn, "c1", "the plan", 10).unwrap();
        crate::db::ops::plan::approve(&mut conn, &plan.id, 20).unwrap();

        let mut i = input(switchable(None), None);
        i.context_blocks = vec!["\n\n# Project instructions\nBe brief.".into()];
        let cfg = resolve(&mut conn, &reg, i);

        let persona = cfg.system_prompt.find("You are a test.").unwrap();
        let instructions = cfg.system_prompt.find("# Project instructions").unwrap();
        let plan_at = cfg.system_prompt.find("<approved_plan>").unwrap();
        let todo = cfg.system_prompt.find("<todo_list>").unwrap();
        // Plan before checklist: the checklist churns several times a turn and
        // would otherwise push the stable plan out of the cached prefix.
        assert!(persona < instructions && instructions < plan_at && plan_at < todo);
    }

    #[test]
    fn the_estimator_and_the_chat_loop_see_the_same_prompt() {
        // Previously the estimator built its own prompt and left the checklist
        // out, so its token count ran low exactly when the context was tightest.
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();
        crate::db::ops::todo::replace_active_list(
            &mut conn,
            "c1",
            "Ship it",
            &[crate::db::ops::todo::TodoItemInput {
                content: "step".into(),
                active_form: "stepping".into(),
                status: crate::db::models::todo::ItemStatus::Pending,
            }],
            10,
        )
        .unwrap();

        let a = resolve(&mut conn, &reg, input(switchable(None), None));
        let b = resolve(&mut conn, &reg, input(switchable(None), None));
        assert_eq!(a.system_prompt, b.system_prompt);
        assert!(a.system_prompt.contains("<todo_list>"));
    }

    #[test]
    fn the_voice_block_reaches_the_prompt_like_any_context_block() {
        // chat.rs and the estimator both derive this block from
        // voice::prompt::voice_context_block over the same active path; here we
        // pin that whatever that function emits actually lands in the prompt.
        let (pool, reg) = setup();
        let mut conn = pool.get().unwrap();

        let block = crate::voice::prompt::voice_context_block(&[], true).unwrap();
        let mut i = input(switchable(None), None);
        i.context_blocks = vec![block];
        let cfg = resolve(&mut conn, &reg, i);
        assert!(cfg.system_prompt.contains("<voice_input>"));

        // And a typed-only conversation adds nothing.
        assert!(crate::voice::prompt::voice_context_block(&[], false).is_none());
    }
}
