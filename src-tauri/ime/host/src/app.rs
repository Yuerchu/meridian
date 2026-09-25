//! Wiring: arguments, data directory, engine, threads, the message loop.

use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use meridian_ime_config::{HostConfig, ImeDirs};
use meridian_ime_host::data::{
    Change, SharedScorer, Watch, build_engine, input_scheme, load_config, load_hints, load_scorer, open_learner,
};
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
    meridian_ime_host::logging::init(&dirs.log_file(), config.debug_log);
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
    let mut scorer = load_scorer(&dirs, meridian_ime_lm::Platform::Desktop);
    let (engine, names) = build_engine(&dirs, learner.as_ref(), scorer.as_ref());
    let mut router = Router::new(engine, learner, router_config(&config));
    router.set_hints(load_hints(&dirs));
    router.set_status_info(dirs.root.to_string_lossy().into_owned(), names);

    let (work_tx, work_rx) = mpsc::channel::<Work>();
    let ui = UiHandle::start();
    spawn_acceptor(listener, work_tx.clone());

    let code = serve(&dirs, &mut router, &mut scorer, work_rx, &ui);
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
fn serve(
    dirs: &ImeDirs,
    router: &mut Router,
    scorer: &mut Option<SharedScorer>,
    work_rx: Receiver<Work>,
    ui: &UiHandle,
) -> i32 {
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
                    reload_dictionaries(dirs, router, scorer.as_ref());
                }
                if router.take_user_words_dirty() {
                    reload_dictionaries(dirs, router, scorer.as_ref());
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
                Change::Dictionaries => reload_dictionaries(dirs, router, scorer.as_ref()),
                Change::Context => {
                    router.set_hints(load_hints(dirs));
                    tracing::info!("memory hints reloaded");
                }
                Change::Models => {
                    *scorer = load_scorer(dirs, meridian_ime_lm::Platform::Desktop);
                    reload_dictionaries(dirs, router, scorer.as_ref());
                }
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

fn router_config(c: &HostConfig) -> RouterConfig {
    RouterConfig {
        scheme: input_scheme(c.scheme),
        page_size: c.page_size as usize,
        full_width_punctuation: matches!(c.punctuation, meridian_ime_config::Punctuation::FullWidth),
        learning: c.learning,
        private_apps: c.private_apps.clone(),
        context_apps: c.context_apps.clone(),
    }
}

fn reload_dictionaries(dirs: &ImeDirs, router: &mut Router, scorer: Option<&SharedScorer>) {
    let (engine, names) = build_engine(dirs, router.learner(), scorer);
    router.replace_engine(engine);
    router.set_status_info(dirs.root.to_string_lossy().into_owned(), names);
    tracing::info!("dictionaries reloaded");
}
