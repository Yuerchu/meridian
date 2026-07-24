use async_trait::async_trait;
use super::{Permission, Tool, ToolContext};

pub struct ApplyPatchTool;

#[async_trait]
impl Tool for ApplyPatchTool {
    fn name(&self) -> &str {
        "apply_patch"
    }

    fn description(&self) -> &str {
        "Apply a unified diff patch to one or more files. The patch should be in standard unified diff format (as produced by `diff -u` or `git diff`)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "patch": {
                    "type": "string",
                    "description": "The unified diff patch content"
                },
                "base_path": {
                    "type": "string",
                    "description": "Base directory path to resolve relative file paths in the patch (optional)"
                }
            },
            "required": ["patch"]
        })
    }

    fn default_permission(&self) -> Permission {
        Permission::Ask
    }

    async fn execute(&self, args: serde_json::Value, context: &ToolContext) -> Result<String, String> {
        let patch = args["patch"]
            .as_str()
            .ok_or("missing 'patch' argument")?;
        let base_str: Option<String> = args["base_path"].as_str()
            .map(str::to_string)
            .or_else(|| context.working_directory.clone());

        let file_patches = parse_unified_diff(patch)?;
        if file_patches.is_empty() {
            return Err("no file changes found in patch".to_string());
        }

        let mut applied = Vec::new();

        for fp in &file_patches {
            let is_absolute =
                std::path::Path::new(&fp.path).is_absolute() || fp.path.starts_with('/');
            let joined = if is_absolute {
                fp.path.clone()
            } else if let Some(ref base) = base_str {
                format!("{base}/{}", fp.path)
            } else {
                fp.path.clone()
            };
            let target = context.resolve_and_validate(&joined)?;

            let original = if fp.is_new_file {
                String::new()
            } else {
                super::backend::read_to_string(&target).await?
            };

            let result = apply_hunks(&original, &fp.hunks)?;

            if let Some(ref session) = context.edit_session {
                if let super::ResolvedTarget::Real(ref p) = target {
                    let orig = if fp.is_new_file { None } else { Some(original) };
                    let mut session = session.lock().await;
                    session.stage_write(p.clone(), orig, result, "apply_patch");
                } else {
                    super::backend::write_string(&target, &result).await?;
                }
            } else {
                super::backend::write_string(&target, &result).await?;
            }

            applied.push(fp.path.clone());
        }

        Ok(format!(
            "Applied patch to {} file(s): {}",
            applied.len(),
            applied.join(", ")
        ))
    }
}

struct FilePatch {
    path: String,
    is_new_file: bool,
    hunks: Vec<Hunk>,
}

struct Hunk {
    old_start: usize,
    lines: Vec<PatchLine>,
}

enum PatchLine {
    Context(String),
    Add(String),
    Remove(String),
}

fn parse_unified_diff(patch: &str) -> Result<Vec<FilePatch>, String> {
    let mut files = Vec::new();
    let lines: Vec<&str> = patch.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        // Look for --- line
        if lines[i].starts_with("--- ") && i + 1 < lines.len() && lines[i + 1].starts_with("+++ ") {
            let old_path = strip_prefix(lines[i].trim_start_matches("--- "));
            let new_path = strip_prefix(lines[i + 1].trim_start_matches("+++ "));
            let is_new_file = old_path == "/dev/null";
            let path = if is_new_file { new_path } else { old_path };
            i += 2;

            let mut hunks = Vec::new();
            while i < lines.len() && lines[i].starts_with("@@ ") {
                let (hunk, next_i) = parse_hunk(&lines, i)?;
                hunks.push(hunk);
                i = next_i;
            }

            if !hunks.is_empty() {
                files.push(FilePatch { path, is_new_file, hunks });
            }
        } else {
            i += 1;
        }
    }

    Ok(files)
}

fn strip_prefix(path: &str) -> String {
    let path = path.trim();
    // Strip a/ or b/ prefix from git diffs
    if path.starts_with("a/") || path.starts_with("b/") {
        path[2..].to_string()
    } else {
        path.to_string()
    }
}

fn parse_hunk(lines: &[&str], start: usize) -> Result<(Hunk, usize), String> {
    let header = lines[start];
    let old_start = parse_hunk_header(header)?;

    let mut hunk_lines = Vec::new();
    let mut i = start + 1;

    while i < lines.len() {
        let line = lines[i];
        if line.starts_with("@@ ") || line.starts_with("--- ") || line.starts_with("+++ ") {
            break;
        }
        if let Some(rest) = line.strip_prefix('+') {
            hunk_lines.push(PatchLine::Add(rest.to_string()));
        } else if let Some(rest) = line.strip_prefix('-') {
            hunk_lines.push(PatchLine::Remove(rest.to_string()));
        } else if let Some(rest) = line.strip_prefix(' ') {
            hunk_lines.push(PatchLine::Context(rest.to_string()));
        } else if line.starts_with('\\') {
            // "\ No newline at end of file" — skip
        } else if line.is_empty() {
            // Empty context line
            hunk_lines.push(PatchLine::Context(String::new()));
        } else {
            break;
        }
        i += 1;
    }

    Ok((Hunk { old_start, lines: hunk_lines }, i))
}

fn parse_hunk_header(header: &str) -> Result<usize, String> {
    // @@ -old_start,old_count +new_start,new_count @@
    let re = regex::Regex::new(r"@@ -(\d+)").unwrap();
    let caps = re.captures(header)
        .ok_or_else(|| format!("invalid hunk header: {header}"))?;
    caps[1].parse::<usize>()
        .map_err(|e| format!("invalid line number in hunk header: {e}"))
}

fn apply_hunks(original: &str, hunks: &[Hunk]) -> Result<String, String> {
    let line_ending = if original.contains("\r\n") { "\r\n" } else { "\n" };
    let orig_lines: Vec<&str> = if original.is_empty() {
        Vec::new()
    } else {
        original.lines().collect()
    };

    let mut result = Vec::new();
    let mut pos: usize = 0; // 0-indexed position in original

    for hunk in hunks {
        let start = if hunk.old_start == 0 { 0 } else { hunk.old_start - 1 };

        // Copy unchanged lines before this hunk
        while pos < start && pos < orig_lines.len() {
            result.push(orig_lines[pos].to_string());
            pos += 1;
        }

        for line in &hunk.lines {
            match line {
                PatchLine::Context(s) => {
                    let actual = orig_lines.get(pos).copied().unwrap_or("");
                    if pos >= orig_lines.len() || actual != s.as_str() {
                        return Err(format!(
                            "patch context mismatch at line {}: expected {s:?} but found {actual:?}",
                            pos + 1
                        ));
                    }
                    result.push(orig_lines[pos].to_string());
                    pos += 1;
                }
                PatchLine::Add(s) => {
                    result.push(s.clone());
                }
                PatchLine::Remove(s) => {
                    let actual = orig_lines.get(pos).copied().unwrap_or("");
                    if pos >= orig_lines.len() || actual != s.as_str() {
                        return Err(format!(
                            "patch delete mismatch at line {}: expected to remove {s:?} but found {actual:?}",
                            pos + 1
                        ));
                    }
                    pos += 1;
                }
            }
        }
    }

    // Copy remaining lines after last hunk
    while pos < orig_lines.len() {
        result.push(orig_lines[pos].to_string());
        pos += 1;
    }

    let mut out = result.join(line_ending);
    if original.ends_with('\n') || original.is_empty() {
        out.push_str(line_ending);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_hunks_context_and_add() {
        let original = "line1\nline2\nline3\n";
        let hunks = vec![Hunk {
            old_start: 1,
            lines: vec![
                PatchLine::Context("line1".into()),
                PatchLine::Add("inserted".into()),
                PatchLine::Context("line2".into()),
            ],
        }];
        let out = apply_hunks(original, &hunks).unwrap();
        assert_eq!(out, "line1\ninserted\nline2\nline3\n");
    }

    #[test]
    fn test_apply_hunks_context_mismatch_rejected() {
        let original = "alpha\nbeta\ngamma\n";
        let hunks = vec![Hunk {
            old_start: 1,
            lines: vec![PatchLine::Context("WRONG".into()), PatchLine::Add("x".into())],
        }];
        assert!(apply_hunks(original, &hunks).is_err());
    }

    #[test]
    fn test_apply_hunks_remove_mismatch_rejected() {
        let original = "a\nb\nc\n";
        let hunks = vec![Hunk {
            old_start: 1,
            lines: vec![PatchLine::Remove("NOT_A".into())],
        }];
        assert!(apply_hunks(original, &hunks).is_err());
    }

    #[test]
    fn test_apply_hunks_preserves_crlf() {
        let original = "one\r\ntwo\r\nthree\r\n";
        let hunks = vec![Hunk {
            old_start: 2,
            lines: vec![
                PatchLine::Context("two".into()),
                PatchLine::Add("added".into()),
            ],
        }];
        let out = apply_hunks(original, &hunks).unwrap();
        assert_eq!(out, "one\r\ntwo\r\nadded\r\nthree\r\n");
    }
}
