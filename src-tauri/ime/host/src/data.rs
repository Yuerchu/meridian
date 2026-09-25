//! From a data directory to an engine: what both hosts read and how.
//!
//! The Windows host process and the Android keyboard are two hosts around one
//! [`Session`](meridian_ime_session::Session) machinery, and everything they
//! read from disk — `host.json`, the dictionary catalog, the learning store,
//! a language model bundle, Meridian's memory hints — is read here, so the two
//! cannot come to disagree about what a file means or what a failure costs.
//! Every loader fails soft and says so in the log: a broken file leaves the
//! host typing with less, never not typing.

use std::path::Path;
use std::sync::Arc;
use std::time::SystemTime;

use meridian_ime_config::{HostConfig, ImeDirs, Scheme};
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
pub fn open_learner(dirs: &ImeDirs) -> Box<dyn Learner> {
    match FileLearner::open(&dirs.learn()) {
        Ok(l) => Box::new(l),
        Err(e) => {
            tracing::warn!(error = %e, dir = %dirs.learn().display(), "learning store unusable; learning in memory only");
            Box::new(MemoryLearner::new())
        }
    }
}

/// An engine over the enabled dictionaries plus the learner's user words,
/// with the scorer when there is one. Also returns the dictionaries' names.
pub fn build_engine(
    dirs: &ImeDirs,
    learner: &dyn Learner,
    scorer: Option<&SharedScorer>,
) -> (Arc<Engine>, Vec<String>) {
    let dicts_dir = dirs.dicts();
    let (mut set, names) = match Catalog::load(&dicts_dir) {
        Ok(catalog) => {
            let names: Vec<String> = catalog
                .entries
                .iter()
                .filter(|e| e.enabled)
                .map(|e| e.name.clone())
                .collect();
            let (set, failures) = catalog.open_all_report(&dicts_dir);
            for (file, err) in failures {
                tracing::warn!(file, error = %err, "dictionary skipped");
            }
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
        "engine ready"
    );
    let mut engine = Engine::new(Arc::new(set));
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
