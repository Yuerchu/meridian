//! Assembly of the tool definitions sent to a provider.
//!
//! Both the desktop chat loop and the OneBot loop build this list, and the
//! generated manual reads it to describe what Meridian can do. Keeping the
//! assembly here is what makes the manual a single source of truth: a tool that
//! disappears from the registry disappears from the manual with it.

use crate::db::models::skill::Skill;
use crate::provider::ToolDefinition;
use crate::tools::ToolRegistry;

use super::skills::{is_valid_slug, MAX_AVAILABLE_SKILLS};

pub const LOAD_SKILL_TOOL: &str = "load_skill";

/// Builtin + custom + MCP definitions, filtered to what the assistant enables.
/// `enabled` of `None` means every tool is allowed.
pub(crate) fn collect(
    registry: &ToolRegistry,
    mcp_defs: Vec<ToolDefinition>,
    enabled: Option<&[String]>,
) -> Vec<ToolDefinition> {
    let mut defs = registry.definitions();
    defs.extend(mcp_defs);
    match enabled {
        Some(list) => defs.into_iter().filter(|t| list.iter().any(|n| n == &t.name)).collect(),
        None => defs,
    }
}

/// Fill in the first stage of skill disclosure: what exists and what each one is
/// for, carried by `load_skill`'s own description plus an enum on `skill_name`.
///
/// The enum is why this matters — without it a model will confidently invent
/// skill names. With no skills bound the tool is dropped entirely rather than
/// offered with an empty menu.
pub(crate) fn apply_skill_catalog(defs: &mut Vec<ToolDefinition>, skills: &[Skill]) {
    let Some(idx) = defs.iter().position(|d| d.name == LOAD_SKILL_TOOL) else { return };

    // Names come off disk and so bypassed every Rust-side check; validate here,
    // at the boundary where they turn into a provider payload. An illegal name
    // reaching the API fails the whole completion, not just this tool.
    let usable: Vec<&Skill> = skills
        .iter()
        .filter(|s| is_valid_slug(&s.llm_name))
        .take(MAX_AVAILABLE_SKILLS)
        .collect();

    if usable.is_empty() {
        defs.remove(idx);
        return;
    }

    let mut catalog = String::from("\n\nAvailable skills:\n");
    let mut names: Vec<String> = Vec::new();
    for s in &usable {
        let clashes = usable.iter().filter(|o| o.llm_name == s.llm_name).count();
        if clashes > 1 {
            // Surfaced rather than silently resolved: the model should be able to
            // tell the user why the name is unusable. execute() refuses it too.
            if !names.contains(&s.llm_name) {
                catalog.push_str(&format!(
                    "- {}: [unavailable — {} skills claim this name]\n",
                    s.llm_name, clashes
                ));
            }
        } else {
            catalog.push_str(&format!("- {}: {}\n", s.llm_name, s.llm_description));
        }
        if !names.contains(&s.llm_name) {
            names.push(s.llm_name.clone());
        }
    }

    let def = &mut defs[idx];
    def.description.push_str(catalog.trim_end());
    if let Some(props) = def.parameters.get_mut("properties").and_then(|p| p.as_object_mut()) {
        if let Some(field) = props.get_mut("skill_name").and_then(|f| f.as_object_mut()) {
            field.insert("enum".into(), serde_json::json!(names));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(dir: &str, name: &str, desc: &str) -> Skill {
        Skill {
            dir_name: dir.into(),
            llm_name: name.into(),
            llm_description: desc.into(),
            display_name: dir.into(),
            display_description: None,
            source: "user".into(),
            is_enabled: 1,
            is_builtin: 0,
            mtime_hash: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn defs_with_load_skill() -> Vec<ToolDefinition> {
        vec![
            ToolDefinition {
                name: "read_file".into(),
                description: "Read a file".into(),
                parameters: serde_json::json!({"type": "object", "properties": {}}),
            },
            ToolDefinition {
                name: LOAD_SKILL_TOOL.into(),
                description: "Load a skill.".into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": { "skill_name": { "type": "string" } }
                }),
            },
        ]
    }

    fn enum_of(defs: &[ToolDefinition]) -> Vec<String> {
        defs.iter()
            .find(|d| d.name == LOAD_SKILL_TOOL)
            .and_then(|d| d.parameters["properties"]["skill_name"].get("enum").cloned())
            .map(|v| serde_json::from_value(v).unwrap())
            .unwrap_or_default()
    }

    #[test]
    fn catalog_lists_skills_and_constrains_the_enum() {
        let mut defs = defs_with_load_skill();
        apply_skill_catalog(&mut defs, &[
            skill("pdf-tools", "pdf-tools", "Fill PDF forms"),
            skill("git-helper", "git-helper", "Explain git state"),
        ]);

        let d = defs.iter().find(|d| d.name == LOAD_SKILL_TOOL).unwrap();
        assert!(d.description.contains("- pdf-tools: Fill PDF forms"));
        assert!(d.description.contains("- git-helper: Explain git state"));
        assert_eq!(enum_of(&defs), vec!["pdf-tools", "git-helper"]);
    }

    #[test]
    fn tool_is_dropped_when_nothing_is_bound() {
        let mut defs = defs_with_load_skill();
        apply_skill_catalog(&mut defs, &[]);
        assert!(defs.iter().all(|d| d.name != LOAD_SKILL_TOOL));
        assert_eq!(defs.len(), 1, "other tools must survive");
    }

    #[test]
    fn illegal_names_never_reach_the_provider_payload() {
        let mut defs = defs_with_load_skill();
        apply_skill_catalog(&mut defs, &[
            skill("good", "good", "Fine"),
            skill("bad", "Not A Slug", "Would 400 the whole request"),
        ]);
        assert_eq!(enum_of(&defs), vec!["good"]);
    }

    #[test]
    fn all_names_illegal_drops_the_tool() {
        let mut defs = defs_with_load_skill();
        apply_skill_catalog(&mut defs, &[skill("bad", "Has Spaces", "x")]);
        assert!(defs.iter().all(|d| d.name != LOAD_SKILL_TOOL));
    }

    #[test]
    fn clashing_names_are_flagged_and_listed_once() {
        let mut defs = defs_with_load_skill();
        apply_skill_catalog(&mut defs, &[
            skill("mine-pdf", "pdf", "Mine"),
            skill("theirs-pdf", "pdf", "Theirs"),
            skill("solo", "solo", "Alone"),
        ]);

        let d = defs.iter().find(|d| d.name == LOAD_SKILL_TOOL).unwrap();
        assert!(d.description.contains("2 skills claim this name"));
        assert!(!d.description.contains("- pdf: Mine"));
        assert_eq!(enum_of(&defs), vec!["pdf", "solo"], "clashing name appears once");
    }

    #[test]
    fn catalog_is_capped() {
        let skills: Vec<Skill> = (0..MAX_AVAILABLE_SKILLS + 20)
            .map(|i| skill(&format!("s-{i:03}"), &format!("s-{i:03}"), "d"))
            .collect();
        let mut defs = defs_with_load_skill();
        apply_skill_catalog(&mut defs, &skills);
        assert_eq!(enum_of(&defs).len(), MAX_AVAILABLE_SKILLS);
    }

    #[test]
    fn missing_load_skill_tool_is_a_no_op() {
        let mut defs = vec![ToolDefinition {
            name: "read_file".into(),
            description: "Read a file".into(),
            parameters: serde_json::json!({}),
        }];
        apply_skill_catalog(&mut defs, &[skill("s", "s", "d")]);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].description, "Read a file");
    }

    #[test]
    fn collect_filters_to_the_enabled_list() {
        let registry = ToolRegistry::new(std::path::PathBuf::from("/nonexistent"));
        let mcp = vec![ToolDefinition {
            name: "mcp__srv__thing".into(),
            description: "d".into(),
            parameters: serde_json::json!({}),
        }];

        let all = collect(&registry, mcp.clone(), None);
        assert!(all.iter().any(|d| d.name == "read_file"));
        assert!(all.iter().any(|d| d.name == "mcp__srv__thing"));

        let filtered =
            collect(&registry, mcp, Some(&["read_file".to_string(), "mcp__srv__thing".to_string()]));
        assert_eq!(filtered.len(), 2);
    }
}
