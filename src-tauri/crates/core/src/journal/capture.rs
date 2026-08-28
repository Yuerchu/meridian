//! What a turn hands the file primitives so their writes land in the journal.
//!
//! The capture point is `tools::backend`'s primitives, not the agent loop:
//! only there do the old bytes, the new bytes and the canonical path exist on
//! one verified handle, and reading them again anywhere else reopens the
//! TOCTOU window the handle design closed. What the loop contributes is this
//! context — who is writing, on whose behalf, into which project.
//!
//! Two disciplines, both inherited from the append layer and upheld here:
//!
//! - **Recording never fails the write.** `record` logs and returns; a missed
//!   entry surfaces later as an `external` version, which is under-attribution
//!   — the direction every journal failure must take. Failing a user's
//!   successful file write over a busy database would be the wrong trade in
//!   every case.
//! - **The lock spans the observation, not just the append.** The append
//!   transaction serialises database work, but the old content was read and
//!   the file mutated *before* it. Two turns interleaving there would publish
//!   in the wrong order and mint fictional `external` transitions — so each
//!   primitive takes this context's per-path lock before it reads, and holds
//!   it until the append has landed. Cross-process interleaving has no lock
//!   and is accepted: it degrades into `external` rows, again the safe
//!   direction.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::db::ops::journal::{AppendVersion, Attribution};
use crate::journal::blobs;

/// Files past this size are not journalled — the snapshot store is for source
/// files, and a generated bundle would crowd out everything else.
const MAX_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;

/// What kind of transition a primitive is reporting.
#[derive(Debug, Clone, Copy)]
pub enum Op {
    Write,
    Edit,
    Patch,
    Delete,
    RenameFrom,
    RenameTo,
}

impl Op {
    fn as_str(self) -> &'static str {
        match self {
            Op::Write => crate::db::models::journal::version_op::WRITE,
            Op::Edit => crate::db::models::journal::version_op::EDIT,
            Op::Patch => crate::db::models::journal::version_op::PATCH,
            Op::Delete => crate::db::models::journal::version_op::DELETE,
            Op::RenameFrom => crate::db::models::journal::version_op::RENAME_FROM,
            Op::RenameTo => crate::db::models::journal::version_op::RENAME_TO,
        }
    }
}

/// One primitive's licence to record: the turn's context plus which tool and
/// which kind of transition. Built per call by `ToolContext::journal_record`.
#[derive(Clone, Copy)]
pub struct JournalRecord<'a> {
    pub ctx: &'a JournalCtx,
    pub tool_name: &'a str,
    pub op: Op,
}

/// The turn-scoped half of the journal: identity, storage, locks, gitignore.
pub struct JournalCtx {
    pub pool: crate::db::DbPool,
    pub blob_root: PathBuf,
    pub conversation_id: String,
    pub turn_id: String,
    /// `turns.origin` as a string — `desktop`, `sub_agent`, `onebot`, …
    pub origin: String,
    pub model_id: Option<String>,
    pub project_id: Option<String>,
    /// Where gitignore files are read from. `None` means no ignore filtering:
    /// a write outside any project is still a write worth attributing.
    pub project_root: Option<PathBuf>,
    /// One lock per normalised path; see the module note on what it spans.
    /// Shared across `for_turn` derivations: a sub-agent writing the same file
    /// as its parent must contend on the same lock, or the span guarantee is
    /// only against strangers.
    locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
    /// Gitignore chains, cached per directory — a turn edits the same few
    /// directories over and over. Shared for the cheaper reason: the answers
    /// are the same.
    ignore: Arc<Mutex<HashMap<PathBuf, Arc<Vec<ignore::gitignore::Gitignore>>>>>,
}

impl JournalCtx {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        pool: crate::db::DbPool,
        blob_root: PathBuf,
        conversation_id: String,
        turn_id: String,
        origin: String,
        model_id: Option<String>,
        project_id: Option<String>,
        project_root: Option<PathBuf>,
    ) -> Arc<Self> {
        Arc::new(Self {
            pool,
            blob_root,
            conversation_id,
            turn_id,
            origin,
            model_id,
            project_id,
            project_root,
            locks: Arc::new(Mutex::new(HashMap::new())),
            ignore: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// The same journal under another identity, for a delegated run.
    ///
    /// A sub-agent inherits its parent's `ToolContext` by struct update, and
    /// inheriting the journal *as is* would file the child's writes under the
    /// parent's conversation — misattribution by inheritance. Storage, locks
    /// and ignore answers are shared; who is writing is not.
    pub fn for_turn(
        &self,
        conversation_id: String,
        turn_id: String,
        origin: String,
        model_id: Option<String>,
    ) -> Arc<Self> {
        Arc::new(Self {
            pool: self.pool.clone(),
            blob_root: self.blob_root.clone(),
            conversation_id,
            turn_id,
            origin,
            model_id,
            project_id: self.project_id.clone(),
            project_root: self.project_root.clone(),
            locks: self.locks.clone(),
            ignore: self.ignore.clone(),
        })
    }

    /// The per-path lock. Taken by a primitive *before* it reads the old
    /// content and held until `record` returns; guards ordering between two
    /// turns of this process writing one file.
    pub async fn lock_path(&self, path: &Path) -> tokio::sync::OwnedMutexGuard<()> {
        let key = crate::journal::norm_path(path).unwrap_or_else(|| path.to_string_lossy().into_owned());
        let lock = {
            let mut locks = self.locks.lock().expect("journal lock table poisoned");
            locks
                .entry(key)
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        lock.lock_owned().await
    }

    /// Append one observed transition. Never fails the caller; returns the
    /// inserted version's id so a rename can link its two halves.
    pub async fn record(
        &self,
        path: &Path,
        observed_old: Option<&str>,
        new: Option<&str>,
        op: Op,
        tool_name: &str,
        moved_from_version_id: Option<String>,
    ) -> Option<String> {
        let Some(norm) = crate::journal::norm_path(path) else {
            // A non-UTF-8 path cannot be keyed without risking two files
            // sharing one chain; not journalling it is the safe direction.
            tracing::debug!(
                chars = path.to_string_lossy().chars().count(),
                "journal: non-utf8 path skipped"
            );
            return None;
        };
        if self.skipped(path) {
            return None;
        }
        if observed_old.is_some_and(|c| c.len() > MAX_SNAPSHOT_BYTES)
            || new.is_some_and(|c| c.len() > MAX_SNAPSHOT_BYTES)
        {
            tracing::debug!(path_chars = norm.chars().count(), "journal: oversized file skipped");
            return None;
        }

        // Everything below blocks — the blob store fsyncs, the append takes a
        // pooled connection — so the whole tail runs on a blocking thread.
        let pool = self.pool.clone();
        let blob_root = self.blob_root.clone();
        let display = path.to_string_lossy().into_owned();
        let conversation_id = self.conversation_id.clone();
        let turn_id = self.turn_id.clone();
        let origin = self.origin.clone();
        let model_id = self.model_id.clone();
        let project_id = self.project_id.clone();
        let tool = tool_name.to_string();
        let old_content = observed_old.map(str::to_string);
        let new_content = new.map(str::to_string);
        let appended = tokio::task::spawn_blocking(move || {
            // Bytes before rows: both snapshots are durably in the store
            // before the transaction that references them opens.
            let stored_old = old_content
                .map(|c| blobs::store(&blob_root, &c))
                .transpose()
                .map_err(|e| e.to_string())?;
            let stored_new = new_content
                .map(|c| blobs::store(&blob_root, &c))
                .transpose()
                .map_err(|e| e.to_string())?;

            let mut conn = pool.get().map_err(|e| e.to_string())?;
            crate::db::ops::journal::append_version(
                &mut conn,
                &norm,
                &AppendVersion {
                    display_path: &display,
                    op: op.as_str(),
                    observed_old: stored_old.as_ref(),
                    new: stored_new.as_ref(),
                    attribution: Attribution {
                        source: crate::db::models::journal::version_source::NATIVE,
                        conversation_id: Some(&conversation_id),
                        turn_id: Some(&turn_id),
                        project_id: project_id.as_deref(),
                        origin: Some(&origin),
                        model_id: model_id.as_deref(),
                        tool_name: Some(&tool),
                    },
                    moved_from_version_id: moved_from_version_id.as_deref(),
                    now: crate::util::now_ms(),
                },
            )
            .map_err(|e| e.to_string())
        })
        .await;

        match appended {
            Ok(Ok(outcome)) => Some(outcome.version_id),
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "journal: append failed; entry skipped");
                None
            }
            Err(e) => {
                tracing::warn!(error = %e, "journal: append task failed; entry skipped");
                None
            }
        }
    }

    /// Whether this path is outside what the journal keeps: anything under a
    /// `.git` directory, and anything the project's gitignore stack hides —
    /// the same visibility git itself gives the file, which keeps `.env` and
    /// friends out of the snapshot store.
    fn skipped(&self, path: &Path) -> bool {
        if path.components().any(|c| c.as_os_str() == ".git") {
            return true;
        }
        let Some(root) = self.project_root.as_deref() else {
            return false;
        };
        let Ok(rel_parent) = path.parent().unwrap_or(path).strip_prefix(root) else {
            // Outside the project: no gitignore applies, record it.
            return false;
        };

        let chain = self.ignore_chain(root, rel_parent);
        // Deepest .gitignore wins, which is git's own precedence; a whitelist
        // (`!kept.log`) therefore un-hides what a parent hid.
        for gi in chain.iter().rev() {
            match gi.matched(path, false) {
                ignore::Match::Ignore(_) => return true,
                ignore::Match::Whitelist(_) => return false,
                ignore::Match::None => {}
            }
        }
        false
    }

    fn ignore_chain(&self, root: &Path, rel_parent: &Path) -> Arc<Vec<ignore::gitignore::Gitignore>> {
        let parent = root.join(rel_parent);
        if let Some(cached) = self.ignore.lock().expect("ignore cache poisoned").get(&parent) {
            return cached.clone();
        }

        let mut chain = Vec::new();
        let mut dir = root.to_path_buf();
        push_gitignore(&mut chain, &dir);
        for comp in rel_parent.components() {
            dir.push(comp);
            push_gitignore(&mut chain, &dir);
        }
        let chain = Arc::new(chain);
        self.ignore
            .lock()
            .expect("ignore cache poisoned")
            .insert(parent, chain.clone());
        chain
    }
}

fn push_gitignore(chain: &mut Vec<ignore::gitignore::Gitignore>, dir: &Path) {
    let file = dir.join(".gitignore");
    if !file.is_file() {
        return;
    }
    let mut builder = ignore::gitignore::GitignoreBuilder::new(dir);
    // An unreadable or malformed line is skipped by the builder itself; an
    // error here only means the file could not be added at all, in which case
    // recording too much beats recording wrongly filtered.
    if builder.add(&file).is_none()
        && let Ok(gi) = builder.build()
    {
        chain.push(gi);
    }
}

/// A path locked and its pre-action contents read, for the destructive
/// path-based operations (`delete`, `rename`, `write_string`) that std gives
/// no handle-based form. The lock is held for the observation's lifetime, so
/// the caller's action and the eventual `commit` sit inside the same span the
/// handle-based primitives get from `lock_path`. All of these operations
/// require approval, which is what makes the path-based read tolerable at all
/// — the same argument `verify_path` makes for the operations themselves.
pub struct Observed {
    _guard: tokio::sync::OwnedMutexGuard<()>,
    pub path: PathBuf,
    pub old: Option<String>,
}

impl JournalRecord<'_> {
    /// Lock `path` and snapshot what is there now. Call before the action.
    pub async fn observe(&self, path: &Path) -> Observed {
        let guard = self.ctx.lock_path(path).await;
        Observed {
            _guard: guard,
            path: path.to_path_buf(),
            old: std::fs::read_to_string(path).ok(),
        }
    }

    /// Two paths for a rename, locked in normalised order so two opposing
    /// moves cannot deadlock each other.
    pub async fn observe_pair(&self, a: &Path, b: &Path) -> (Observed, Observed) {
        let a_key = crate::journal::norm_path(a).unwrap_or_default();
        let b_key = crate::journal::norm_path(b).unwrap_or_default();
        if a_key <= b_key {
            let first = self.observe(a).await;
            let second = self.observe(b).await;
            (first, second)
        } else {
            let second = self.observe(b).await;
            let first = self.observe(a).await;
            (first, second)
        }
    }

    /// Record the transition this record was built for. Call after the action
    /// succeeded; never fails the caller.
    pub async fn commit(&self, obs: &Observed, new: Option<&str>) -> Option<String> {
        self.commit_as(self.op, obs, new, None).await
    }

    /// Same, under a different op — a rename records two halves with two ops
    /// through one record.
    pub async fn commit_as(
        &self,
        op: Op,
        obs: &Observed,
        new: Option<&str>,
        moved_from_version_id: Option<String>,
    ) -> Option<String> {
        self.ctx
            .record(
                &obs.path,
                obs.old.as_deref(),
                new,
                op,
                self.tool_name,
                moved_from_version_id,
            )
            .await
    }
}

impl JournalCtx {
    /// Journalled files that still exist under `dir`, for a recursive delete's
    /// tombstones. Only what the journal already tracks: an untracked file's
    /// deletion is left to the external-labelling path rather than guessed at.
    pub async fn tracked_under(&self, dir: &Path) -> Vec<PathBuf> {
        let Some(mut prefix) = crate::journal::norm_path(dir) else {
            return Vec::new();
        };
        if !prefix.ends_with('/') {
            prefix.push('/');
        }
        let pool = self.pool.clone();
        let listed = tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            crate::db::ops::journal::tracked_files(&mut conn, &prefix, 256).map_err(|e| e.to_string())
        })
        .await;
        match listed {
            Ok(Ok(files)) => files.into_iter().map(|(f, _)| PathBuf::from(f.display_path)).collect(),
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "journal: listing tracked files failed; no tombstones");
                Vec::new()
            }
            Err(e) => {
                tracing::warn!(error = %e, "journal: tracked-files task failed; no tombstones");
                Vec::new()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    fn ctx(root: Option<&Path>) -> Arc<JournalCtx> {
        // `keep()` so the directory outlives the TempDir guard; the OS temp
        // cleaner owns it from here, which is fine for a test.
        let blob = tempfile::tempdir().unwrap().keep();
        JournalCtx::new(
            test_db(),
            blob,
            "conv".into(),
            "turn".into(),
            "desktop".into(),
            Some("gpt-test".into()),
            Some("proj".into()),
            root.map(Path::to_path_buf),
        )
    }

    #[tokio::test]
    async fn a_recorded_edit_lands_with_full_attribution() {
        let ctx = ctx(None);
        let id = ctx
            .record(
                Path::new("C:/p/a.rs"),
                Some("old"),
                Some("new"),
                Op::Edit,
                "edit_file",
                None,
            )
            .await
            .expect("recorded");

        let mut conn = ctx.pool.get().unwrap();
        let file = crate::db::ops::journal::file_by_path(
            &mut conn,
            &crate::journal::norm_path(Path::new("C:/p/a.rs")).unwrap(),
        )
        .unwrap()
        .expect("file row");
        let chain = crate::db::ops::journal::chain(&mut conn, &file.id).unwrap();
        assert_eq!(chain.len(), 1);
        let v = &chain[0];
        assert_eq!(v.id, id);
        assert_eq!(v.op, "edit");
        assert_eq!(v.source, "native");
        assert_eq!(v.conversation_id.as_deref(), Some("conv"));
        assert_eq!(v.turn_id.as_deref(), Some("turn"));
        assert_eq!(v.project_id.as_deref(), Some("proj"));
        assert_eq!(v.model_id.as_deref(), Some("gpt-test"));
        assert_eq!(v.tool_name.as_deref(), Some("edit_file"));
        // And the bytes are really in the store.
        assert_eq!(
            blobs::load(&ctx.blob_root, v.new_sha.as_deref().unwrap()).unwrap(),
            "new"
        );
    }

    #[tokio::test]
    async fn gitignored_files_and_git_internals_are_not_recorded() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "*.log\n!kept.log\n").unwrap();
        let ctx = ctx(Some(dir.path()));

        let ignored = dir.path().join("noise.log");
        assert!(
            ctx.record(&ignored, None, Some("x"), Op::Write, "write_file", None)
                .await
                .is_none()
        );

        // A whitelist un-hides what the same file hid.
        let kept = dir.path().join("kept.log");
        assert!(
            ctx.record(&kept, None, Some("x"), Op::Write, "write_file", None)
                .await
                .is_some()
        );

        let git_internal = dir.path().join(".git/config");
        assert!(
            ctx.record(&git_internal, None, Some("x"), Op::Write, "write_file", None)
                .await
                .is_none()
        );

        // A nested .gitignore applies to its own subtree.
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/.gitignore"), "secret.txt\n").unwrap();
        let nested = dir.path().join("sub/secret.txt");
        assert!(
            ctx.record(&nested, None, Some("x"), Op::Write, "write_file", None)
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn an_oversized_snapshot_is_skipped_not_split() {
        let ctx = ctx(None);
        let big = "x".repeat(MAX_SNAPSHOT_BYTES + 1);
        assert!(
            ctx.record(
                Path::new("C:/p/big.bin"),
                None,
                Some(&big),
                Op::Write,
                "write_file",
                None
            )
            .await
            .is_none()
        );
    }

    /// The ordering hazard the per-path lock exists for: with the lock held
    /// across observe→append, a second writer cannot slip its append between
    /// another writer's observation and publication.
    #[tokio::test]
    async fn the_path_lock_serialises_observe_to_append() {
        let ctx = ctx(None);
        let path = Path::new("C:/p/contended.rs");
        ctx.record(path, None, Some("A"), Op::Write, "write_file", None)
            .await
            .unwrap();

        // Writer 1 takes the lock, observes A, and stalls before appending.
        let guard = ctx.lock_path(path).await;
        let ctx2 = ctx.clone();
        let racer = tokio::spawn(async move {
            let _g = ctx2.lock_path(Path::new("C:/p/contended.rs")).await;
            ctx2.record(
                Path::new("C:/p/contended.rs"),
                Some("B"),
                Some("C"),
                Op::Edit,
                "edit_file",
                None,
            )
            .await
        });
        // The racer cannot proceed while the guard is held.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!racer.is_finished(), "the lock should hold the second writer");

        ctx.record(path, Some("A"), Some("B"), Op::Edit, "edit_file", None)
            .await
            .unwrap();
        drop(guard);
        racer.await.unwrap().unwrap();

        // Publication order matches lock order: A→B then B→C, no external rows.
        let mut conn = ctx.pool.get().unwrap();
        let file = crate::db::ops::journal::file_by_path(&mut conn, &crate::journal::norm_path(path).unwrap())
            .unwrap()
            .unwrap();
        let chain = crate::db::ops::journal::chain(&mut conn, &file.id).unwrap();
        assert_eq!(chain.len(), 3);
        assert!(
            chain.iter().all(|v| v.source != "external"),
            "no fictional external rows"
        );
    }
}
