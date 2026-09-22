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

#[cfg(test)]
mod tests {
    use super::*;

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
