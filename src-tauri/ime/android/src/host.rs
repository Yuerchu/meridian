//! One keyboard, one session, the data directory it reads.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use meridian_ime_config::{APP_IDENTIFIER, HostConfig, ImeDirs, Punctuation};
use meridian_ime_engine::{Engine, InputScheme, Learner};
use meridian_ime_host::data::{
    Change, SharedScorer, Watch, build_engine, input_scheme, load_config, load_hints, load_scorer, open_learner,
};
use meridian_ime_proto::{Frame, KeyEvent};
use meridian_ime_session::{FLUSH_INTERVAL, KeyOutcome, Session, SessionConfig};

/// Whether a field in `package` may be shown the person's memory hints:
/// Meridian's own (the package is the app identifier), or one they opted in
/// through `context_apps`. A field that did not say which app it is in gets
/// none — the same rule as the Windows router, keyed on the package instead
/// of the executable.
pub fn hints_allowed(config: &HostConfig, package: Option<&str>) -> bool {
    package.is_some_and(|p| {
        let p = p.trim().to_ascii_lowercase();
        p == APP_IDENTIFIER || config.context_apps.contains(&p)
    })
}

/// The field being typed into, as the keyboard was told at `start_input`.
#[derive(Debug, Clone, Default)]
struct Field {
    package: Option<String>,
    /// The field itself asked not to be learned from (a password, or
    /// `IME_FLAG_NO_PERSONALIZED_LEARNING`).
    private: bool,
}

/// The engine and one session. Not thread-safe by design: the keyboard calls
/// it from one thread (`ime-engine`), so nothing in here takes a lock.
pub struct ImeHost {
    dirs: ImeDirs,
    config: HostConfig,
    engine: Arc<Engine>,
    learner: Box<dyn Learner>,
    scorer: Option<SharedScorer>,
    hints: Arc<[String]>,
    session: Session,
    field: Field,
    /// The layer on screen decides the scheme (the grid layer types grid,
    /// QWERTY and a hardware keyboard type pinyin); `None` is `host.json`'s.
    scheme_override: Option<InputScheme>,
    watch: Watch,
    user_words_generation: u64,
    last_flush: Instant,
}

impl ImeHost {
    /// Opens the data directory `root` (the app's `dataDir/ime`), creating
    /// it if needed. Only failing to create the directory is an error; every
    /// file in it that cannot be read leaves the keyboard typing with less.
    pub fn open(root: impl Into<PathBuf>) -> std::io::Result<Self> {
        let dirs = ImeDirs::new(root);
        dirs.ensure()?;
        let config = load_config(&dirs);
        let learner = open_learner(&dirs);
        let scorer = load_scorer(&dirs, meridian_ime_lm::Platform::Mobile);
        let (engine, _) = build_engine(&dirs, learner.as_ref(), scorer.as_ref());
        let hints = Arc::from(load_hints(&dirs));
        let user_words_generation = learner.user_words_generation();
        let watch = Watch::new(&dirs);
        let mut host = Self {
            session: Session::new(SessionConfig::default()),
            dirs,
            config,
            engine,
            learner,
            scorer,
            hints,
            field: Field::default(),
            scheme_override: None,
            watch,
            user_words_generation,
            last_flush: Instant::now(),
        };
        host.session.set_config(host.session_config());
        Ok(host)
    }

    fn session_config(&self) -> SessionConfig {
        SessionConfig {
            scheme: self.scheme_override.unwrap_or(input_scheme(self.config.scheme)),
            page_size: self.config.page_size as usize,
            full_width_punctuation: matches!(self.config.punctuation, Punctuation::FullWidth),
            learning: self.config.learning,
        }
    }

    /// Privacy and hints for the current field, from the field and the config.
    fn apply_field(&mut self) {
        let package = self.field.package.as_deref();
        let private = self.field.private || package.is_some_and(|p| self.config.is_private_app(p));
        // A private session withholds hints from the scorer itself, so the
        // private case is not repeated here (the hint test covers both).
        self.session.set_private(private);
        let hints = if hints_allowed(&self.config, package) {
            Arc::clone(&self.hints)
        } else {
            Arc::from(Vec::new())
        };
        self.session.set_hints(hints);
    }

    /// A new field has focus. Whatever was being composed in the last one is
    /// dropped without learning, and so is what surrounded its cursor.
    pub fn start_input(&mut self, package: Option<&str>, private_field: bool) -> Frame {
        let frame = self.session.reset();
        self.field = Field {
            package: package.map(str::to_owned),
            private: private_field,
        };
        self.apply_field();
        frame
    }

    /// Which scheme the keys now arriving are in; `None` goes back to
    /// `host.json`'s. Changing it drops the composition.
    pub fn set_scheme(&mut self, scheme: Option<InputScheme>) {
        self.scheme_override = scheme;
        self.session.set_config(self.session_config());
    }

    pub fn scheme(&self) -> InputScheme {
        self.session.config().scheme
    }

    /// Text around the cursor, as the field reports it. Ignored in a private
    /// field (the session enforces that).
    pub fn set_surrounding(&mut self, left: &str, right: &str) {
        self.session.set_surrounding(left, right);
    }

    pub fn handle_key(&mut self, event: KeyEvent) -> KeyOutcome {
        let out = self.session.handle_key(&self.engine, self.learner.as_mut(), event);
        self.refresh_user_words();
        out
    }

    /// A candidate on the current page was tapped.
    pub fn choose(&mut self, index_on_page: usize) -> KeyOutcome {
        let out = self.session.choose(&self.engine, self.learner.as_mut(), index_on_page);
        self.refresh_user_words();
        out
    }

    /// Drops the composition (the field lost focus, the cursor moved away).
    pub fn reset(&mut self) -> Frame {
        self.session.reset()
    }

    pub fn frame(&self) -> Frame {
        self.session.frame(self.engine.is_empty())
    }

    pub fn is_composing(&self) -> bool {
        self.session.is_composing()
    }

    /// Picks up whatever Meridian changed on disk since the last call —
    /// settings, dictionaries, a model, memory hints — and flushes learning
    /// once [`FLUSH_INTERVAL`] has passed. The keyboard calls it when a field
    /// gains focus; a keyboard that is not on screen has nobody to be current
    /// for. Returns whether anything was reloaded.
    pub fn refresh(&mut self, now: Instant) -> bool {
        let mut changed = false;
        loop {
            match self.watch.poll(&self.dirs) {
                Change::None => break,
                Change::Config => {
                    self.config = load_config(&self.dirs);
                    self.session.set_config(self.session_config());
                    self.apply_field();
                    tracing::info!("configuration reloaded");
                }
                Change::Dictionaries => self.rebuild_engine(),
                Change::Models => {
                    self.scorer = load_scorer(&self.dirs, meridian_ime_lm::Platform::Mobile);
                    self.rebuild_engine();
                }
                Change::Context => {
                    self.hints = Arc::from(load_hints(&self.dirs));
                    self.apply_field();
                    tracing::info!("memory hints reloaded");
                }
            }
            changed = true;
        }
        if now.duration_since(self.last_flush) >= FLUSH_INTERVAL {
            self.flush();
        }
        changed
    }

    /// Writes learning out now: the keyboard is hidden, memory is short, or
    /// the process is going away.
    pub fn flush(&mut self) {
        self.learner.flush();
        self.last_flush = Instant::now();
    }

    fn rebuild_engine(&mut self) {
        let (engine, _) = build_engine(&self.dirs, self.learner.as_ref(), self.scorer.as_ref());
        self.engine = engine;
        self.session.invalidate_cache();
    }

    /// A word the person composed twice became a user word: the dictionary
    /// set has to be rebuilt to carry it.
    fn refresh_user_words(&mut self) {
        let generation = self.learner.user_words_generation();
        if generation != self.user_words_generation {
            self.user_words_generation = generation;
            self.rebuild_engine();
        }
    }
}

impl Drop for ImeHost {
    fn drop(&mut self) {
        self.learner.flush();
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use meridian_ime_dict::{Catalog, CatalogEntry, DictWriter, Metadata, SyllableTable};
    use meridian_ime_session::keys::printable;

    use super::*;

    fn write_dictionary(dirs: &ImeDirs, rows: &[(&str, &str, u32)]) {
        let mut w = DictWriter::new();
        for (c, t, f) in rows {
            w.add(c, t, *f);
        }
        let meta = Metadata {
            name: "test".into(),
            license: "UNKNOWN".into(),
            attribution: String::new(),
            source: String::new(),
            cache_key: String::new(),
            version: String::new(),
            entries: 0,
            codes: 0,
            total_frequency: 0,
            created_unix: 0,
            generator: "test".into(),
            format_version: 0,
            importer_version: 1,
            syllable_table_sha256: String::new(),
        };
        std::fs::create_dir_all(dirs.dicts()).unwrap();
        w.write(&dirs.dicts().join("test.mdict"), &meta, &SyllableTable::new())
            .unwrap();
        let catalog = Catalog {
            entries: vec![CatalogEntry {
                file: "test.mdict".into(),
                name: "test".into(),
                enabled: true,
                priority: 0,
                entries: rows.len() as u64,
                license: "UNKNOWN".into(),
                imported_unix: 0,
            }],
        };
        catalog.save(&dirs.dicts()).unwrap();
    }

    const ROWS: &[(&str, &str, u32)] = &[
        ("ni", "你", 9000),
        ("ni", "泥", 400),
        ("hao", "好", 8000),
        ("ni hao", "你好", 9500),
        // Without a hint 想岗 leads; a hint naming 香港 has to turn that round.
        ("xiang gang", "想岗", 1500),
        ("xiang gang", "香港", 1000),
        ("zhong", "中", 8000),
        ("zong", "总", 900),
    ];

    fn open(dir: &Path) -> ImeHost {
        let dirs = ImeDirs::new(dir);
        write_dictionary(&dirs, ROWS);
        ImeHost::open(dir).unwrap()
    }

    fn typed(host: &mut ImeHost, keys: &str) -> KeyOutcome {
        let mut last = None;
        for ch in keys.chars() {
            last = Some(host.handle_key(printable(ch)));
        }
        last.expect("at least one key")
    }

    fn write_hints(dir: &Path, hints: &[&str]) {
        let dirs = ImeDirs::new(dir);
        meridian_ime_config::save_hints(
            &dirs,
            &meridian_ime_config::Hints {
                version: meridian_ime_config::HINTS_VERSION,
                written_at: 0,
                hints: hints.iter().map(|h| h.to_string()).collect(),
            },
        )
        .unwrap();
    }

    #[test]
    fn types_and_commits_with_the_data_directory_it_was_given() {
        let tmp = tempfile::tempdir().unwrap();
        let mut host = open(tmp.path());
        host.start_input(Some("org.example.chat"), false);
        let out = typed(&mut host, "nihao");
        assert_eq!(out.frame.candidates[0].text, "你好");
        let out = host.handle_key(printable(' '));
        assert_eq!(out.commit.as_deref(), Some("你好"));
        assert_eq!(host.learner.weight("你好"), 1);
    }

    #[test]
    fn a_private_field_is_not_learned_from() {
        let tmp = tempfile::tempdir().unwrap();
        let mut host = open(tmp.path());
        host.start_input(Some("org.example.bank"), true);
        typed(&mut host, "nihao");
        assert_eq!(host.handle_key(printable(' ')).commit.as_deref(), Some("你好"));
        assert_eq!(host.learner.weight("你好"), 0);
    }

    #[test]
    fn a_private_app_is_not_learned_from_in_any_field() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(tmp.path());
        let cfg = HostConfig {
            private_apps: vec!["org.keepassdx.keepassdx".into()],
            ..HostConfig::default()
        };
        meridian_ime_config::save(tmp.path(), &cfg).unwrap();
        write_dictionary(&dirs, ROWS);
        let mut host = ImeHost::open(tmp.path()).unwrap();
        host.start_input(Some("org.KeePassDX.keepassdx"), false);
        typed(&mut host, "nihao");
        host.handle_key(printable(' '));
        assert_eq!(host.learner.weight("你好"), 0);
    }

    #[test]
    fn memory_hints_reach_meridian_and_opted_in_apps_only() {
        let tmp = tempfile::tempdir().unwrap();
        write_hints(tmp.path(), &["下周去香港出差"]);
        let mut host = open(tmp.path());
        let first = |host: &mut ImeHost| {
            host.reset();
            typed(host, "xianggang").frame.candidates[0].text.clone()
        };

        host.start_input(Some("org.example.chat"), false);
        assert_eq!(first(&mut host), "想岗", "an app nobody opted in");
        host.start_input(None, false);
        assert_eq!(first(&mut host), "想岗", "a field that did not say");
        host.start_input(Some(APP_IDENTIFIER), false);
        assert_eq!(first(&mut host), "香港", "Meridian itself");
        host.start_input(Some(APP_IDENTIFIER), true);
        assert_eq!(first(&mut host), "想岗", "Meridian's own password field");

        let cfg = HostConfig {
            context_apps: vec!["org.example.chat".into()],
            ..HostConfig::default()
        };
        meridian_ime_config::save(tmp.path(), &cfg).unwrap();
        host.start_input(Some("org.example.chat"), false);
        bump_mtime(&ImeDirs::new(tmp.path()).config_file());
        assert!(host.refresh(Instant::now()));
        assert_eq!(first(&mut host), "香港", "opted in, picked up on refresh");
    }

    #[test]
    fn the_layer_decides_the_scheme() {
        let tmp = tempfile::tempdir().unwrap();
        let mut host = open(tmp.path());
        host.start_input(None, false);
        assert_eq!(host.scheme(), InputScheme::Pinyin);
        host.set_scheme(Some(InputScheme::Grid));
        let out = typed(&mut host, &meridian_ime_engine::grid_keys("z w ng"));
        let texts: Vec<&str> = out.frame.candidates.iter().map(|c| c.text.as_str()).collect();
        assert!(texts.contains(&"中") && texts.contains(&"总"), "{texts:?}");
        // Space only commits in the grid.
        assert_eq!(host.handle_key(printable(' ')).commit.as_deref(), Some("中"));
        host.set_scheme(None);
        assert_eq!(host.scheme(), InputScheme::Pinyin);
    }

    #[test]
    fn a_tapped_candidate_is_committed() {
        let tmp = tempfile::tempdir().unwrap();
        let mut host = open(tmp.path());
        host.start_input(None, false);
        typed(&mut host, "ni");
        let out = host.choose(1);
        assert_eq!(out.commit.as_deref(), Some("泥"));
        assert!(!host.is_composing());
    }

    #[test]
    fn a_new_field_drops_the_composition() {
        let tmp = tempfile::tempdir().unwrap();
        let mut host = open(tmp.path());
        host.start_input(None, false);
        typed(&mut host, "ni");
        assert!(host.is_composing());
        assert!(host.start_input(None, false).is_empty());
        assert!(!host.is_composing());
        assert_eq!(host.learner.weight("你"), 0);
    }

    #[test]
    fn dictionaries_imported_later_are_picked_up_on_refresh() {
        let tmp = tempfile::tempdir().unwrap();
        let mut host = ImeHost::open(tmp.path()).unwrap();
        host.start_input(None, false);
        assert!(typed(&mut host, "ni").frame.notice.is_some(), "no dictionary yet");
        host.reset();
        write_dictionary(&ImeDirs::new(tmp.path()), ROWS);
        assert!(host.refresh(Instant::now()));
        assert_eq!(typed(&mut host, "ni").frame.candidates[0].text, "你");
        assert!(!host.refresh(Instant::now()), "nothing changed since");
    }

    #[test]
    fn learning_reaches_disk_on_flush() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let mut host = open(tmp.path());
            host.start_input(None, false);
            typed(&mut host, "nihao");
            host.handle_key(printable(' '));
            host.flush();
        }
        let host = ImeHost::open(tmp.path()).unwrap();
        assert_eq!(host.learner.weight("你好"), 1);
    }

    #[test]
    fn the_outcome_serialises_the_way_the_keyboard_reads_it() {
        let tmp = tempfile::tempdir().unwrap();
        let mut host = open(tmp.path());
        host.start_input(None, false);
        let v = serde_json::to_value(typed(&mut host, "ni")).unwrap();
        assert_eq!(v["consumed"], true);
        assert!(v["commit"].is_null());
        assert_eq!(v["frame"]["candidates"][0]["text"], "你");
        assert_eq!(v["frame"]["candidates"][0]["source"], "dict");
        assert_eq!(v["frame"]["mode"], "chinese");
        assert!(v["frame"]["preedit"][0]["kind"].is_string());
    }

    /// mtime has a coarse resolution on some filesystems; move it forward
    /// explicitly so the watch sees the write.
    fn bump_mtime(path: &Path) {
        let f = std::fs::File::options().write(true).open(path).unwrap();
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        f.set_modified(later).unwrap();
    }
}
