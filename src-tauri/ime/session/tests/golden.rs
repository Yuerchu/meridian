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
        // For the grid's fuzzy keys: z w ng reads both, r e ng reads both.
        ("zhong", "中", 8000),
        ("zong", "总", 900),
        ("zhong guo", "中国", 8000),
        ("ren", "人", 9000),
        ("reng", "扔", 100),
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
    assert!(out.frame.preedit.is_empty());
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
fn dictionaries_waiting_for_an_upgrade_say_so_instead() {
    let engine = Engine::new(Arc::new(DictSet::new())).with_outdated(1);
    let mut session = Session::new(SessionConfig::default());
    let out = session.handle_key(
        &engine,
        &mut MemoryLearner::new(),
        meridian_ime_session::keys::printable('n'),
    );
    assert_eq!(
        out.frame.notice.as_deref(),
        Some(meridian_ime_session::DICTIONARY_UPGRADE_NOTICE),
        "not \"import a dictionary\": there is one, in an older format"
    );
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
    assert_eq!(
        out.frame.notice.as_deref(),
        Some(meridian_ime_session::NO_DICTIONARY_NOTICE)
    );
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
    assert!(out.frame.preedit.is_empty());
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

// ── grid ────────────────────────────────────────────────────────────────

fn has_private_use(s: &str) -> bool {
    s.chars().any(|c| ('\u{E000}'..='\u{F8FF}').contains(&c))
}

#[test]
fn grid_tokens_compose_and_space_commits() {
    let mut r = Rig::new(InputScheme::Grid);
    let (_, out) = r.run("ny<t3>h<ao><t3>");
    assert_eq!(out.frame.preedit_text(), "nyˇ haoˇ");
    assert_eq!(r.candidates(&out)[0], "你好");
    let (committed, out) = r.run("<space>");
    assert_eq!(committed, "你好");
    assert!(out.frame.preedit.is_empty());
    assert_eq!(r.learner.weight("你好"), 1);
}

#[test]
fn grid_tones_are_optional() {
    let mut r = Rig::new(InputScheme::Grid);
    let (_, out) = r.run("nyh<ao>");
    assert_eq!(out.frame.preedit_text(), "ny hao");
    assert_eq!(r.candidates(&out)[0], "你好");
}

#[test]
fn grid_fuzzy_initial_and_nasal_tail() {
    let mut r = Rig::new(InputScheme::Grid);
    let (_, out) = r.run("zw<ng>");
    let cands = r.candidates(&out);
    assert!(
        cands.contains(&"中".to_string()) && cands.contains(&"总".to_string()),
        "{cands:?}"
    );
    r.run("<esc>");
    let (_, out) = r.run("re<ng>");
    let cands = r.candidates(&out);
    assert!(
        cands.contains(&"人".to_string()) && cands.contains(&"扔".to_string()),
        "{cands:?}"
    );
    r.run("<esc>");
    let (_, out) = r.run("zw<ng>gwo");
    assert_eq!(r.candidates(&out)[0], "中国");
}

#[test]
fn grid_tone_key_never_commits() {
    let mut r = Rig::new(InputScheme::Grid);
    let (committed, out) = r.run("ny<t3><t3>");
    assert_eq!(committed, "");
    assert!(out.consumed);
    assert!(r.session.is_composing());
    // A tone with nothing composing starts nothing.
    r.run("<esc>");
    let (committed, out) = r.run("<t3>");
    assert_eq!(committed, "");
    assert!(!r.session.is_composing());
    assert!(!has_private_use(&out.frame.preedit_text()));
}

#[test]
fn grid_space_is_not_a_tone() {
    let mut r = Rig::new(InputScheme::Grid);
    let (committed, out) = r.run("ny<space>");
    assert_eq!(committed, "你", "space commits at once, unlike zhuyin");
    assert!(out.frame.preedit.is_empty());
}

#[test]
fn grid_digit_selects() {
    let mut r = Rig::new(InputScheme::Grid);
    let (_, out) = r.run("nyh<ao>");
    let second = r.candidates(&out)[1].clone();
    let (committed, _) = r.run("2");
    assert_eq!(committed, second);
}

#[test]
fn grid_enter_commits_highlighted() {
    let mut r = Rig::new(InputScheme::Grid);
    let (committed, _) = r.run("nyh<ao><enter>");
    assert_eq!(committed, "你好");
}

#[test]
fn grid_backspace_removes_one_key() {
    let mut r = Rig::new(InputScheme::Grid);
    let (_, out) = r.run("nyh<ao><bs>");
    assert_eq!(out.frame.preedit_text(), "ny h", "one private-use key, one backspace");
}

#[test]
fn grid_abbreviation_by_initials() {
    let mut r = Rig::new(InputScheme::Grid);
    let (_, out) = r.run("nh");
    assert!(r.candidates(&out).contains(&"你好".to_string()));
    r.run("<esc>");
    // `z` must be read as zh as well as z, or 中国 is unreachable.
    let (_, out) = r.run("zg");
    assert!(
        r.candidates(&out).contains(&"中国".to_string()),
        "{:?}",
        r.candidates(&out)
    );
}

#[test]
fn grid_raw_commit_shows_labels() {
    let mut r = Rig::new(InputScheme::Grid);
    // Shift toggles English and sends what was composing as it stands.
    let (committed, _) = r.run("ny<ng><shift>");
    assert!(!has_private_use(&committed), "{committed:?}");
    assert!(committed.contains("ng"));
}

#[test]
fn choosing_a_candidate_by_tap() {
    let mut r = Rig::new(InputScheme::Grid);
    let (_, out) = r.run("nyh<ao>");
    let second = r.candidates(&out)[1].clone();
    let out = r.session.choose(&r.engine, &mut r.learner, 1);
    assert_eq!(out.commit.as_deref(), Some(second.as_str()));
    assert_eq!(r.learner.weight(&second), 1);
    // Nothing composing and no list: the tap is not ours.
    r.session.dismiss();
    let out = r.session.choose(&r.engine, &mut r.learner, 0);
    assert!(!out.consumed && out.commit.is_none());
}

#[test]
fn choosing_in_a_private_session_does_not_learn() {
    let mut r = Rig::new(InputScheme::Grid);
    r.session.set_private(true);
    r.run("nyh<ao>");
    let out = r.session.choose(&r.engine, &mut r.learner, 0);
    assert_eq!(out.commit.as_deref(), Some("你好"));
    assert_eq!(r.learner.weight("你好"), 0);
}

#[test]
fn key_outcome_serialises_for_the_android_bridge() {
    let mut r = Rig::new(InputScheme::Grid);
    let (_, out) = r.run("ny");
    let json = serde_json::to_value(&out).unwrap();
    assert_eq!(json["consumed"], true);
    assert!(json["frame"]["candidates"].is_array());
}

// ── context for the scorer ──────────────────────────────────────────────

/// Never changes the ranking; remembers the left and right context it was
/// last asked with.
#[derive(Default)]
struct Listener {
    last: std::sync::Mutex<Option<(String, String)>>,
    hints: std::sync::Mutex<Vec<String>>,
}

impl meridian_ime_engine::SentenceScorer for Listener {
    fn score(&self, req: &meridian_ime_engine::ScoreRequest<'_>) -> Vec<f64> {
        *self.last.lock().unwrap() = Some((req.left.to_string(), req.right.to_string()));
        *self.hints.lock().unwrap() = req.hints.to_vec();
        Vec::new()
    }
}

struct Shared(Arc<Listener>);

impl meridian_ime_engine::SentenceScorer for Shared {
    fn score(&self, req: &meridian_ime_engine::ScoreRequest<'_>) -> Vec<f64> {
        self.0.score(req)
    }
}

fn listening_rig() -> (Rig, Arc<Listener>) {
    let mut r = Rig::new(InputScheme::Pinyin);
    let listener = Arc::new(Listener::default());
    let set = dictionary(r._dir.path());
    r.engine = Arc::new(Engine::new(Arc::new(set)).with_scorer(Box::new(Shared(listener.clone()))));
    (r, listener)
}

fn last_context(l: &Listener) -> (String, String) {
    l.last.lock().unwrap().clone().expect("the scorer was asked")
}

#[test]
fn commits_become_left_context() {
    let (mut r, l) = listening_rig();
    r.run("nihao<space>");
    r.run("ma");
    assert_eq!(last_context(&l).0, "你好");
    r.run("<space>");
    r.run("wo");
    assert_eq!(last_context(&l).0, "你好吗");
}

#[test]
fn reported_surroundings_replace_and_reset_clears() {
    let (mut r, l) = listening_rig();
    r.run("nihao<space>");
    r.session.set_surrounding("前文", "后文");
    r.run("wo");
    assert_eq!(last_context(&l), ("前文".to_string(), "后文".to_string()));
    r.run("<esc>");
    r.session.reset();
    r.run("wo");
    assert_eq!(last_context(&l), (String::new(), String::new()), "focus moved on");
}

#[test]
fn a_private_session_tells_the_scorer_nothing() {
    let (mut r, l) = listening_rig();
    r.session.set_private(true);
    r.session.set_surrounding("密码是", "");
    r.session.set_hints(Arc::from(vec!["不该出现".to_string()]));
    r.run("nihao<space>");
    r.run("wo");
    assert_eq!(last_context(&l), (String::new(), String::new()));
    assert!(l.hints.lock().unwrap().is_empty(), "no memory hints in a private field");
    // Leaving private mode does not bring back what was typed inside it.
    r.session.set_private(false);
    r.run("<esc>wo");
    assert_eq!(last_context(&l).0, "");
}

#[test]
fn left_context_is_bounded() {
    let (mut r, l) = listening_rig();
    let long: String = std::iter::repeat_n('字', 200).collect();
    r.session.set_surrounding(&long, "");
    r.run("wo");
    assert_eq!(
        last_context(&l).0.chars().count(),
        meridian_ime_session::LEFT_CONTEXT_CHARS
    );
}

/// A long press sends a precise key: it reads one of what the shared key
/// covers, so the other drops out of the candidates.
#[test]
fn grid_precise_keys_from_a_long_press() {
    let mut r = Rig::new(InputScheme::Grid);
    let (_, out) = r.run("<zh>w<-ng>");
    let cands = r.candidates(&out);
    assert!(
        cands.contains(&"中".to_string()) && !cands.contains(&"总".to_string()),
        "{cands:?}"
    );
    assert_eq!(out.frame.preedit_text(), "zhwng");
    r.run("<esc>");
    // 扔 may still appear as a word for the prefix `r` alone (the 简拼 edge);
    // what covers all three keys is 人 only.
    let whole = |names: &str| -> Vec<String> {
        let keys = meridian_ime_engine::grid_keys(names);
        let n = keys.chars().count();
        r.engine
            .query(
                &keys,
                InputScheme::Grid,
                &r.learner,
                &mut meridian_ime_engine::SpanCache::new(),
            )
            .candidates
            .into_iter()
            .filter(|c| c.consumed == n)
            .map(|c| c.text)
            .collect()
    };
    assert_eq!(whole("r e -n"), vec!["人"]);
    let fuzzy = whole("r e ng");
    assert!(
        fuzzy.contains(&"人".to_string()) && fuzzy.contains(&"扔".to_string()),
        "{fuzzy:?}"
    );
    let (_, out) = r.run("<z_>w<ng>");
    let cands = r.candidates(&out);
    assert!(
        cands.contains(&"总".to_string()) && !cands.contains(&"中".to_string()),
        "{cands:?}"
    );
}

impl Rig {
    fn insert(&mut self, text: &str) -> KeyOutcome {
        self.session.insert(&self.engine, &mut self.learner, text)
    }
}

#[test]
fn inserted_text_commits_the_candidate_and_is_not_mapped() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("nihao");
    let out = r.insert(",");
    assert_eq!(
        out.commit.as_deref(),
        Some("你好,"),
        "a half-width comma stays half-width"
    );
    assert!(out.consumed && out.frame.is_empty());
    assert_eq!(r.learner.weight("你好"), 1, "the candidate is learned like any commit");

    let out = r.insert("……");
    assert_eq!(out.commit.as_deref(), Some("……"), "nothing composing: the text alone");
    assert!(out.consumed);
}

#[test]
fn an_inserted_digit_does_not_select_a_candidate() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("ni");
    let out = r.insert("3");
    assert_eq!(out.commit.as_deref(), Some("你3"));
    // And the next `.` is a decimal point, as after a typed digit.
    let (committed, _) = r.run(".");
    assert_eq!(committed, "");
}

#[test]
fn an_insert_in_a_private_field_does_not_learn() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.session.set_private(true);
    r.run("nihao");
    assert_eq!(r.insert("。").commit.as_deref(), Some("你好。"));
    assert_eq!(r.learner.weight("你好"), 0);
}

// ── prediction ──────────────────────────────────────────────────────────

fn predicting(r: &Rig, out: &KeyOutcome) -> Vec<String> {
    assert!(out.frame.predicting, "no list: {:?}", out.frame);
    assert!(out.frame.preedit.is_empty());
    r.candidates(out)
}

#[test]
fn a_commit_offers_what_may_follow() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (_, out) = r.run("nihao<space>");
    assert_eq!(predicting(&r, &out), vec!["吗", "，", "。"]);
    assert_eq!(out.frame.highlight, 0);
    assert!(r.session.is_predicting());
    assert!(!r.session.is_composing());
}

#[test]
fn tab_takes_the_highlighted_prediction_and_learns_it() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (committed, out) = r.run("nihao<space><tab>");
    assert_eq!(committed, "你好吗");
    assert!(out.consumed);
    assert_eq!(
        r.learner.ngram().bigram_count("你好", "吗"),
        2,
        "taken like a chosen word, twice the weight of a composed one"
    );
    // The chain now ends in the whole word 你好吗, which begins nothing.
    assert!(!out.frame.predicting);
}

#[test]
fn up_down_move_and_a_mark_ends_the_chain() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (_, out) = r.run("wo<space>");
    assert_eq!(predicting(&r, &out), vec!["想", "，", "。"]);
    let (_, out) = r.run("<down><down><down>");
    assert_eq!(out.frame.highlight, 2, "clamped at the last item");
    let (_, out) = r.run("<up>");
    assert_eq!(out.frame.highlight, 1);
    let (committed, out) = r.run("<tab>");
    assert_eq!(committed, "，");
    assert!(!out.frame.predicting, "a mark predicts nothing after it");
    assert!(out.frame.is_empty());
}

#[test]
fn esc_closes_the_list_and_is_eaten() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("nihao<space>");
    let (committed, out) = r.run("<esc>");
    assert_eq!(committed, "");
    assert!(out.consumed);
    assert!(out.frame.is_empty());
    assert!(!r.session.is_predicting());
}

/// The promise that makes the list harmless: with it on screen, every key
/// but the four does exactly what it does without it.
#[test]
fn any_other_key_closes_the_list_and_means_what_it_means() {
    let cases: &[(&str, bool, &str, &str)] = &[
        // key, consumed, committed, preedit
        ("3", false, "", ""),
        ("w", true, "", "w"),
        (",", true, "，", ""),
        ("<bs>", false, "", ""),
        ("<enter>", false, "", ""),
        ("<left>", false, "", ""),
        ("<space>", false, "", ""),
    ];
    for &(key, consumed, committed_want, preedit) in cases {
        let mut r = Rig::new(InputScheme::Pinyin);
        r.run("nihao<space>");
        let (committed, out) = r.run(key);
        assert_eq!(out.consumed, consumed, "{key}");
        assert_eq!(committed, committed_want, "{key}");
        assert_eq!(out.frame.preedit_text(), preedit, "{key}");
        assert!(!out.frame.predicting, "{key} closed the list");
    }
    // Shift+Tab is not Tab.
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("nihao<space>");
    let mut ev = meridian_ime_session::keys::function(meridian_ime_session::keys::VK_TAB);
    ev.mods.shift = true;
    let out = r.session.handle_key(&r.engine, &mut r.learner, ev);
    assert!(!out.consumed && out.commit.is_none());
    assert!(!r.session.is_predicting());
}

#[test]
fn what_the_person_writes_next_comes_first() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("wo<space>qu<space>");
    let (_, out) = r.run("wo<space>");
    assert_eq!(predicting(&r, &out), vec!["去", "想", "，", "。"]);
    assert_eq!(
        out.frame.candidates[0].source,
        meridian_ime_proto::CandidateSource::User,
        "marked as the person's own"
    );
}

#[test]
fn a_private_session_predicts_from_the_dictionary_only() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("wo<space>qu<space>");
    r.session.reset();
    r.session.set_private(true);
    let (_, out) = r.run("wo<space>");
    assert_eq!(predicting(&r, &out), vec!["想", "，", "。"]);
    r.run("<tab>");
    assert_eq!(
        r.learner.ngram().bigram_count("我", "想"),
        0,
        "and learns nothing from it"
    );
}

#[test]
fn a_tap_takes_a_prediction() {
    let mut r = Rig::new(InputScheme::Grid);
    r.run("nyh<ao><space>");
    let out = r.session.choose(&r.engine, &mut r.learner, 0);
    assert_eq!(out.commit.as_deref(), Some("吗"));
    let mut r = Rig::new(InputScheme::Grid);
    r.run("nyh<ao><space>");
    let out = r.session.choose(&r.engine, &mut r.learner, 2);
    assert_eq!(out.commit.as_deref(), Some("。"), "the marks are taps too");
}

#[test]
fn nothing_is_offered_after_raw_keys_punctuation_or_with_prediction_off() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (committed, out) = r.run("nihao<enter>");
    assert_eq!(committed, "nihao");
    assert!(!out.frame.predicting, "raw keys are not a word");
    let (_, out) = r.run("nihao,");
    assert!(!out.frame.predicting, "punctuation ends the chain");
    let mut r = Rig::new(InputScheme::Pinyin);
    r.session.set_config(SessionConfig {
        prediction: false,
        ..r.session.config().clone()
    });
    let (_, out) = r.run("nihao<space>");
    assert!(out.frame.is_empty());
}

#[test]
fn a_word_nothing_follows_offers_no_list_of_marks_alone() {
    let mut r = Rig::new(InputScheme::Pinyin);
    let (committed, out) = r.run("fan<space>");
    assert_eq!(committed, "饭");
    assert!(out.frame.is_empty(), "{:?}", out.frame);
}

#[test]
fn a_dismissed_list_ends_the_chain() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("wo<space>");
    r.session.dismiss();
    r.run("qu<space>");
    assert_eq!(
        r.learner.ngram().bigram_count("我", "去"),
        0,
        "the caret moved in between: 去 did not follow 我"
    );
    // Esc, or typing on past the list, is the person still writing at the
    // same place: the list goes and the chain holds.
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("wo<space><esc>qu<space>");
    assert_eq!(r.learner.ngram().bigram_count("我", "去"), 2);
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("wo<space>qu<space>");
    assert_eq!(r.learner.ngram().bigram_count("我", "去"), 2);
}

#[test]
fn dismiss_and_reset_close_the_list() {
    let mut r = Rig::new(InputScheme::Pinyin);
    r.run("nihao<space>");
    assert!(r.session.dismiss().is_empty());
    r.run("nihao<space>");
    assert!(r.session.reset().is_empty());
    assert!(!r.session.is_predicting());
}
