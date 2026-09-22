//! Golden key sequences through the session state machine, against a small
//! dictionary written for the test.

use std::sync::Arc;

use meridian_ime_dict::{DictFile, DictSet, DictWriter, Metadata, SyllableTable};
use meridian_ime_engine::{Context, Engine, InputScheme, Learner, MemoryLearner};
use meridian_ime_session::{KeyOutcome, Session, SessionConfig, parse_script};

fn dictionary(dir: &std::path::Path) -> DictSet {
    let rows: &[(&str, &str, u32)] = &[
        ("ni", "你", 9000),
        ("ni", "尼", 500),
        ("ni", "泥", 400),
        ("ni", "逆", 300),
        ("ni", "妮", 200),
        ("ni", "倪", 100),
        ("ni", "拟", 90),
        ("hao", "好", 8000),
        ("hao", "号", 900),
        ("hao", "豪", 300),
        ("ma", "吗", 5000),
        ("ma", "妈", 3000),
        ("ma", "马", 2000),
        ("ni hao", "你好", 9500),
        ("ni hao", "拟好", 5),
        ("ni hao ma", "你好吗", 800),
        ("wo", "我", 9800),
        ("xiang", "想", 6000),
        ("xiang", "香", 2000),
        ("qu", "去", 7000),
        ("chi", "吃", 6000),
        ("fan", "饭", 5000),
        ("chi fan", "吃饭", 6000),
        ("wo xiang", "我想", 3000),
        ("de", "的", 20000),
        ("de", "得", 9000),
        ("de", "地", 8000),
        ("de", "德", 800),
        ("de", "锝", 10),
        ("de", "嘚", 9),
        ("de", "徳", 8),
        ("da", "大", 9000),
        ("da jia", "大家", 7000),
        ("jia", "家", 6000),
        ("mei guo", "美国", 7000),
        ("mei guo shi", "美国式", 30),
        ("mei", "美", 5000),
        ("guo", "国", 5000),
        ("shi", "是", 9000),
        ("shi", "式", 400),
    ];
    let mut w = DictWriter::new();
    for (c, t, f) in rows {
        w.add(c, t, *f);
    }
    let meta = Metadata {
        name: "golden".into(),
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
    let path = dir.join("golden.mdict");
    w.write(&path, &meta, &SyllableTable::new()).unwrap();
    let mut set = DictSet::new();
    set.add_file(DictFile::open(&path).unwrap());
    set
}

struct Rig {
    _dir: tempfile::TempDir,
    engine: Arc<Engine>,
    session: Session,
    learner: MemoryLearner,
}

impl Rig {
    fn new(scheme: InputScheme) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let set = dictionary(dir.path());
        let engine = Arc::new(Engine::new(Arc::new(set)));
        let session = Session::new(SessionConfig {
            scheme,
            page_size: 5,
            ..Default::default()
        });
        Self {
            _dir: dir,
            engine,
            session,
            learner: MemoryLearner::new(),
        }
    }

    /// Runs a script; returns the concatenated commits and the last outcome.
    fn run(&mut self, script: &str) -> (String, KeyOutcome) {
        let mut committed = String::new();
        let mut last = None;
        for ev in parse_script(script).unwrap() {
            let out = self.session.handle_key(&self.engine, &mut self.learner, ev);
            if let Some(c) = &out.commit {
                committed.push_str(c);
            }
            last = Some(out);
        }
        (committed, last.expect("script has at least one key"))
    }

    fn candidates(&self, out: &KeyOutcome) -> Vec<String> {
        out.frame.candidates.iter().map(|c| c.text.clone()).collect()
    }
}

#[test]
fn space_commits_the_highlighted_candidate() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (committed, out) = r.run("nihao<space>");
    assert_eq!(committed, "你好");
    assert!(out.consumed);
    assert!(out.frame.is_empty());
    assert_eq!(r.learner.weight("你好"), 1);
    assert_eq!(r.learner.choice_weight("nihao", "你好"), 1);
}

#[test]
fn partial_selection_keeps_the_rest_composing() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (committed, out) = r.run("nihaoma");
    assert!(committed.is_empty());
    let cands = r.candidates(&out);
    assert_eq!(cands[0], "你好吗");
    // Pick 你好 (a shorter candidate) by number.
    let idx = cands
        .iter()
        .position(|c| c == "你好")
        .expect("你好 is on the first page")
        + 1;
    let (committed, out) = r.run(&idx.to_string());
    assert!(committed.is_empty(), "nothing reaches the document yet");
    assert_eq!(out.frame.preedit_text(), "你好ma");
    assert_eq!(r.candidates(&out)[0], "吗");
    let (committed, out) = r.run("<space>");
    assert_eq!(committed, "你好吗");
    assert!(out.frame.is_empty());
    assert_eq!(
        r.learner.choice_weight("nihaoma", "你好吗"),
        1,
        "the whole buffer is remembered"
    );
}

#[test]
fn enter_commits_raw_pinyin_without_learning() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (committed, _) = r.run("nihao<enter>");
    assert_eq!(committed, "nihao");
    assert_eq!(r.learner.weight("你好"), 0);
}

#[test]
fn initials_produce_candidates_from_the_second_key() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (_, out) = r.run("n");
    assert!(!out.frame.candidates.is_empty(), "first key already offers something");
    let (_, out) = r.run("h");
    assert!(r.candidates(&out).contains(&"你好".to_string()));
}

#[test]
fn punctuation_commits_then_maps_to_full_width() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (committed, out) = r.run("nihao,");
    assert_eq!(committed, "你好，");
    assert!(out.consumed);
    let (committed, out) = r.run(".");
    assert_eq!(committed, "。");
    assert!(out.consumed);
}

#[test]
fn decimal_point_after_a_digit_passes_through() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (committed, out) = r.run("3.");
    assert_eq!(committed, "");
    assert!(!out.consumed, "3. is a decimal point");
}

#[test]
fn shift_toggles_english_and_commits_raw() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (committed, out) = r.run("<shift>abc");
    assert_eq!(committed, "");
    assert!(!out.consumed, "English mode passes letters through");
    let (_, out) = r.run("<shift>");
    assert!(out.consumed);
    let (committed, out) = r.run("ni<shift>");
    assert_eq!(committed, "ni", "a half-typed buffer goes out as typed");
    assert!(out.consumed);
    let (_, out) = r.run("x");
    assert!(!out.consumed);
}

#[test]
fn caps_lock_passes_letters_through() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (_, out) = r.run("<caps>ni");
    assert!(!out.consumed);
    assert!(out.frame.is_empty());
}

#[test]
fn paging_and_highlight() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (_, first) = r.run("de");
    assert_eq!(first.frame.page, 0);
    assert!(first.frame.page_count >= 2, "7 readings of de over pages of 5");
    let (_, second) = r.run("<pgdn>");
    assert_eq!(second.frame.page, 1);
    let sixth = r.candidates(&second)[0].clone();
    let (committed, _) = r.run("1");
    assert_eq!(committed, sixth, "1 on the second page is the sixth candidate");
    let (_, out) = r.run("de<down><down>");
    assert_eq!(out.frame.highlight, 2);
    let third = r.candidates(&out)[2].clone();
    let (committed, _) = r.run("<space>");
    assert_eq!(committed, third, "space commits the highlighted one, not the first");
    let (_, out) = r.run("de=");
    assert_eq!(out.frame.page, 1);
    let (_, out) = r.run("-");
    assert_eq!(out.frame.page, 0);
    r.run("<esc>");
}

#[test]
fn backspace_and_escape() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (_, out) = r.run("nih<bs>");
    assert_eq!(out.frame.preedit_text(), "ni");
    let (_, out) = r.run("<bs><bs>");
    assert!(out.frame.is_empty());
    assert!(out.consumed);
    let (_, out) = r.run("<bs>");
    assert!(!out.consumed, "backspace with nothing composed goes to the application");
    let (_, out) = r.run("nihao<esc>");
    assert!(out.frame.is_empty());
    assert!(out.consumed);
}

#[test]
fn control_chords_pass_through_and_keep_the_buffer() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("ni");
    let mut ev = meridian_ime_session::keys::printable('c');
    ev.mods.ctrl = true;
    let out = r.session.handle_key(&r.engine, &mut r.learner, ev);
    assert!(!out.consumed);
    assert!(r.session.is_composing());
}

#[test]
fn private_sessions_do_not_learn() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.session.set_private(true);
    let (committed, _) = r.run("nihao<space>");
    assert_eq!(committed, "你好");
    assert_eq!(r.learner.weight("你好"), 0);
    assert_eq!(r.learner.choice_weight("nihao", "你好"), 0);
}

#[test]
fn a_previous_choice_comes_first() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (_, out) = r.run("nihao");
    let cands = r.candidates(&out);
    let idx = cands.iter().position(|c| c == "拟好").expect("拟好 on page one") + 1;
    let (committed, _) = r.run(&idx.to_string());
    assert_eq!(committed, "拟好");
    let (_, out) = r.run("nihao");
    assert_eq!(r.candidates(&out)[0], "拟好", "chosen once, first next time");
    r.run("<esc>");
}

#[test]
fn undo_reverts_counts_after_erase_and_retype() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (_, out) = r.run("nihao");
    let cands = r.candidates(&out);
    let idx = cands.iter().position(|c| c == "拟好").unwrap() + 1;
    r.run(&idx.to_string());
    assert_eq!(r.learner.weight("拟好"), 1);
    assert_eq!(r.learner.choice_weight("nihao", "拟好"), 1);
    // Delete the two characters and type the same keys, choosing 你好 instead.
    let (_, out) = r.run("<bs><bs>");
    assert!(!out.consumed);
    let (_, out) = r.run("nihao");
    let cands = r.candidates(&out);
    let idx = cands.iter().position(|c| c == "你好").unwrap() + 1;
    r.run(&idx.to_string());
    assert_eq!(r.learner.weight("拟好"), 0, "the mistaken lesson is taken back");
    assert_eq!(r.learner.choice_weight("nihao", "拟好"), 0);
    assert_eq!(r.learner.weight("你好"), 1);
}

#[test]
fn same_word_retype_only_drops_the_record() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("nihao<space>");
    r.run("<bs><bs>");
    r.run("nihao<space>");
    assert_eq!(r.learner.weight("你好"), 2);
}

#[test]
fn transitions_are_recorded_along_a_chain() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("wo<space>xiang<space>");
    assert_eq!(
        r.learner.ngram().bigram_count("我", "想"),
        2,
        "an explicit choice counts twice"
    );
    assert!(r.learner.ngram().bigram_count("<s>", "我") >= 1);
    r.run(",");
    r.run("qu<space>");
    assert_eq!(
        r.learner.ngram().bigram_count("想", "去"),
        0,
        "punctuation breaks the chain"
    );
    let _ = Context::start();
}

#[test]
fn auto_word_after_two_same_buffer_selections() {
    let mut r = Rig::new(InputScheme::Pinyin);
    for _ in 0..2 {
        // 美国式 typed as 美国 + 式 twice becomes a user word only if it is not
        // already in the dictionary; use a pair that is not: 大家 + 好.
        let (_, out) = r.run("dajiahao");
        let cands = r.candidates(&out);
        let idx = cands.iter().position(|c| c == "大家").expect("大家 offered") + 1;
        r.run(&idx.to_string());
        r.run("<space>");
    }
    let words = r.learner.user_words();
    assert!(
        words.iter().any(|w| w.text == "大家好" && w.code == "da jia hao"),
        "{words:?}"
    );
    assert_eq!(r.learner.choice_weight("dajiahao", "大家好"), 2);
}

#[test]
fn no_dictionary_shows_a_notice() {
    let dir = tempfile::tempdir().unwrap();
    let _ = dir;
    let engine = Arc::new(Engine::new(Arc::new(DictSet::new())));
    let mut session = Session::new(SessionConfig::default());
    let mut learner = MemoryLearner::new();
    let ev = meridian_ime_session::keys::printable('n');
    let out = session.handle_key(&engine, &mut learner, ev);
    assert!(out.consumed);
    assert!(out.frame.notice.is_some());
    let ev = meridian_ime_session::keys::function(meridian_ime_session::keys::VK_RETURN);
    let out = session.handle_key(&engine, &mut learner, ev);
    assert_eq!(out.commit.as_deref(), Some("n"));
}

#[test]
fn zhuyin_keys_compose_and_enter_commits() {
    let mut r = Rig::new(InputScheme::Zhuyin);
    // ㄋㄧˇ ㄏㄠˇ on the standard layout: s u 3 c l 3
    let (_, out) = r.run("su3cl3");
    assert_eq!(out.frame.preedit_text(), "ㄋㄧˇ ㄏㄠˇ");
    assert_eq!(r.candidates(&out)[0], "你好");
    let (committed, out) = r.run("<enter>");
    assert_eq!(committed, "你好");
    assert!(out.frame.is_empty());
    // Space after a syllable without a tone is the first tone, not a commit.
    let (committed, out) = r.run("su<space>");
    assert_eq!(committed, "");
    assert!(out.consumed);
    assert!(r.session.is_composing());
    let (committed, _) = r.run("<space>");
    assert_eq!(committed, "你", "a second space commits");
    // Digits are keys, not selections.
    let (_, out) = r.run("1");
    assert!(r.session.is_composing());
    assert_eq!(out.frame.preedit_text(), "ㄅ");
    r.run("<esc>");
}
