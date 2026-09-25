//! What the input method may know about the person: short phrases from their
//! memory in Meridian, written to `<ime>/context/memory-hints.json`.
//!
//! The host decides which applications see them (Meridian's own window, and
//! any the person opted in); this module decides what is in the file at all,
//! and it is deliberately little:
//!
//! - **Only the client-global scope.** Project memories belong to a project,
//!   and the input method has no idea which project the person is in; OneBot
//!   memories are about other people and never leave core's injection path.
//! - **Only phrases, never rows.** Content is cut at punctuation into pieces
//!   of 2–32 characters that are mostly Chinese. No id, key, scope, person,
//!   origin or timestamp goes with them.
//! - **Nothing a redaction rule touched.** A memory with any hit is dropped
//!   whole rather than written with a placeholder in it.
//!
//! Memories are written from more places than this shell sees — the agent's
//! own tool saves them inside core — so rather than hook every writer the
//! file is recomputed on a timer and rewritten only when it would change.

use std::time::Duration;

use meridian_core::db;
use meridian_core::db::models::memory::{GLOBAL_SCOPE_ID, MemoryScope};
use meridian_core::db::ops::memory::VisibilityCtx;
use meridian_core::services::Services;
use meridian_ime_config::{HINTS_VERSION, Hints, ImeDirs, MAX_HINT_CHARS, MAX_HINTS};

/// How often the hints are recomputed.
pub const REFRESH: Duration = Duration::from_secs(60);

/// Pieces shorter than this are not worth a hint.
const MIN_PHRASE_CHARS: usize = 2;

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}' | '\u{20000}'..='\u{2FFFF}')
}

fn is_break(c: char) -> bool {
    c.is_whitespace()
        || c.is_ascii_punctuation()
        || matches!(
            c,
            '，' | '。'
                | '、'
                | '；'
                | '：'
                | '！'
                | '？'
                | '“'
                | '”'
                | '‘'
                | '’'
                | '（'
                | '）'
                | '《'
                | '》'
                | '【'
                | '】'
                | '…'
                | '—'
                | '·'
                | '「'
                | '」'
        )
}

/// The phrases in some memory contents, in order, without duplicates, at
/// most [`MAX_HINTS`].
pub fn phrases<'a>(contents: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for content in contents {
        for piece in content.split(is_break) {
            let piece = piece.trim();
            let n = piece.chars().count();
            if !(MIN_PHRASE_CHARS..=MAX_HINT_CHARS).contains(&n) {
                continue;
            }
            let cjk = piece.chars().filter(|&c| is_cjk(c)).count();
            // At least 60% Chinese: a hint is for Chinese typing.
            if cjk * 5 < n * 3 {
                continue;
            }
            if !out.iter().any(|p| p == piece) {
                out.push(piece.to_string());
                if out.len() == MAX_HINTS {
                    return out;
                }
            }
        }
    }
    out
}

/// The hints as they stand in the database now.
pub fn compute(services: &Services) -> Result<Vec<String>, String> {
    let mut conn = services.db.get().map_err(|e| e.to_string())?;
    let rows = db::ops::memory::list_by_scopes(
        &mut conn,
        MemoryScope::ClientGlobal,
        &[GLOBAL_SCOPE_ID.to_string()],
        &VisibilityCtx::private_injection(),
        None,
    )
    .map_err(|e| e.to_string())?;
    Ok(redacted_phrases(
        rows.iter().map(|r| r.content.as_str()),
        &services.redaction,
    ))
}

/// [`phrases`] of the contents no redaction rule touched.
pub fn redacted_phrases<'a>(
    contents: impl IntoIterator<Item = &'a str>,
    redaction: &meridian_core::redaction::RedactionEngine,
) -> Vec<String> {
    phrases(
        contents
            .into_iter()
            .filter(|c| redaction.redact(c, None).hits.is_empty()),
    )
}

/// Writes the file when `hints` differ from what `last` says was written.
/// Returns whether it wrote.
pub fn write_if_changed(dirs: &ImeDirs, hints: Vec<String>, last: &mut Option<Vec<String>>) -> Result<bool, String> {
    if last.as_ref() == Some(&hints) && dirs.hints_file().exists() {
        return Ok(false);
    }
    let written_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    meridian_ime_config::save_hints(
        dirs,
        &Hints {
            version: HINTS_VERSION,
            written_at,
            hints: hints.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    *last = Some(hints);
    Ok(true)
}

/// Keeps the file current for as long as the app runs.
pub fn spawn_refresh(services: Services, dirs: ImeDirs) {
    tauri::async_runtime::spawn(async move {
        let mut last: Option<Vec<String>> = None;
        let mut interval = tokio::time::interval(REFRESH);
        loop {
            interval.tick().await;
            let services = services.clone();
            let dirs = dirs.clone();
            let mut prev = last.clone();
            let result = tokio::task::spawn_blocking(move || {
                let hints = compute(&services)?;
                let count = hints.len();
                write_if_changed(&dirs, hints, &mut prev).map(|wrote| (wrote, count, prev))
            })
            .await;
            match result {
                Ok(Ok((wrote, count, prev))) => {
                    if wrote {
                        tracing::info!(hints = count, "input method memory hints written");
                    }
                    last = prev;
                }
                Ok(Err(e)) => tracing::warn!(error = %e, "input method memory hints not written"),
                Err(e) => tracing::warn!(error = %e, "input method memory hints task failed"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phrases_are_short_chinese_pieces() {
        let got = phrases([
            "用户不吃香菜，喜欢在周末去子午线咖啡馆。",
            "Prefers dark mode",
            "项目代号：Meridian；负责人是小丘",
            "一",
        ]);
        assert_eq!(
            got,
            vec!["用户不吃香菜", "喜欢在周末去子午线咖啡馆", "项目代号", "负责人是小丘"]
        );
    }

    #[test]
    fn duplicates_long_pieces_and_the_cap() {
        let long = "长".repeat(MAX_HINT_CHARS + 1);
        assert!(phrases([long.as_str()]).is_empty());
        assert_eq!(phrases(["香菜。香菜"]), vec!["香菜"]);
        let many: Vec<String> = (0..MAX_HINTS + 10).map(|i| format!("第{i}条记忆")).collect();
        assert_eq!(phrases(many.iter().map(String::as_str)).len(), MAX_HINTS);
    }

    #[test]
    fn unchanged_hints_are_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(dir.path());
        let mut last = None;
        assert!(write_if_changed(&dirs, vec!["香菜".into()], &mut last).unwrap());
        assert!(!write_if_changed(&dirs, vec!["香菜".into()], &mut last).unwrap());
        assert!(write_if_changed(&dirs, vec!["子午线".into()], &mut last).unwrap());
        assert_eq!(meridian_ime_config::load_hints(&dirs).unwrap(), vec!["子午线"]);
        std::fs::remove_file(dirs.hints_file()).unwrap();
        assert!(
            write_if_changed(&dirs, vec!["子午线".into()], &mut last).unwrap(),
            "a deleted file is written again"
        );
    }
}

#[cfg(test)]
mod redaction_tests {
    use super::*;

    #[test]
    fn a_memory_a_rule_touched_is_dropped_whole() {
        let engine = meridian_core::redaction::RedactionEngine::new();
        let secret = "我的邮箱是 xiaoqiu@example.com，密钥 sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
        assert!(
            !engine.redact(secret, None).hits.is_empty(),
            "the default rules catch this, or the test proves nothing"
        );
        let got = redacted_phrases([secret, "我不吃香菜"], &engine);
        assert_eq!(got, vec!["我不吃香菜"], "not even the harmless part of the other one");
    }
}
