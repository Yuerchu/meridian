//! Meridian's side of the input method.
//!
//! The input method runs without Meridian: a DLL in every application and a
//! host process per login session, neither of which knows this app exists.
//! What Meridian adds is the place to set it up — is it registered, is the
//! host running, which dictionaries are there, how many candidates per page —
//! and the two jobs that need a window: importing a Rime dictionary, and
//! asking for elevation to register the DLL.
//!
//! So `ImeBridge` holds no state of the input method's. It reads the same
//! `host.json` the host reads, opens the same pipe the text services open (as
//! a control client, which only asks for status), and runs the same importer
//! the CLI runs.
//!
//! On Android there is no host and no DLL: the keyboard is a service in this
//! same APK that reads the same data directory. What this side adds there is
//! the keyboard's system state (enabled, selected) and getting dictionaries
//! in, which on a phone means an archive or a download (`archive`).

#[cfg(target_os = "android")]
pub(crate) mod android;
pub(crate) mod archive;
pub(crate) mod dictionary;
pub(crate) mod hints;
#[cfg(windows)]
pub(crate) mod host_process;
pub(crate) mod models;
#[cfg(windows)]
pub(crate) mod probe;
#[cfg(windows)]
pub(crate) mod registry;

#[cfg(windows)]
use std::path::PathBuf;
use std::sync::Arc;

use meridian_core::services::Services;
use meridian_ime_config::ImeDirs;
use tokio::sync::Mutex;

/// What the shell knows about where the input method's pieces are.
#[derive(Debug, Clone)]
pub struct ImeBridge {
    pub dirs: ImeDirs,
    /// The host executable, if it was found at startup.
    #[cfg(windows)]
    pub host_exe: Option<PathBuf>,
    /// The 64-bit DLL, if it was found at startup.
    #[cfg(windows)]
    pub dll_x64: Option<PathBuf>,
    /// The 32-bit DLL, if shipped.
    #[cfg(windows)]
    pub dll_x86: Option<PathBuf>,
}

fn ime_dirs(services: &Services) -> ImeDirs {
    ImeDirs::new(services.paths.data_dir.join(meridian_ime_config::IME_DIR_NAME))
}

impl ImeBridge {
    /// The data directory, which is all there is to find on Android: the
    /// keyboard is part of this APK.
    #[cfg(target_os = "android")]
    pub fn locate(services: &Services, _app: &tauri::AppHandle) -> Self {
        Self {
            dirs: ime_dirs(services),
        }
    }

    /// Resolves the data directory (Meridian's own, plus `ime`) and looks for
    /// the artifacts beside the app: `resources/ime/` in an installed build,
    /// the cargo target directory in development.
    #[cfg(windows)]
    pub fn locate(services: &Services, app: &tauri::AppHandle) -> Self {
        let dirs = ime_dirs(services);
        let candidates = host_process::artifact_dirs(app);
        let find = |names: &[String]| -> Option<PathBuf> {
            for dir in &candidates {
                for name in names {
                    let p = dir.join(name);
                    if p.exists() {
                        return Some(p);
                    }
                }
                // Versioned DLLs: any `meridian_ime_tsf-*.dll` in the directory.
                if let Ok(rd) = std::fs::read_dir(dir) {
                    let mut found: Vec<PathBuf> = rd
                        .flatten()
                        .map(|e| e.path())
                        .filter(|p| {
                            let n = p
                                .file_name()
                                .map(|n| n.to_string_lossy().into_owned())
                                .unwrap_or_default();
                            names.iter().any(|want| {
                                want.ends_with('*') && n.starts_with(&want[..want.len() - 1]) && n.ends_with(".dll")
                            })
                        })
                        .collect();
                    found.sort();
                    if let Some(p) = found.pop() {
                        return Some(p);
                    }
                }
            }
            None
        };
        let version = env!("CARGO_PKG_VERSION");
        Self {
            host_exe: std::env::var_os("MERIDIAN_IME_HOST")
                .map(PathBuf::from)
                .filter(|p| p.exists())
                .or_else(|| find(&[meridian_ime_proto::ids::HOST_EXE_NAME.to_string()])),
            dll_x64: find(&[
                format!("meridian_ime_tsf-{version}.dll"),
                "meridian_ime_tsf.dll".into(),
                "meridian_ime_tsf-*".into(),
            ]),
            dll_x86: find(&[
                format!("meridian_ime_tsf32-{version}.dll"),
                "meridian_ime_tsf32-*".into(),
            ]),
            dirs,
        }
    }
}

/// Held in Tauri state; the commands lock it for the duration of a call.
pub struct AppIme {
    pub bridge: Arc<Mutex<ImeBridge>>,
    /// What the last pick staged, until it is imported or replaced. One slot:
    /// there is one settings page, and a second pick supersedes the first.
    pub staged: Arc<Mutex<Option<archive::Staged>>>,
}

/// Locates everything, makes sure the data directory exists with a default
/// `host.json`, keeps the memory hints current, and on Windows starts the
/// host if the DLL is registered and nothing is serving the pipe yet.
/// Meridian closing does not stop it: the host belongs to the login session,
/// not to this window.
pub(crate) async fn maybe_start(services: Services, app: tauri::AppHandle) -> AppIme {
    let bridge = ImeBridge::locate(&services, &app);
    hints::spawn_refresh(services.clone(), bridge.dirs.clone());
    if let Err(e) = bridge.dirs.ensure() {
        tracing::warn!(error = %e, dir = %bridge.dirs.root.display(), "cannot create the input method's data directory");
    } else if !bridge.dirs.config_file().exists()
        && let Err(e) = meridian_ime_config::save(&bridge.dirs.root, &meridian_ime_config::HostConfig::default())
    {
        tracing::warn!(error = %e, "cannot write the default host.json");
    }
    #[cfg(windows)]
    start_host_if_registered(&bridge);
    AppIme {
        bridge: Arc::new(Mutex::new(bridge)),
        staged: Arc::new(Mutex::new(None)),
    }
}

#[cfg(windows)]
fn start_host_if_registered(bridge: &ImeBridge) {
    let registered = registry::is_registered_x64();
    if registered {
        let bridge2 = bridge.clone();
        tokio::task::spawn_blocking(move || {
            if probe::status().is_none() {
                match host_process::start(&bridge2) {
                    Ok(()) => tracing::info!("input method host started"),
                    Err(e) => tracing::warn!(error = %e, "input method host not started"),
                }
            }
        });
    } else {
        tracing::info!("input method not registered; not starting its host");
    }
}

/// Tells whatever reads the dictionaries that they changed. The Windows host
/// polls the directory anyway and this only makes it immediate; the Android
/// keyboard rereads it when it next comes up, so there is nothing to tell.
pub(crate) fn nudge_host() {
    #[cfg(windows)]
    probe::reload_dictionaries();
}
