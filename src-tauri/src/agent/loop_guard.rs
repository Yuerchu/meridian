//! Detects a model stuck repeating the same tool call with identical
//! arguments, warns it, and aborts the turn if it keeps going.

use std::hash::{DefaultHasher, Hash, Hasher};

/// Consecutive identical calls before a warning is injected instead of executing.
pub(crate) const LOOP_WARN_AFTER: u32 = 3;
/// Consecutive identical calls before the turn is aborted.
pub(crate) const LOOP_ABORT_AFTER: u32 = 5;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LoopVerdict {
    Proceed,
    Warn(u32),
    Abort(u32),
}

#[derive(Debug, Default)]
pub(crate) struct ToolLoopGuard {
    last: Option<u64>,
    consecutive: u32,
}

impl ToolLoopGuard {
    /// Record one tool call and judge whether the model is looping.
    pub(crate) fn observe(&mut self, name: &str, arguments: &str) -> LoopVerdict {
        let fingerprint = fingerprint(name, arguments);
        if self.last == Some(fingerprint) {
            self.consecutive += 1;
        } else {
            self.last = Some(fingerprint);
            self.consecutive = 1;
        }

        if self.consecutive >= LOOP_ABORT_AFTER {
            LoopVerdict::Abort(self.consecutive)
        } else if self.consecutive >= LOOP_WARN_AFTER {
            LoopVerdict::Warn(self.consecutive)
        } else {
            LoopVerdict::Proceed
        }
    }
}

/// Hash name + canonicalized arguments so formatting differences (whitespace,
/// key order) don't defeat detection. serde_json::Value maps are BTreeMap-backed,
/// so re-serializing yields a canonical form.
fn fingerprint(name: &str, arguments: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    name.hash(&mut hasher);
    match serde_json::from_str::<serde_json::Value>(arguments) {
        Ok(value) => value.to_string().hash(&mut hasher),
        Err(_) => arguments.hash(&mut hasher),
    }
    hasher.finish()
}

/// Synthetic tool result injected instead of executing a looping call.
pub(crate) fn loop_warning_message(name: &str, count: u32) -> String {
    format!(
        "Warning: you have called `{name}` with identical arguments {count} times in a row. \
         Repeating the same call will not change the result. Try a different approach, or \
         explain to the user why you are blocked."
    )
}

/// Synthetic tool result injected when the turn is aborted.
pub(crate) fn loop_abort_message(name: &str, count: u32) -> String {
    format!(
        "Aborting: `{name}` was called with identical arguments {count} times in a row. \
         The turn has been stopped to prevent an infinite loop."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warns_then_aborts_on_identical_calls() {
        let mut guard = ToolLoopGuard::default();
        assert_eq!(guard.observe("read_file", r#"{"path":"a.txt"}"#), LoopVerdict::Proceed);
        assert_eq!(guard.observe("read_file", r#"{"path":"a.txt"}"#), LoopVerdict::Proceed);
        assert_eq!(guard.observe("read_file", r#"{"path":"a.txt"}"#), LoopVerdict::Warn(3));
        assert_eq!(guard.observe("read_file", r#"{"path":"a.txt"}"#), LoopVerdict::Warn(4));
        assert_eq!(guard.observe("read_file", r#"{"path":"a.txt"}"#), LoopVerdict::Abort(5));
    }

    #[test]
    fn resets_on_different_call() {
        let mut guard = ToolLoopGuard::default();
        guard.observe("read_file", r#"{"path":"a.txt"}"#);
        guard.observe("read_file", r#"{"path":"a.txt"}"#);
        assert_eq!(guard.observe("read_file", r#"{"path":"b.txt"}"#), LoopVerdict::Proceed);
        assert_eq!(guard.observe("read_file", r#"{"path":"a.txt"}"#), LoopVerdict::Proceed);
    }

    #[test]
    fn resets_on_different_tool_with_same_args() {
        let mut guard = ToolLoopGuard::default();
        guard.observe("read_file", r#"{"path":"a.txt"}"#);
        guard.observe("read_file", r#"{"path":"a.txt"}"#);
        assert_eq!(guard.observe("delete_file", r#"{"path":"a.txt"}"#), LoopVerdict::Proceed);
    }

    #[test]
    fn formatting_differences_do_not_defeat_detection() {
        let mut guard = ToolLoopGuard::default();
        guard.observe("read_file", r#"{"path":"a.txt","limit":10}"#);
        guard.observe("read_file", r#"{ "limit": 10, "path": "a.txt" }"#);
        assert_eq!(
            guard.observe("read_file", r#"{"path":"a.txt","limit":10}"#),
            LoopVerdict::Warn(3)
        );
    }

    #[test]
    fn non_json_arguments_compare_verbatim() {
        let mut guard = ToolLoopGuard::default();
        guard.observe("custom", "not json");
        guard.observe("custom", "not json");
        assert_eq!(guard.observe("custom", "not json"), LoopVerdict::Warn(3));
        assert_eq!(guard.observe("custom", "not json 2"), LoopVerdict::Proceed);
    }
}
