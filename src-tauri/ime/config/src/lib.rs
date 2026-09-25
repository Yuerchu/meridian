//! `host.json` and where the input method keeps its data.
//!
//! The file is the one source of truth for the host's settings: Meridian's
//! settings page writes it, the host polls its modification time and reloads.
//! There is no copy in Meridian's preferences table, so there is nothing that
//! can disagree with it. The data directory is Tauri's `app_data_dir` plus
//! `ime`, computed here from the same identifier so the host finds it with
//! Meridian closed; an explicit override wins for tests and odd installs.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Must equal `identifier` in `src-tauri/tauri.conf.json`: Tauri resolves
/// `app_data_dir` as the platform data directory joined with it.
pub const APP_IDENTIFIER: &str = "cn.yuxiaoqiu.meridian";
/// Subdirectory of the app data directory that is the input method's.
pub const IME_DIR_NAME: &str = "ime";
pub const CONFIG_FILE_NAME: &str = "host.json";
pub const DICTS_DIR_NAME: &str = "dicts";
pub const LEARN_DIR_NAME: &str = "learn";
/// Language model bundles, one directory each (see `meridian-ime-lm`).
pub const MODELS_DIR_NAME: &str = "models";
/// What Meridian tells the input method about the person (see [`Hints`]).
pub const CONTEXT_DIR_NAME: &str = "context";
pub const HINTS_FILE_NAME: &str = "memory-hints.json";
pub const HINTS_VERSION: u32 = 1;
/// Hints in the file, at most.
pub const MAX_HINTS: usize = 64;
/// Characters in one hint, at most.
pub const MAX_HINT_CHARS: usize = 32;
/// Bytes in the file, at most.
pub const MAX_HINTS_BYTES: u64 = 8 * 1024;
pub const LOG_FILE_NAME: &str = "host.log";
/// Environment variable that overrides the data directory, for the CLI and tests.
pub const DATA_DIR_ENV: &str = "MERIDIAN_IME_DATA_DIR";

pub const CONFIG_VERSION: u32 = 1;
pub const DEFAULT_PAGE_SIZE: u8 = 5;
pub const MIN_PAGE_SIZE: u8 = 3;
pub const MAX_PAGE_SIZE: u8 = 9;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Scheme {
    #[default]
    Pinyin,
    Zhuyin,
    Grid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Punctuation {
    #[default]
    FullWidth,
    HalfWidth,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostConfig {
    pub version: u32,
    pub scheme: Scheme,
    pub page_size: u8,
    pub punctuation: Punctuation,
    /// Whether the engine learns from what is typed at all. Private documents
    /// switch it off per session regardless.
    pub learning: bool,
    /// Executable names (`KeePass.exe`) whose sessions are always private.
    pub private_apps: Vec<String>,
    /// Log every key to the host log. Off unless somebody is debugging.
    pub debug_log: bool,
    /// Executable names, besides Meridian itself, whose sessions may be given
    /// the person's memory hints. Empty unless they opted an app in; absent
    /// in a file written before the field existed.
    #[serde(default)]
    pub context_apps: Vec<String>,
}

impl Default for HostConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            scheme: Scheme::Pinyin,
            page_size: DEFAULT_PAGE_SIZE,
            punctuation: Punctuation::FullWidth,
            learning: true,
            private_apps: Vec::new(),
            debug_log: false,
            context_apps: Vec::new(),
        }
    }
}

impl HostConfig {
    /// Clamps values into range and canonicalises names, so a hand-edited file
    /// cannot ask for a zero-row page.
    pub fn normalized(mut self) -> Self {
        self.page_size = self.page_size.clamp(MIN_PAGE_SIZE, MAX_PAGE_SIZE);
        for app in &mut self.private_apps {
            *app = app.trim().to_ascii_lowercase();
        }
        self.private_apps.retain(|a| !a.is_empty());
        self.private_apps.dedup();
        for app in &mut self.context_apps {
            *app = app.trim().to_ascii_lowercase();
        }
        self.context_apps.retain(|a| !a.is_empty());
        self.context_apps.dedup();
        self
    }

    /// `true` when a session in this executable must not learn.
    pub fn is_private_app(&self, exe_name: &str) -> bool {
        let name = exe_name.trim().to_ascii_lowercase();
        self.private_apps.contains(&name)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("{path}: {source}")]
    Parse { path: PathBuf, source: serde_json::Error },
    #[error("{path}: config version {found} is newer than this build understands ({supported})")]
    NewerVersion { path: PathBuf, found: u32, supported: u32 },
}

/// The input method's data directory: `$DATA_DIR_ENV` if set, else the
/// platform app data directory for [`APP_IDENTIFIER`] plus `ime`. `None` when
/// the platform has no data directory at all.
pub fn default_ime_dir() -> Option<PathBuf> {
    if let Some(over) = std::env::var_os(DATA_DIR_ENV)
        && !over.is_empty()
    {
        return Some(PathBuf::from(over));
    }
    dirs::data_dir().map(|d| d.join(APP_IDENTIFIER).join(IME_DIR_NAME))
}

/// The paths inside a data directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImeDirs {
    pub root: PathBuf,
}

impl ImeDirs {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn config_file(&self) -> PathBuf {
        self.root.join(CONFIG_FILE_NAME)
    }

    pub fn dicts(&self) -> PathBuf {
        self.root.join(DICTS_DIR_NAME)
    }

    pub fn learn(&self) -> PathBuf {
        self.root.join(LEARN_DIR_NAME)
    }

    pub fn models(&self) -> PathBuf {
        self.root.join(MODELS_DIR_NAME)
    }

    pub fn context(&self) -> PathBuf {
        self.root.join(CONTEXT_DIR_NAME)
    }

    pub fn hints_file(&self) -> PathBuf {
        self.context().join(HINTS_FILE_NAME)
    }

    pub fn log_file(&self) -> PathBuf {
        self.root.join(LOG_FILE_NAME)
    }

    /// Creates the directory tree.
    pub fn ensure(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(self.dicts())?;
        std::fs::create_dir_all(self.learn())?;
        Ok(())
    }
}

/// Reads `host.json`. A missing file is the default configuration; a file
/// that does not parse is an error, and the caller keeps whatever it had.
pub fn load(dir: &Path) -> Result<HostConfig, ConfigError> {
    let path = dir.join(CONFIG_FILE_NAME);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HostConfig::default()),
        Err(e) => return Err(e.into()),
    };
    let cfg: HostConfig = serde_json::from_str(&text).map_err(|source| ConfigError::Parse {
        path: path.clone(),
        source,
    })?;
    if cfg.version > CONFIG_VERSION {
        return Err(ConfigError::NewerVersion {
            path,
            found: cfg.version,
            supported: CONFIG_VERSION,
        });
    }
    Ok(cfg.normalized())
}

/// Writes `host.json` atomically (temporary file, then rename).
pub fn save(dir: &Path, cfg: &HostConfig) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(CONFIG_FILE_NAME);
    let tmp = dir.join(format!(".{CONFIG_FILE_NAME}.tmp-{}", std::process::id()));
    let text = serde_json::to_string_pretty(cfg).expect("HostConfig serialises");
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        use std::io::Write;
        f.write_all(text.as_bytes())?;
        f.write_all(b"\n")?;
        f.sync_all()?;
        std::fs::rename(&tmp, &path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Short phrases from the person's memory in Meridian, written by Meridian
/// for the input method to prefer. Only what survived redaction ever lands
/// here, and only the phrase: no id, scope, person or source goes with it.
/// Which applications may be shown them is the host's decision, not this
/// file's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hints {
    pub version: u32,
    /// Unix seconds.
    pub written_at: u64,
    pub hints: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum HintsError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("{path}: {source}")]
    Parse { path: PathBuf, source: serde_json::Error },
    #[error("{0}")]
    Invalid(String),
}

impl Hints {
    /// Refuses what the writer must never produce: an unknown version, too
    /// many hints, an empty or overlong one.
    pub fn check(&self) -> Result<(), HintsError> {
        if self.version != HINTS_VERSION {
            return Err(HintsError::Invalid(format!("hints version {}", self.version)));
        }
        if self.hints.len() > MAX_HINTS {
            return Err(HintsError::Invalid(format!(
                "{} hints, at most {MAX_HINTS}",
                self.hints.len()
            )));
        }
        if let Some(h) = self
            .hints
            .iter()
            .find(|h| h.trim().is_empty() || h.chars().count() > MAX_HINT_CHARS)
        {
            return Err(HintsError::Invalid(format!(
                "hint {h:?} is empty or longer than {MAX_HINT_CHARS}"
            )));
        }
        Ok(())
    }
}

/// Reads the hints. A missing file is none; a file over the size limit or
/// breaking the rules in [`Hints::check`] is an error, and the caller uses
/// none.
pub fn load_hints(dirs: &ImeDirs) -> Result<Vec<String>, HintsError> {
    let path = dirs.hints_file();
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    if meta.len() > MAX_HINTS_BYTES {
        return Err(HintsError::Invalid(format!(
            "{} is {} bytes, at most {MAX_HINTS_BYTES}",
            path.display(),
            meta.len()
        )));
    }
    let text = std::fs::read_to_string(&path)?;
    let hints: Hints = serde_json::from_str(&text).map_err(|source| HintsError::Parse { path, source })?;
    hints.check()?;
    Ok(hints.hints)
}

/// Writes the hints atomically, after checking them.
pub fn save_hints(dirs: &ImeDirs, hints: &Hints) -> Result<(), HintsError> {
    hints.check()?;
    let text = serde_json::to_string(hints).expect("Hints serialises");
    if text.len() as u64 > MAX_HINTS_BYTES {
        return Err(HintsError::Invalid(format!(
            "{} bytes, at most {MAX_HINTS_BYTES}",
            text.len()
        )));
    }
    let dir = dirs.context();
    std::fs::create_dir_all(&dir)?;
    let tmp = dir.join(format!(".{HINTS_FILE_NAME}.tmp-{}", std::process::id()));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        use std::io::Write;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, dirs.hints_file())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(result?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hints(list: &[&str]) -> Hints {
        Hints {
            version: HINTS_VERSION,
            written_at: 1,
            hints: list.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn hints_round_trip_and_a_missing_file_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(dir.path());
        assert!(load_hints(&dirs).unwrap().is_empty());
        save_hints(&dirs, &hints(&["香菜", "子午线"])).unwrap();
        assert_eq!(load_hints(&dirs).unwrap(), vec!["香菜", "子午线"]);
    }

    #[test]
    fn hints_over_the_limits_are_refused_both_ways() {
        let dir = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(dir.path());
        let long = "字".repeat(MAX_HINT_CHARS + 1);
        assert!(save_hints(&dirs, &hints(&[&long])).is_err());
        assert!(save_hints(&dirs, &hints(&[" "])).is_err());
        let many: Vec<String> = (0..=MAX_HINTS).map(|i| format!("词{i}")).collect();
        let refs: Vec<&str> = many.iter().map(String::as_str).collect();
        assert!(save_hints(&dirs, &hints(&refs)).is_err());
        // A file written by something else is held to the same rules.
        std::fs::create_dir_all(dirs.context()).unwrap();
        std::fs::write(
            dirs.hints_file(),
            format!(r#"{{"version":1,"written_at":1,"hints":["{long}"]}}"#),
        )
        .unwrap();
        assert!(load_hints(&dirs).is_err());
        std::fs::write(
            dirs.hints_file(),
            r#"{"version":1,"written_at":1,"hints":[],"person":"x"}"#,
        )
        .unwrap();
        assert!(
            matches!(load_hints(&dirs), Err(HintsError::Parse { .. })),
            "no extra fields"
        );
        std::fs::write(dirs.hints_file(), vec![b' '; MAX_HINTS_BYTES as usize + 1]).unwrap();
        assert!(
            matches!(load_hints(&dirs), Err(HintsError::Invalid(_))),
            "size is checked before parsing"
        );
    }

    #[test]
    fn context_apps_default_to_none_and_normalise() {
        let cfg: HostConfig = serde_json::from_str(
            r#"{"version":1,"scheme":"pinyin","page_size":5,"punctuation":"full_width","learning":true,"private_apps":[],"debug_log":false}"#,
        )
        .unwrap();
        assert!(cfg.context_apps.is_empty(), "a file from before the field");
        let cfg = HostConfig {
            context_apps: vec![" Notepad.EXE ".into(), "".into()],
            ..Default::default()
        }
        .normalized();
        assert_eq!(cfg.context_apps, vec!["notepad.exe"]);
    }

    #[test]
    fn missing_file_is_default_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()).unwrap(), HostConfig::default());
        let cfg = HostConfig {
            page_size: 7,
            private_apps: vec![" KeePass.EXE ".into()],
            ..Default::default()
        };
        save(dir.path(), &cfg).unwrap();
        let back = load(dir.path()).unwrap();
        assert_eq!(back.page_size, 7);
        assert_eq!(back.private_apps, vec!["keepass.exe"]);
        assert!(back.is_private_app("KEEPASS.exe"));
        assert!(!back.is_private_app("notepad.exe"));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "no temp file left");
    }

    #[test]
    fn bad_file_is_an_error_not_a_default() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(CONFIG_FILE_NAME), "{not json").unwrap();
        assert!(matches!(load(dir.path()), Err(ConfigError::Parse { .. })));
        std::fs::write(dir.path().join(CONFIG_FILE_NAME), r#"{"version":99,"scheme":"pinyin","page_size":5,"punctuation":"full_width","learning":true,"private_apps":[],"debug_log":false}"#).unwrap();
        assert!(matches!(
            load(dir.path()),
            Err(ConfigError::NewerVersion { found: 99, .. })
        ));
        std::fs::write(dir.path().join(CONFIG_FILE_NAME), r#"{"version":1,"scheme":"pinyin","page_size":5,"punctuation":"full_width","learning":true,"private_apps":[],"debug_log":false,"extra":1}"#).unwrap();
        assert!(
            matches!(load(dir.path()), Err(ConfigError::Parse { .. })),
            "unknown keys are refused"
        );
    }

    #[test]
    fn page_size_is_clamped() {
        let dir = tempfile::tempdir().unwrap();
        save(
            dir.path(),
            &HostConfig {
                page_size: 40,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(load(dir.path()).unwrap().page_size, MAX_PAGE_SIZE);
    }

    #[test]
    fn dirs_layout() {
        let d = ImeDirs::new("/x");
        assert_eq!(d.config_file(), PathBuf::from("/x").join("host.json"));
        assert_eq!(d.dicts(), PathBuf::from("/x").join("dicts"));
        assert_eq!(d.learn(), PathBuf::from("/x").join("learn"));
    }
}
