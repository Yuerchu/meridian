//! From a data directory to an engine: what both hosts read and how.
//!
//! The Windows host process and the Android keyboard are two hosts around one
//! [`Session`](meridian_ime_session::Session) machinery, and everything they
//! read from disk — `host.json`, the dictionary catalog, the learning store,
//! a language model bundle, Meridian's memory hints — is read here, so the two
//! cannot come to disagree about what a file means or what a failure costs.
//! Every loader fails soft and says so in the log: a broken file leaves the
//! host typing with less, never not typing.

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;

use meridian_ime_config::{
    ForgetRequest, HostConfig, ImeDirs, MergeKind, Scheme, pending_forgets, pending_merges, reject_merge,
};
use meridian_ime_dict::{Catalog, DictSet};
use meridian_ime_engine::{Engine, FileLearner, InputScheme, Learner, MemoryLearner, SentenceScorer};

/// The loaded language model, shared by every engine a host builds.
pub type SharedScorer = Arc<dyn SentenceScorer>;

/// `host.json`, or the defaults when it cannot be read.
pub fn load_config(dirs: &ImeDirs) -> HostConfig {
    match meridian_ime_config::load(&dirs.root) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "host.json unreadable; using defaults");
            HostConfig::default()
        }
    }
}

pub fn input_scheme(scheme: Scheme) -> InputScheme {
    match scheme {
        Scheme::Pinyin => InputScheme::Pinyin,
        Scheme::Zhuyin => InputScheme::Zhuyin,
        Scheme::Grid => InputScheme::Grid,
    }
}

/// The learning store under `learn/`, or one in memory when it cannot be
/// opened — never an empty table written over the person's.
///
/// What Meridian asked to be forgotten while nothing held the store is
/// carried out here, before anything is typed with it.
pub fn open_learner(dirs: &ImeDirs) -> Box<dyn Learner> {
    let mut learner: Box<dyn Learner> = match FileLearner::open(&dirs.learn()) {
        Ok(l) => Box::new(l),
        Err(e) => {
            tracing::warn!(error = %e, dir = %dirs.learn().display(), "learning store unusable; learning in memory only");
            Box::new(MemoryLearner::new())
        }
    };
    apply_forgets(dirs, learner.as_mut());
    apply_merges(dirs, learner.as_mut());
    learner
}

/// Carries out Meridian's requests to forget (`meridian_ime_config::forget`)
/// on the tables this process holds, writes them at once, and only then
/// removes the requests: a crash in between carries a request out twice,
/// which forgets nothing more. A write that failed keeps them all — without
/// that, a restart reads the old tables back and nothing is left to say the
/// words were asked to go; the next poll erases again (a no-op) and retries
/// the write. A request that does not parse is set aside
/// under `.rejected` rather than removed, since removing it would quietly
/// keep what somebody asked to be rid of. Returns how many were carried out;
/// cheap to call every second when there are none. A learner that only
/// holds memory (the store could not be opened) leaves them all waiting for
/// one that writes.
pub fn apply_forgets(dirs: &ImeDirs, learner: &mut dyn Learner) -> usize {
    if !learner.persists() {
        return 0;
    }
    let pending = match pending_forgets(dirs) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "requests to forget unreadable");
            return 0;
        }
    };
    let mut done = Vec::new();
    for p in pending {
        match p.request {
            Ok(ForgetRequest::Word { text }) => learner.erase(&text),
            Ok(ForgetRequest::Everything) => learner.erase_all(),
            Err(e) => {
                tracing::warn!(error = %e, path = %p.path.display(), "request to forget does not parse; set aside");
                let mut rejected = p.path.clone().into_os_string();
                rejected.push(meridian_ime_config::forget::REJECTED_SUFFIX);
                let _ = std::fs::rename(&p.path, rejected);
                continue;
            }
        }
        done.push(p.path);
    }
    if done.is_empty() {
        return 0;
    }
    learner.flush();
    if learner.unsaved() {
        tracing::warn!(
            requests = done.len(),
            "forgot in memory but could not write the tables; the requests are kept"
        );
        return done.len();
    }
    for path in &done {
        if let Err(e) = std::fs::remove_file(path) {
            tracing::warn!(error = %e, path = %path.display(), "carried out a request to forget and could not remove it");
        }
    }
    tracing::info!(requests = done.len(), "forgot what was asked");
    done.len()
}

/// Merge add is not idempotent: absorbing the same incoming tables twice
/// doubles counts. Forget can retry after a failed write because erase is.
/// If flush fails we keep the request for a restart (disk still has the old
/// tables) but must not absorb again in this process — the next tick would.
static ABSORBED_MERGES: LazyLock<Mutex<HashSet<std::path::PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// Carries out Meridian's requests to merge another device's tables. Same
/// persist / flush / unsaved / rejected rules as [`apply_forgets`]. A merge
/// directory is removed only after the tables are written.
pub fn apply_merges(dirs: &ImeDirs, learner: &mut dyn Learner) -> usize {
    if !learner.persists() {
        return 0;
    }
    let pending = match pending_merges(dirs) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "requests to merge unreadable");
            return 0;
        }
    };
    let mut done = Vec::new();
    for p in pending {
        let kind = match p.request {
            Ok(req) => req.kind,
            Err(e) => {
                tracing::warn!(error = %e, path = %p.path.display(), "request to merge does not parse; set aside");
                if let Err(err) = reject_merge(&p.path) {
                    tracing::warn!(error = %err, path = %p.path.display(), "cannot set a bad merge aside");
                }
                continue;
            }
        };
        let incoming = match FileLearner::read(&p.path) {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!(error = %e, path = %p.path.display(), "merge tables unreadable; set aside");
                if let Err(err) = reject_merge(&p.path) {
                    tracing::warn!(error = %err, path = %p.path.display(), "cannot set a bad merge aside");
                }
                continue;
            }
        };
        let already = ABSORBED_MERGES
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .contains(&p.path);
        if !already {
            match kind {
                MergeKind::Add => learner.absorb(&incoming),
                MergeKind::Replace => {
                    learner.erase_all();
                    learner.absorb(&incoming);
                }
            }
            ABSORBED_MERGES
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .insert(p.path.clone());
        }
        done.push(p.path);
    }
    if done.is_empty() {
        return 0;
    }
    learner.flush();
    if learner.unsaved() {
        tracing::warn!(
            requests = done.len(),
            "merged in memory but could not write the tables; the requests are kept"
        );
        return done.len();
    }
    for path in &done {
        if let Err(e) = std::fs::remove_dir_all(path) {
            tracing::warn!(error = %e, path = %path.display(), "carried out a merge and could not remove it");
            continue;
        }
        ABSORBED_MERGES.lock().unwrap_or_else(|p| p.into_inner()).remove(path);
    }
    tracing::info!(requests = done.len(), "merged what was asked");
    done.len()
}

/// An engine over the enabled dictionaries plus the learner's user words,
/// with the scorer when there is one. Also returns the dictionaries' names.
pub fn build_engine(
    dirs: &ImeDirs,
    learner: &dyn Learner,
    scorer: Option<&SharedScorer>,
) -> (Arc<Engine>, Vec<String>) {
    let dicts_dir = dirs.dicts();
    let mut outdated = 0;
    let (mut set, names) = match Catalog::load(&dicts_dir) {
        Ok(catalog) => {
            let names: Vec<String> = catalog
                .entries
                .iter()
                .filter(|e| e.enabled)
                .map(|e| e.name.clone())
                .collect();
            let (set, failures) = catalog.open_all_report(&dicts_dir);
            for (file, err) in &failures {
                tracing::warn!(file, error = %err, "dictionary skipped");
            }
            outdated = failures
                .iter()
                .filter(|(_, e)| matches!(e, meridian_ime_dict::DictError::NeedsUpgrade(_)))
                .count();
            (set, names)
        }
        Err(e) => {
            tracing::warn!(error = %e, "catalog unreadable; no dictionaries");
            (DictSet::new(), Vec::new())
        }
    };
    let words = learner.user_words();
    if !words.is_empty() {
        set.set_user_words(&words);
    }
    tracing::info!(
        dictionaries = names.len(),
        user_words = words.len(),
        language_model = scorer.is_some(),
        outdated,
        "engine ready"
    );
    let mut engine = Engine::new(Arc::new(set)).with_outdated(outdated);
    if let Some(s) = scorer {
        engine = engine.with_scorer(Box::new(Arc::clone(s)));
    }
    (Arc::new(engine), names)
}

/// The preferred model bundle under `<ime>/models`, or none. Every failure is
/// logged and leaves the host typing with its dictionaries: a missing
/// runtime, a bundle that does not check out, a model that will not load.
pub fn load_scorer(dirs: &ImeDirs, platform: meridian_ime_lm::Platform) -> Option<SharedScorer> {
    let options = meridian_ime_lm::LmOptions {
        runtime: meridian_ime_lm::find_onnxruntime(),
        platform,
        threads: 2,
        budget: None,
    };
    match meridian_ime_lm::open(&dirs.models(), &options, &meridian_ime_dict::SyllableTable::new()) {
        Ok(Some(scorer)) => Some(Arc::new(scorer)),
        Ok(None) => {
            tracing::info!(dir = %dirs.models().display(), "no language model; dictionaries only");
            None
        }
        Err(e) => {
            tracing::warn!(error = %e, "language model not loaded; dictionaries only");
            None
        }
    }
}

/// Meridian's memory hints, or none when the file is absent or breaks the
/// rules `meridian_ime_config::Hints::check` enforces.
pub fn load_hints(dirs: &ImeDirs) -> Vec<String> {
    match meridian_ime_config::load_hints(dirs) {
        Ok(h) => h,
        Err(e) => {
            tracing::warn!(error = %e, "memory hints unreadable; using none");
            Vec::new()
        }
    }
}

/// Which of the files a host reads changed since it last looked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    None,
    Config,
    Dictionaries,
    Models,
    Context,
}

/// Modification times of what a host reads. Polling rather than a file
/// watcher: the writer is another process (Meridian's settings page), and a
/// second's delay is nothing next to the platform differences a watcher has.
pub struct Watch {
    config_mtime: Option<SystemTime>,
    dicts_snapshot: Vec<(String, Option<SystemTime>, u64)>,
    models_snapshot: Vec<(String, Option<SystemTime>, u64)>,
    hints_mtime: Option<SystemTime>,
}

impl Watch {
    pub fn new(dirs: &ImeDirs) -> Self {
        Self {
            config_mtime: mtime(&dirs.config_file()),
            dicts_snapshot: snapshot(dirs),
            models_snapshot: models_snapshot(dirs),
            hints_mtime: mtime(&dirs.hints_file()),
        }
    }

    /// One change at a time, in a fixed order; call until [`Change::None`].
    pub fn poll(&mut self, dirs: &ImeDirs) -> Change {
        let m = mtime(&dirs.config_file());
        if m != self.config_mtime {
            self.config_mtime = m;
            return Change::Config;
        }
        let s = snapshot(dirs);
        if s != self.dicts_snapshot {
            self.dicts_snapshot = s;
            return Change::Dictionaries;
        }
        let m = models_snapshot(dirs);
        if m != self.models_snapshot {
            self.models_snapshot = m;
            return Change::Models;
        }
        let h = mtime(&dirs.hints_file());
        if h != self.hints_mtime {
            self.hints_mtime = h;
            return Change::Context;
        }
        Change::None
    }
}

fn mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

fn snapshot(dirs: &ImeDirs) -> Vec<(String, Option<SystemTime>, u64)> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dirs.dicts()) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".mdict") || name == "catalog.toml" {
                let meta = entry.metadata().ok();
                out.push((
                    name,
                    meta.as_ref().and_then(|m| m.modified().ok()),
                    meta.map(|m| m.len()).unwrap_or(0),
                ));
            }
        }
    }
    out.sort();
    out
}

/// Each bundle's manifest, by directory: a bundle is replaced by writing its
/// files and then its manifest, so the manifest changing is the signal.
fn models_snapshot(dirs: &ImeDirs) -> Vec<(String, Option<SystemTime>, u64)> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dirs.models()) {
        for entry in rd.flatten() {
            let manifest = entry.path().join(meridian_ime_lm::bundle::MANIFEST_FILE);
            if let Ok(meta) = std::fs::metadata(&manifest) {
                out.push((
                    entry.file_name().to_string_lossy().into_owned(),
                    meta.modified().ok(),
                    meta.len(),
                ));
            }
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use meridian_ime_dict::CatalogEntry;

    use super::*;

    /// Written by the version 1 writer; see `meridian-ime-dict`'s upgrade tests.
    const V1: &[u8] = include_bytes!("../../dict/tests/fixtures/v1.mdict");

    #[test]
    fn a_dictionary_in_an_older_format_is_counted_not_just_skipped() {
        let root = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(root.path());
        dirs.ensure().unwrap();
        std::fs::write(dirs.dicts().join("old.mdict"), V1).unwrap();
        Catalog {
            entries: vec![CatalogEntry {
                file: "old.mdict".into(),
                name: "old".into(),
                enabled: true,
                priority: 0,
                entries: 18,
                license: "CC0-1.0".into(),
                imported_unix: 0,
            }],
        }
        .save(&dirs.dicts())
        .unwrap();
        let (engine, _) = build_engine(&dirs, &MemoryLearner::new(), None);
        assert!(engine.is_empty());
        assert_eq!(engine.outdated_dictionaries(), 1);

        meridian_ime_dict::upgrade_in_place(
            &dirs.dicts().join("old.mdict"),
            &meridian_ime_dict::SyllableTable::new(),
        )
        .unwrap();
        let (engine, _) = build_engine(&dirs, &MemoryLearner::new(), None);
        assert!(!engine.is_empty());
        assert_eq!(engine.outdated_dictionaries(), 0);
    }

    /// The owner of the tables carries a request out, writes it, and only
    /// then removes it; the next owner to open them finds the word gone.
    #[test]
    fn a_request_to_forget_is_carried_out_on_disk_and_then_removed() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        let mut learner = open_learner(&dirs);
        learner.record("香港");
        learner.record("你好");
        learner.flush();
        meridian_ime_config::request_forget(&dirs, &ForgetRequest::Word { text: "香港".into() }).unwrap();

        assert_eq!(apply_forgets(&dirs, learner.as_mut()), 1);
        assert_eq!(learner.weight("香港"), 0);
        assert!(pending_forgets(&dirs).unwrap().is_empty(), "removed once done");
        let reopened = FileLearner::open(&dirs.learn()).unwrap();
        assert_eq!(reopened.weight("香港"), 0, "written, not only forgotten in memory");
        assert_eq!(reopened.weight("你好"), 1);
        assert_eq!(
            apply_forgets(&dirs, learner.as_mut()),
            0,
            "nothing waiting is nothing done"
        );
    }

    /// Asked while no keyboard held the tables: done before anything is typed.
    #[test]
    fn a_request_made_while_nothing_held_the_store_is_carried_out_on_opening() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        {
            let mut learner = open_learner(&dirs);
            learner.record("香港");
            learner.flush();
        }
        meridian_ime_config::request_forget(&dirs, &ForgetRequest::Everything).unwrap();
        let learner = open_learner(&dirs);
        assert_eq!(learner.weight("香港"), 0);
        assert!(pending_forgets(&dirs).unwrap().is_empty());
    }

    /// A learner in memory cannot forget what is on disk, so it takes nothing.
    #[test]
    fn a_learner_that_does_not_write_leaves_requests_waiting() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        meridian_ime_config::request_forget(&dirs, &ForgetRequest::Everything).unwrap();
        assert_eq!(apply_forgets(&dirs, &mut MemoryLearner::new()), 0);
        assert_eq!(pending_forgets(&dirs).unwrap().len(), 1);
    }

    #[test]
    fn a_request_that_does_not_parse_is_set_aside_not_dropped() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        std::fs::create_dir_all(dirs.forget()).unwrap();
        std::fs::write(dirs.forget().join("1-1.json"), "{").unwrap();
        let mut learner = open_learner(&dirs);
        assert_eq!(apply_forgets(&dirs, learner.as_mut()), 0);
        assert!(dirs.forget().join("1-1.json.rejected").exists());
        assert!(pending_forgets(&dirs).unwrap().is_empty());
    }

    /// Found in review: a failed write used to remove the requests anyway,
    /// and a restart read the forgotten word back with nothing left to retry.
    #[test]
    fn a_request_is_kept_until_the_tables_are_written() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        let mut learner = open_learner(&dirs);
        learner.record("香港");
        learner.flush();
        meridian_ime_config::request_forget(&dirs, &ForgetRequest::Word { text: "香港".into() }).unwrap();
        // A directory where the table's file goes makes the rename fail.
        let table = dirs.learn().join("user.tsv");
        std::fs::remove_file(&table).unwrap();
        std::fs::create_dir(&table).unwrap();

        apply_forgets(&dirs, learner.as_mut());
        assert_eq!(pending_forgets(&dirs).unwrap().len(), 1, "kept while unwritten");

        std::fs::remove_dir(&table).unwrap();
        apply_forgets(&dirs, learner.as_mut());
        assert!(pending_forgets(&dirs).unwrap().is_empty(), "removed once written");
        assert_eq!(FileLearner::open(&dirs.learn()).unwrap().weight("香港"), 0);
    }

    fn incoming_tables(dir: &std::path::Path, word: &str, n: u32) -> std::path::PathBuf {
        let t = dir.join(format!("in-{word}-{n}"));
        let mut m = MemoryLearner::new();
        for _ in 0..n {
            m.record(word);
        }
        FileLearner::write_tables(&t, &m).unwrap();
        t
    }

    #[test]
    fn a_request_to_merge_add_is_carried_out_on_disk_and_then_removed() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        let mut learner = open_learner(&dirs);
        learner.record("香港");
        learner.record("你好");
        learner.flush();
        let incoming = incoming_tables(tmp.path(), "香港", 2);
        meridian_ime_config::request_merge(&dirs, MergeKind::Add, &incoming).unwrap();

        assert_eq!(apply_merges(&dirs, learner.as_mut()), 1);
        assert_eq!(learner.weight("香港"), 3);
        assert_eq!(learner.weight("你好"), 1);
        assert!(pending_merges(&dirs).unwrap().is_empty(), "removed once done");
        let reopened = FileLearner::open(&dirs.learn()).unwrap();
        assert_eq!(reopened.weight("香港"), 3);
        assert_eq!(reopened.weight("你好"), 1);
    }

    #[test]
    fn a_request_to_merge_replace_drops_what_was_here() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        let mut learner = open_learner(&dirs);
        learner.record("香港");
        learner.flush();
        let incoming = incoming_tables(tmp.path(), "你好", 1);
        meridian_ime_config::request_merge(&dirs, MergeKind::Replace, &incoming).unwrap();
        assert_eq!(apply_merges(&dirs, learner.as_mut()), 1);
        assert_eq!(learner.weight("香港"), 0);
        assert_eq!(learner.weight("你好"), 1);
        let reopened = FileLearner::open(&dirs.learn()).unwrap();
        assert_eq!(reopened.weight("香港"), 0);
        assert_eq!(reopened.weight("你好"), 1);
    }

    #[test]
    fn a_merge_made_while_nothing_held_the_store_is_carried_out_on_opening() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        {
            let mut learner = open_learner(&dirs);
            learner.record("香港");
            learner.flush();
        }
        let incoming = incoming_tables(tmp.path(), "你好", 1);
        meridian_ime_config::request_merge(&dirs, MergeKind::Add, &incoming).unwrap();
        let learner = open_learner(&dirs);
        assert_eq!(learner.weight("香港"), 1);
        assert_eq!(learner.weight("你好"), 1);
        assert!(pending_merges(&dirs).unwrap().is_empty());
    }

    #[test]
    fn a_learner_that_does_not_write_leaves_merges_waiting() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        let incoming = incoming_tables(tmp.path(), "香港", 1);
        meridian_ime_config::request_merge(&dirs, MergeKind::Add, &incoming).unwrap();
        assert_eq!(apply_merges(&dirs, &mut MemoryLearner::new()), 0);
        assert_eq!(pending_merges(&dirs).unwrap().len(), 1);
    }

    #[test]
    fn a_merge_that_does_not_parse_is_set_aside_not_dropped() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        std::fs::create_dir_all(dirs.merge()).unwrap();
        let bad = dirs.merge().join("1-1");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join("request.json"), "{").unwrap();
        let mut learner = open_learner(&dirs);
        assert_eq!(apply_merges(&dirs, learner.as_mut()), 0);
        assert!(dirs.merge().join("1-1.rejected").exists());
        assert!(pending_merges(&dirs).unwrap().is_empty());
    }

    #[test]
    fn a_merge_is_kept_until_the_tables_are_written() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        let mut learner = open_learner(&dirs);
        learner.record("你好");
        learner.flush();
        let incoming = incoming_tables(tmp.path(), "香港", 1);
        meridian_ime_config::request_merge(&dirs, MergeKind::Add, &incoming).unwrap();
        let table = dirs.learn().join("user.tsv");
        std::fs::remove_file(&table).unwrap();
        std::fs::create_dir(&table).unwrap();

        apply_merges(&dirs, learner.as_mut());
        assert_eq!(pending_merges(&dirs).unwrap().len(), 1, "kept while unwritten");

        std::fs::remove_dir(&table).unwrap();
        apply_merges(&dirs, learner.as_mut());
        assert!(pending_merges(&dirs).unwrap().is_empty(), "removed once written");
        assert_eq!(FileLearner::open(&dirs.learn()).unwrap().weight("香港"), 1);
    }

    #[test]
    fn forgets_run_before_merges_on_open() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        {
            let mut learner = open_learner(&dirs);
            learner.record("香港");
            learner.flush();
        }
        meridian_ime_config::request_forget(&dirs, &ForgetRequest::Word { text: "香港".into() }).unwrap();
        let incoming = incoming_tables(tmp.path(), "香港", 2);
        meridian_ime_config::request_merge(&dirs, MergeKind::Add, &incoming).unwrap();
        let learner = open_learner(&dirs);
        assert_eq!(
            learner.weight("香港"),
            2,
            "forgotten first, then the incoming add puts it back"
        );
    }
}
