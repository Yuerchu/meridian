use crate::provider::ToolDefinition;

/// Built-in agent baseline injected ahead of the user-configurable assistant
/// prompt whenever file-editing tools are enabled for the session. The
/// assistant prompt is a persona layer on top of this; agent discipline must
/// not depend on the user writing (or keeping) it. Only lines for tools that
/// are actually enabled are emitted, so the model is never pointed at a tool
/// it cannot call.
pub(crate) fn base_prompt(tool_defs: &[ToolDefinition]) -> Option<String> {
    let has = |name: &str| tool_defs.iter().any(|t| t.name == name);

    if !has("write_file") && !has("edit_file") && !has("apply_patch") {
        return None;
    }

    let mut lines = vec![
        "# Agent guidelines".to_string(),
        String::new(),
        "You have tools to inspect and modify the user's files. Follow this discipline:".to_string(),
        String::new(),
    ];
    if has("read_file") {
        lines.push(
            "- Read a file before modifying it; base every edit on its actual current content, \
             never on assumptions."
                .to_string(),
        );
    }
    if has("edit_file") {
        lines.push(
            "- Prefer `edit_file` for targeted changes; `old_string` must match the file content \
             exactly, including whitespace and indentation."
                .to_string(),
        );
    }
    if has("apply_patch") {
        lines.push(
            "- `apply_patch` accepts a standard unified diff or a Codex-style patch \
             (`*** Begin Patch` envelope)."
                .to_string(),
        );
    }
    if has("write_file") {
        lines.push(
            "- Use `write_file` only to create new files or fully rewrite a file on purpose; it \
             overwrites the entire file."
                .to_string(),
        );
    }
    lines.push(
        "- If a tool call fails, read the error message and change your approach; never repeat \
         the same call with identical arguments."
            .to_string(),
    );
    lines.push(
        "- Make the smallest change that fulfills the request; do not refactor unrelated code."
            .to_string(),
    );
    Some(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn def(name: &str) -> ToolDefinition {
        ToolDefinition {
            name: name.to_string(),
            description: String::new(),
            parameters: serde_json::json!({}),
        }
    }

    #[test]
    fn no_file_editing_tools_means_no_prompt() {
        assert!(base_prompt(&[]).is_none());
        assert!(base_prompt(&[def("read_file"), def("web_search"), def("qq_send_poke")]).is_none());
    }

    #[test]
    fn any_editing_tool_enables_the_prompt() {
        let p = base_prompt(&[def("edit_file")]).unwrap();
        assert!(p.contains("# Agent guidelines"));
        assert!(p.contains("edit_file"));
        // Lines for tools that are not enabled must not appear.
        assert!(!p.contains("apply_patch"));
        assert!(!p.contains("write_file"));
        assert!(!p.contains("Read a file before modifying"));
    }

    #[test]
    fn full_toolset_includes_all_guidelines() {
        let defs = [
            def("read_file"),
            def("write_file"),
            def("edit_file"),
            def("apply_patch"),
        ];
        let p = base_prompt(&defs).unwrap();
        assert!(p.contains("Read a file before modifying"));
        assert!(p.contains("old_string"));
        assert!(p.contains("*** Begin Patch"));
        assert!(p.contains("overwrites the entire file"));
        assert!(p.contains("identical arguments"));
    }
}
