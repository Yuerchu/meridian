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

    /// The paths currently staged.
    ///
    /// Approving in bulk walks this and drops each entry only once its write has
    /// landed. Taking the whole map up front instead would mean a write that
    /// fails half way leaves the remaining edits neither on disk nor in the
    /// session — unrecoverable, and invisible until the user goes looking for
    /// changes that are no longer there.
    pub fn pending_paths(&self) -> Vec<PathBuf> {
        self.pending.keys().cloned().collect()
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
    fn pending_paths_lists_everything_staged() {
        let mut session = EditSession::new();
        session.stage_write(PathBuf::from("/a"), None, "a".into(), "write_file");
        session.stage_write(PathBuf::from("/b"), None, "b".into(), "write_file");

        let mut paths = session.pending_paths();
        paths.sort();
        assert_eq!(paths, [PathBuf::from("/a"), PathBuf::from("/b")]);
        // Listing must not consume: the bulk approval writes each file before
        // dropping its entry.
        assert!(!session.is_empty());
    }

    /// What a partial bulk approval must leave behind. The caller approves each
    /// path only after its write succeeds, so a failure half way keeps the rest
    /// staged instead of discarding them.
    #[test]
    fn approving_one_at_a_time_leaves_the_others_staged() {
        let mut session = EditSession::new();
        session.stage_write(PathBuf::from("/a"), None, "a".into(), "write_file");
        session.stage_write(PathBuf::from("/b"), None, "b".into(), "write_file");

        assert!(session.approve(&PathBuf::from("/a")).is_some());

        assert!(!session.is_empty());
        assert_eq!(session.pending_paths(), [PathBuf::from("/b")]);
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
