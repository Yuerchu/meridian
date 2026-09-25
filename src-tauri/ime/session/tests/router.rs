//! The router: many sessions, one focus, one protocol version.

use std::sync::Arc;

use meridian_ime_dict::{DictFile, DictSet, DictWriter, Metadata, SyllableTable};
use meridian_ime_engine::{Engine, MemoryLearner};
use meridian_ime_proto::{
    ClientKind, ClientMessage, ErrorCode, KeyEvent, Modifiers, PROTOCOL_VERSION, Profile, Rect, Scheme, ServerMessage,
};
use meridian_ime_session::{Router, RouterConfig, SessionKey};

fn router() -> (tempfile::TempDir, Router) {
    let dir = tempfile::tempdir().unwrap();
    let mut w = DictWriter::new();
    w.add("ni", "你", 100);
    w.add("ni hao", "你好", 100);
    let meta = Metadata {
        name: "t".into(),
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
    let path = dir.path().join("t.mdict");
    w.write(&path, &meta, &SyllableTable::new()).unwrap();
    let mut set = DictSet::new();
    set.add_file(DictFile::open(&path).unwrap());
    let engine = Arc::new(Engine::new(Arc::new(set)));
    let router = Router::new(engine, Box::new(MemoryLearner::new()), RouterConfig::default());
    (dir, router)
}

fn hello(session_id: u64, kind: ClientKind, app: Option<&str>) -> ClientMessage {
    ClientMessage::Hello {
        version: PROTOCOL_VERSION,
        kind,
        session_id,
        profile: Profile::PinyinSimplified,
        app_name: app.map(str::to_string),
        pid: 1,
    }
}

fn key(session_id: u64, ch: char) -> ClientMessage {
    let vk = (ch as u8 - b'a' + 0x41) as u32;
    ClientMessage::Key {
        session_id,
        event: KeyEvent {
            vk,
            ch: Some(ch),
            mods: Modifiers::default(),
            caps_lock: false,
        },
        surrounding: None,
    }
}

#[test]
fn hello_with_the_wrong_version_is_refused() {
    let (_d, mut r) = router();
    let reply = r.handle(
        1,
        ClientMessage::Hello {
            version: PROTOCOL_VERSION + 1,
            kind: ClientKind::Ime,
            session_id: 1,
            profile: Profile::PinyinSimplified,
            app_name: None,
            pid: 1,
        },
    );
    assert!(matches!(
        reply,
        ServerMessage::Error {
            code: ErrorCode::VersionMismatch,
            ..
        }
    ));
    assert_eq!(r.session_count(), 0);
    // A key on a session that never said hello is an error, not a panic.
    assert!(matches!(
        r.handle(1, key(1, 'n')),
        ServerMessage::Error {
            code: ErrorCode::UnknownSession,
            ..
        }
    ));
}

#[test]
fn welcome_carries_the_settings_and_the_profile_picks_the_scheme() {
    let (_d, mut r) = router();
    match r.handle(1, hello(1, ClientKind::Ime, None)) {
        ServerMessage::Welcome { settings, .. } => {
            assert_eq!(settings.scheme, Scheme::Pinyin);
            assert_eq!(settings.page_size, 5);
        }
        other => panic!("{other:?}"),
    }
    let zhuyin = ClientMessage::Hello {
        version: PROTOCOL_VERSION,
        kind: ClientKind::Ime,
        session_id: 2,
        profile: Profile::ZhuyinTraditional,
        app_name: None,
        pid: 1,
    };
    match r.handle(2, zhuyin) {
        ServerMessage::Welcome { settings, .. } => assert_eq!(settings.scheme, Scheme::Zhuyin),
        other => panic!("{other:?}"),
    }
}

#[test]
fn two_connections_with_the_same_session_id_do_not_share_a_buffer() {
    let (_d, mut r) = router();
    r.handle(1, hello(7, ClientKind::Ime, None));
    r.handle(2, hello(7, ClientKind::Ime, None));
    r.handle(1, key(7, 'n'));
    r.handle(1, key(7, 'i'));
    match r.handle(2, key(7, 'n')) {
        ServerMessage::KeyResult { frame, .. } => {
            assert_eq!(frame.preedit_text(), "n", "the second connection starts from nothing");
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(r.session_count(), 2);
}

#[test]
fn focus_moving_to_another_session_resets_the_old_composition() {
    let (_d, mut r) = router();
    r.handle(1, hello(1, ClientKind::Ime, None));
    r.handle(2, hello(1, ClientKind::Ime, None));
    r.handle(1, key(1, 'n'));
    assert_eq!(r.focused(), Some(SessionKey { conn: 1, session_id: 1 }));
    assert!(r.focused_frame().is_some_and(|(f, _)| !f.is_empty()));
    r.handle(2, key(1, 'n'));
    assert_eq!(r.focused(), Some(SessionKey { conn: 2, session_id: 1 }));
    // Back on the first: its buffer was dropped when focus left.
    match r.handle(1, key(1, 'i')) {
        ServerMessage::KeyResult { frame, .. } => assert_eq!(frame.preedit_text(), "i"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn layout_and_focus_are_kept_per_session_and_disconnect_clears_them() {
    let (_d, mut r) = router();
    r.handle(1, hello(1, ClientKind::Ime, Some("notepad.exe")));
    r.handle(1, key(1, 'n'));
    let rect = Rect {
        left: 1,
        top: 2,
        right: 3,
        bottom: 4,
    };
    assert!(matches!(
        r.handle(1, ClientMessage::Layout { session_id: 1, rect }),
        ServerMessage::Ack
    ));
    assert_eq!(r.focused_frame().and_then(|(_, r)| r), Some(rect));
    assert!(matches!(
        r.handle(
            1,
            ClientMessage::Focus {
                session_id: 1,
                private: true
            }
        ),
        ServerMessage::Ack
    ));
    // Private: the composition was reset and learning is off for the session.
    assert!(r.focused_frame().is_some_and(|(f, _)| f.is_empty()));
    r.on_disconnect(1);
    assert_eq!(r.session_count(), 0);
    assert!(r.focused().is_none());
    assert!(matches!(
        r.handle(1, key(1, 'n')),
        ServerMessage::Error {
            code: ErrorCode::UnknownSession,
            ..
        }
    ));
}

#[test]
fn private_apps_from_the_config_mute_learning() {
    let (_d, mut r) = router();
    r.set_config(RouterConfig {
        private_apps: vec!["keepass.exe".into()],
        ..Default::default()
    });
    r.handle(1, hello(1, ClientKind::Ime, Some("KeePass.exe")));
    r.handle(1, key(1, 'n'));
    r.handle(1, key(1, 'i'));
    let space = ClientMessage::Key {
        session_id: 1,
        event: KeyEvent {
            vk: 0x20,
            ch: Some(' '),
            mods: Modifiers::default(),
            caps_lock: false,
        },
        surrounding: None,
    };
    match r.handle(1, space) {
        ServerMessage::KeyResult { commit, .. } => assert_eq!(commit.as_deref(), Some("你")),
        other => panic!("{other:?}"),
    }
    assert_eq!(r.learner().weight("你"), 0, "nothing learned in a private app");
}

#[test]
fn only_a_control_client_may_shut_down() {
    let (_d, mut r) = router();
    r.handle(1, hello(1, ClientKind::Ime, None));
    assert!(matches!(
        r.handle(1, ClientMessage::Shutdown),
        ServerMessage::Error {
            code: ErrorCode::NotPermitted,
            ..
        }
    ));
    r.handle(2, hello(0, ClientKind::Control, None));
    assert!(r.is_control(2));
    assert_eq!(r.session_count(), 1, "a control client opens no session");
    assert!(matches!(r.handle(2, ClientMessage::Shutdown), ServerMessage::Ack));
    assert!(matches!(r.status(), ServerMessage::Status { sessions: 1, .. }));
}

/// Remembers the hints of the last query.
#[derive(Default)]
struct HintListener(std::sync::Mutex<Vec<String>>);

impl meridian_ime_engine::SentenceScorer for HintListener {
    fn score(&self, req: &meridian_ime_engine::ScoreRequest<'_>) -> Vec<f64> {
        *self.0.lock().unwrap() = req.hints.to_vec();
        Vec::new()
    }
}

fn listening_router() -> (tempfile::TempDir, Router, Arc<HintListener>) {
    let (dir, r) = router();
    let listener = Arc::new(HintListener::default());
    let set = DictSet::new();
    let mut set = set;
    set.add_file(DictFile::open(&dir.path().join("t.mdict")).unwrap());
    let engine = Arc::new(Engine::new(Arc::new(set)).with_scorer(Box::new(listener.clone())));
    let mut r = r;
    r.replace_engine(engine);
    (dir, r, listener)
}

fn heard(l: &HintListener) -> Vec<String> {
    l.0.lock().unwrap().clone()
}

#[test]
fn memory_hints_reach_meridian_and_opted_in_apps_only() {
    let (_d, mut r, l) = listening_router();
    r.set_hints(vec!["子午线".into()]);
    r.handle(1, hello(1, ClientKind::Ime, Some("Meridian.exe")));
    r.handle(1, key(1, 'n'));
    assert_eq!(heard(&l), vec!["子午线"], "Meridian's own window");

    r.handle(2, hello(1, ClientKind::Ime, Some("notepad.exe")));
    r.handle(2, key(1, 'n'));
    assert!(heard(&l).is_empty(), "another application gets none");

    r.handle(3, hello(1, ClientKind::Ime, None));
    r.handle(3, key(1, 'n'));
    assert!(
        heard(&l).is_empty(),
        "an application that does not say which it is gets none"
    );

    // Opting notepad in reaches the session already open there…
    r.set_config(RouterConfig {
        context_apps: vec!["notepad.exe".into()],
        ..Default::default()
    });
    r.handle(2, key(1, 'n'));
    assert_eq!(heard(&l), vec!["子午线"]);
    // …and opting it out takes them away again.
    r.set_config(RouterConfig::default());
    r.handle(2, key(1, 'n'));
    assert!(heard(&l).is_empty());
}

#[test]
fn a_private_app_gets_no_hints_even_when_opted_in() {
    let (_d, mut r, l) = listening_router();
    r.set_config(RouterConfig {
        private_apps: vec!["keepass.exe".into()],
        context_apps: vec!["keepass.exe".into()],
        ..Default::default()
    });
    r.set_hints(vec!["子午线".into()]);
    r.handle(1, hello(1, ClientKind::Ime, Some("KeePass.exe")));
    r.handle(1, key(1, 'n'));
    assert!(heard(&l).is_empty());
}
