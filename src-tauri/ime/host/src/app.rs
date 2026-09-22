//! Wiring: arguments, data directory, engine, threads, the message loop.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant, SystemTime};

use meridian_ime_config::{HostConfig, ImeDirs, Scheme};
use meridian_ime_dict::{Catalog, DictSet};
use meridian_ime_engine::{Engine, FileLearner, InputScheme, Learner, MemoryLearner};
use meridian_ime_proto::{ClientKind, ClientMessage, ServerMessage, pipe_name};
use meridian_ime_session::{Router, RouterConfig};

use crate::ipc::{PipeListener, session_id};
use crate::ui::UiHandle;

const USAGE: &str = "meridian-ime-host [--data-dir <dir>] [--pipe-name <name>]";
/// How often the idle loop wakes to look at the config file and flush.
const TICK: Duration = Duration::from_secs(1);

/// Something a connection thread wants the router to do.
enum Work {
    Message {
        conn: u64,
        msg: ClientMessage,
        reply: Sender<ServerMessage>,
    },
    Gone {
        conn: u64,
    },
}

pub fn run(args: Vec<String>) -> i32 {
    let mut data_dir: Option<PathBuf> = None;
    let mut pipe: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--data-dir" => {
                data_dir = args.get(i + 1).map(PathBuf::from);
                i += 2;
            }
            "--pipe-name" => {
                pipe = args.get(i + 1).cloned();
                i += 2;
            }
            "-h" | "--help" => {
                println!("{USAGE}");
                return 0;
            }
            other => {
                eprintln!("unknown argument {other:?}\n{USAGE}");
                return 2;
            }
        }
    }
    let Some(root) = data_dir.or_else(meridian_ime_config::default_ime_dir) else {
        eprintln!("no data directory; pass --data-dir");
        return 2;
    };
    let dirs = ImeDirs::new(root);
    if let Err(e) = dirs.ensure() {
        eprintln!("cannot create {}: {e}", dirs.root.display());
        return 1;
    }
    let config = load_config(&dirs);
    crate::logging::init(&dirs.log_file(), config.debug_log);
    tracing::info!(version = env!("CARGO_PKG_VERSION"), data_dir = %dirs.root.display(), "starting");

    crate::ui::set_process_dpi_awareness();

    let pipe = pipe.unwrap_or_else(|| pipe_name(session_id::current()));
    let listener = match PipeListener::bind(&pipe) {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(error = %e, "cannot listen");
            eprintln!("{e}");
            return 3;
        }
    };
    tracing::info!(pipe = %pipe, "listening");

    let learner = open_learner(&dirs);
    let (engine, names) = build_engine(&dirs, learner.as_ref());
    let mut router = Router::new(engine, learner, router_config(&config));
    router.set_status_info(dirs.root.to_string_lossy().into_owned(), names);

    let (work_tx, work_rx) = mpsc::channel::<Work>();
    let ui = UiHandle::start();
    spawn_acceptor(listener, work_tx.clone());

    let code = serve(&dirs, &mut router, work_rx, &ui);
    router.flush();
    ui.quit();
    tracing::info!("stopped");
    code
}

fn spawn_acceptor(mut listener: PipeListener, work_tx: Sender<Work>) {
    std::thread::Builder::new()
        .name("accept".into())
        .spawn(move || {
            let mut next_conn: u64 = 1;
            loop {
                match listener.accept() {
                    Ok(file) => {
                        let conn = next_conn;
                        next_conn += 1;
                        let tx = work_tx.clone();
                        if std::thread::Builder::new()
                            .name(format!("conn-{conn}"))
                            .spawn(move || connection_loop(conn, file, tx))
                            .is_err()
                        {
                            tracing::warn!(conn, "cannot spawn a connection thread");
                        }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "accept failed");
                        std::thread::sleep(Duration::from_millis(200));
                    }
                }
            }
        })
        .expect("spawn accept thread");
}

fn connection_loop(conn: u64, mut file: std::fs::File, tx: Sender<Work>) {
    tracing::debug!(conn, "connected");
    loop {
        let msg: Option<ClientMessage> = match meridian_ime_proto::read_message(&mut file) {
            Ok(m) => m,
            Err(e) => {
                tracing::debug!(conn, error = %e, "read failed");
                None
            }
        };
        let Some(msg) = msg else { break };
        let (reply_tx, reply_rx) = mpsc::channel();
        if tx
            .send(Work::Message {
                conn,
                msg,
                reply: reply_tx,
            })
            .is_err()
        {
            break;
        }
        let Ok(reply) = reply_rx.recv() else { break };
        if let Err(e) = meridian_ime_proto::write_message(&mut file, &reply) {
            tracing::debug!(conn, error = %e, "write failed");
            break;
        }
    }
    let _ = tx.send(Work::Gone { conn });
    tracing::debug!(conn, "disconnected");
}

/// The main loop: answer work, and between messages watch the data directory.
fn serve(dirs: &ImeDirs, router: &mut Router, work_rx: Receiver<Work>, ui: &UiHandle) -> i32 {
    let mut watch = Watch::new(dirs);
    let mut last_tick = Instant::now();
    loop {
        match work_rx.recv_timeout(TICK) {
            Ok(Work::Message { conn, msg, reply }) => {
                let is_control_hello = matches!(
                    &msg,
                    ClientMessage::Hello {
                        kind: ClientKind::Control,
                        ..
                    }
                );
                let reload = matches!(&msg, ClientMessage::ReloadDictionaries);
                let shutdown = matches!(&msg, ClientMessage::Shutdown);
                let mut answer = router.handle(conn, msg);
                if is_control_hello && !matches!(answer, ServerMessage::Error { .. }) {
                    answer = router.status();
                }
                let permitted_shutdown = shutdown && matches!(answer, ServerMessage::Ack);
                let _ = reply.send(answer);
                if reload {
                    reload_dictionaries(dirs, router);
                }
                if router.take_user_words_dirty() {
                    reload_dictionaries(dirs, router);
                }
                show(router, ui);
                if permitted_shutdown {
                    tracing::info!("shutdown requested by a control client");
                    return 0;
                }
            }
            Ok(Work::Gone { conn }) => {
                router.on_disconnect(conn);
                show(router, ui);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return 0,
        }
        let now = Instant::now();
        if now.duration_since(last_tick) >= TICK {
            last_tick = now;
            router.tick(now);
            match watch.poll(dirs) {
                Change::None => {}
                Change::Config => {
                    let config = load_config(dirs);
                    router.set_config(router_config(&config));
                    tracing::info!("configuration reloaded");
                }
                Change::Dictionaries => reload_dictionaries(dirs, router),
            }
        }
        if ui.wants_quit() {
            return 0;
        }
    }
}

fn show(router: &Router, ui: &UiHandle) {
    match router.focused_frame() {
        Some((frame, rect)) if !frame.is_empty() => ui.show(frame, rect),
        _ => ui.hide(),
    }
}

fn load_config(dirs: &ImeDirs) -> HostConfig {
    match meridian_ime_config::load(&dirs.root) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "host.json unreadable; using defaults");
            HostConfig::default()
        }
    }
}

fn router_config(c: &HostConfig) -> RouterConfig {
    RouterConfig {
        scheme: match c.scheme {
            Scheme::Pinyin => InputScheme::Pinyin,
            Scheme::Zhuyin => InputScheme::Zhuyin,
        },
        page_size: c.page_size as usize,
        full_width_punctuation: matches!(c.punctuation, meridian_ime_config::Punctuation::FullWidth),
        learning: c.learning,
        private_apps: c.private_apps.clone(),
    }
}

fn open_learner(dirs: &ImeDirs) -> Box<dyn Learner> {
    match FileLearner::open(&dirs.learn()) {
        Ok(l) => Box::new(l),
        Err(e) => {
            tracing::warn!(error = %e, dir = %dirs.learn().display(), "learning store unusable; learning in memory only");
            Box::new(MemoryLearner::new())
        }
    }
}

fn build_engine(dirs: &ImeDirs, learner: &dyn Learner) -> (Arc<Engine>, Vec<String>) {
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
    tracing::info!(dictionaries = names.len(), user_words = words.len(), "engine ready");
    (Arc::new(Engine::new(Arc::new(set))), names)
}

fn reload_dictionaries(dirs: &ImeDirs, router: &mut Router) {
    let (engine, names) = build_engine(dirs, router.learner());
    router.replace_engine(engine);
    router.set_status_info(dirs.root.to_string_lossy().into_owned(), names);
    tracing::info!("dictionaries reloaded");
}

enum Change {
    None,
    Config,
    Dictionaries,
}

/// Modification times of what the host reads, polled once a second.
struct Watch {
    config_mtime: Option<SystemTime>,
    dicts_snapshot: Vec<(String, Option<SystemTime>, u64)>,
}

impl Watch {
    fn new(dirs: &ImeDirs) -> Self {
        Self {
            config_mtime: mtime(&dirs.config_file()),
            dicts_snapshot: snapshot(dirs),
        }
    }

    fn poll(&mut self, dirs: &ImeDirs) -> Change {
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
        Change::None
    }
}

fn mtime(path: &std::path::Path) -> Option<SystemTime> {
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
