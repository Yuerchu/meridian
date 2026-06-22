use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEdit {
    pub original: Option<String>,
    pub proposed: String,
    pub tool_name: String,
    pub diff: String,
}

#[derive(Debug, Default)]
pub struct EditSession {
    pending: HashMap<PathBuf, PendingEdit>,
}

impl EditSession {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stage_write(
        &mut self,
        path: PathBuf,
        original: Option<String>,
        proposed: String,
        tool_name: &str,
    ) {
        let diff = generate_unified_diff(
            &path.display().to_string(),
            original.as_deref().unwrap_or(""),
            &proposed,
        );
        self.pending.insert(
            path,
            PendingEdit {
                original,
                proposed,
                tool_name: tool_name.to_string(),
                diff,
            },
        );
    }

    pub fn get(&self, path: &PathBuf) -> Option<&PendingEdit> {
        self.pending.get(path)
    }

    pub fn pending_files(&self) -> Vec<(PathBuf, &PendingEdit)> {
        self.pending.iter().map(|(p, e)| (p.clone(), e)).collect()
    }

    pub fn approve(&mut self, path: &PathBuf) -> Option<PendingEdit> {
        self.pending.remove(path)
    }

    pub fn approve_all(&mut self) -> Vec<(PathBuf, PendingEdit)> {
        std::mem::take(&mut self.pending).into_iter().collect()
    }

    pub fn reject(&mut self, path: &PathBuf) -> Option<PendingEdit> {
        self.pending.remove(path)
    }

    pub fn reject_all(&mut self) {
        self.pending.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

fn generate_unified_diff(file_path: &str, old: &str, new: &str) -> String {
    use similar::TextDiff;

    let old_label = if old.is_empty() {
        "/dev/null".to_string()
    } else {
        format!("a/{file_path}")
    };
    let new_label = format!("b/{file_path}");

    let diff = TextDiff::from_lines(old, new);
    diff.unified_diff()
        .context_radius(3)
        .header(&old_label, &new_label)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_and_approve() {
        let mut session = EditSession::new();
        let path = PathBuf::from("/tmp/test.txt");
        session.stage_write(path.clone(), Some("old".into()), "new".into(), "write_file");

        assert!(!session.is_empty());
        assert!(session.get(&path).is_some());
        assert_eq!(session.get(&path).unwrap().proposed, "new");

        let edit = session.approve(&path).unwrap();
        assert_eq!(edit.proposed, "new");
        assert!(session.is_empty());
    }

    #[test]
    fn stage_and_reject() {
        let mut session = EditSession::new();
        let path = PathBuf::from("/tmp/test.txt");
        session.stage_write(path.clone(), None, "content".into(), "write_file");

        session.reject(&path);
        assert!(session.is_empty());
    }

    #[test]
    fn approve_all() {
        let mut session = EditSession::new();
        session.stage_write(PathBuf::from("/a"), None, "a".into(), "write_file");
        session.stage_write(PathBuf::from("/b"), None, "b".into(), "write_file");

        let edits = session.approve_all();
        assert_eq!(edits.len(), 2);
        assert!(session.is_empty());
    }

    #[test]
    fn diff_new_file() {
        let diff = generate_unified_diff("foo.txt", "", "hello\nworld\n");
        assert!(diff.contains("--- /dev/null"));
        assert!(diff.contains("+++ b/foo.txt"));
        assert!(diff.contains("+hello"));
    }

    #[test]
    fn diff_modification() {
        let diff = generate_unified_diff("foo.txt", "old\n", "new\n");
        assert!(diff.contains("--- a/foo.txt"));
        assert!(diff.contains("-old"));
        assert!(diff.contains("+new"));
    }
}
