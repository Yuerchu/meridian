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
//! the CLI runs. Windows only, like everything under `ime/`.

pub(crate) mod dictionary;
pub(crate) mod host_process;
pub(crate) mod probe;
pub(crate) mod registry;

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
    pub host_exe: Option<PathBuf>,
    /// The 64-bit DLL, if it was found at startup.
    pub dll_x64: Option<PathBuf>,
    /// The 32-bit DLL, if shipped.
    pub dll_x86: Option<PathBuf>,
}

impl ImeBridge {
    /// Resolves the data directory (Meridian's own, plus `ime`) and looks for
    /// the artifacts beside the app: `resources/ime/` in an installed build,
    /// the cargo target directory in development.
    pub fn locate(services: &Services, app: &tauri::AppHandle) -> Self {
        let dirs = ImeDirs::new(services.paths.data_dir.join(meridian_ime_config::IME_DIR_NAME));
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
pub struct AppIme(pub Arc<Mutex<ImeBridge>>);

/// Locates everything, makes sure the data directory exists with a default
/// `host.json`, and starts the host if the DLL is registered and nothing is
/// serving the pipe yet. Meridian closing does not stop it: the host belongs
/// to the login session, not to this window.
pub(crate) async fn maybe_start(services: Services, app: tauri::AppHandle) -> AppIme {
    let bridge = ImeBridge::locate(&services, &app);
    if let Err(e) = bridge.dirs.ensure() {
        tracing::warn!(error = %e, dir = %bridge.dirs.root.display(), "cannot create the input method's data directory");
    } else if !bridge.dirs.config_file().exists()
        && let Err(e) = meridian_ime_config::save(&bridge.dirs.root, &meridian_ime_config::HostConfig::default())
    {
        tracing::warn!(error = %e, "cannot write the default host.json");
    }
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
    AppIme(Arc::new(Mutex::new(bridge)))
}
