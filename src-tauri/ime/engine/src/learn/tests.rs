use std::time::Duration;

use meridian_ime_dict::UserWord;

use super::memory::MAX_CHOICE_ENTRIES;
use super::{Context, FileLearner, Learner, MemoryLearner, Muted};

#[test]
fn memory_learner_counts_and_undo() {
    let mut m = MemoryLearner::new();
    assert_eq!(m.weight("好"), 0);
    m.record("好");
    m.record("好");
    m.record("好");
    m.unrecord("好");
    assert_eq!(m.weight("好"), 2);
    m.unrecord("好");
    m.unrecord("好");
    m.unrecord("好");
    assert_eq!(m.weight("好"), 0);
    assert!(m.weights().is_empty(), "unrecord past zero removes the row");

    m.record_choice("nh", "你好");
    m.record_choice("nh", "你好");
    m.record_choice("nh", "拟好");
    m.unrecord_choice("nh", "你好");
    assert_eq!(m.choice_weight("nh", "你好"), 1);
    assert_eq!(m.choice_weight("nh", "拟好"), 1);
    m.unrecord_choice("nh", "拟好");
    m.unrecord_choice("nh", "拟好");
    assert_eq!(m.choice_weight("nh", "拟好"), 0);
    assert_eq!(m.choices().len(), 1);

    m.record_transition(Context::after("我"), "想", 2);
    assert_eq!(m.ngram().bigram_count("我", "想"), 2);
    m.unrecord_transition(Context::after("我"), "想", 1);
    assert_eq!(m.ngram().bigram_count("我", "想"), 1);
}

#[test]
fn learn_word_bumps_generation_and_user_words() {
    let mut m = MemoryLearner::new();
    let g0 = m.user_words_generation();
    assert!(m.user_words().is_empty());
    m.learn_word("妮好", "ni hao");
    let g1 = m.user_words_generation();
    assert!(g1 > g0);
    m.learn_word("妮好", "ni hao");
    let g2 = m.user_words_generation();
    assert!(g2 > g1, "a repeat is still a change: the weight moved");
    assert_eq!(
        m.user_words(),
        vec![UserWord {
            code: "ni hao".into(),
            text: "妮好".into(),
            weight: 2
        }]
    );
    m.forget_word("妮好", "ni hao");
    assert!(m.user_words_generation() > g2);
    assert!(m.user_words().is_empty());
    let g3 = m.user_words_generation();
    m.forget_word("妮好", "ni hao");
    assert_eq!(m.user_words_generation(), g3, "forgetting nothing changes nothing");
}

#[test]
fn muted_swallows_writes_but_reads() {
    let mut m = MemoryLearner::new();
    m.record("好");
    {
        let mut muted = Muted::new(&mut m, true);
        assert!(muted.is_muted());
        muted.record("好");
        muted.record_choice("h", "好");
        muted.record_transition(Context::after("很"), "好", 1);
        muted.learn_word("好好", "hao hao");
        assert_eq!(muted.weight("好"), 1, "reads pass through");
    }
    assert_eq!(m.weight("好"), 1);
    assert_eq!(m.choice_weight("h", "好"), 0);
    assert_eq!(m.ngram().bigram_count("很", "好"), 0);
    assert!(m.user_words().is_empty());
    {
        let mut open = Muted::new(&mut m, false);
        open.record("好");
        open.record_choice("h", "好");
    }
    assert_eq!(m.weight("好"), 2, "an unmuted wrapper writes through");
    assert_eq!(m.choice_weight("h", "好"), 1);
}

#[test]
fn file_learner_round_trips_all_four_tables() {
    let dir = tempfile::tempdir().unwrap();
    {
        let mut f = FileLearner::open(dir.path()).unwrap();
        assert_eq!(f.dir(), dir.path());
        f.record("好");
        f.record("好");
        f.record("世界");
        f.record_choice("nh", "你好");
        f.record_choice("nh", "你好");
        f.record_choice("sj", "世界");
        f.learn_word("妮好", "ni hao");
        f.learn_word("妮好", "ni hao");
        f.learn_word("世介", "shi jie");
        f.record_transition(Context::after("我"), "想", 3);
        f.record_transition(Context::of(Some("我"), "也"), "想", 2);
        f.record_transition(Context::of(Some("他"), "也"), "想", 1);
        // A bigram fully explained by its trigram rows: no bigram row is
        // written for it, and it still comes back.
        f.record_transition(Context::of(Some("你"), "很"), "好", 4);
        f.flush();
    }
    let f = FileLearner::open(dir.path()).unwrap();
    assert_eq!(f.weight("好"), 2);
    assert_eq!(f.weight("世界"), 1);
    assert_eq!(f.choice_weight("nh", "你好"), 2);
    assert_eq!(f.choice_weight("sj", "世界"), 1);
    assert_eq!(
        f.user_words(),
        vec![
            UserWord {
                code: "shi jie".into(),
                text: "世介".into(),
                weight: 1
            },
            UserWord {
                code: "ni hao".into(),
                text: "妮好".into(),
                weight: 2
            },
        ]
    );
    assert!(
        f.user_words_generation() > 0,
        "loaded words read as a change from nothing"
    );
    let n = f.ngram();
    assert_eq!(n.bigram_count("我", "想"), 3);
    assert_eq!(n.bigram_count("也", "想"), 3);
    assert_eq!(n.trigram_count("我", "也", "想"), 2);
    assert_eq!(n.trigram_count("他", "也", "想"), 1);
    assert_eq!(n.bigram_count("很", "好"), 4);
    assert_eq!(n.trigram_count("你", "很", "好"), 4);
    assert_eq!(n.context_count("也"), 3);
    assert_eq!(n.len(), 6);

    let ngram_file = std::fs::read_to_string(dir.path().join("user-ngram.tsv")).unwrap();
    assert!(
        !ngram_file.contains("\n很\t好\t"),
        "a bigram the trigram rows cover is not written twice:\n{ngram_file}"
    );
    assert!(
        !ngram_file.contains("\n也\t想\t"),
        "a bigram the trigram rows cover is not written twice:\n{ngram_file}"
    );
    assert!(ngram_file.contains("\n我\t想\t3\n"), "{ngram_file}");
    assert!(ngram_file.starts_with('#'), "files open with a header");
}

#[test]
fn corrupt_lines_are_skipped_and_dropped_on_flush() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("user.tsv"),
        "# text\tcount\n好\t3\nbad\tnot-a-number\nonly-one-column\n\t5\nzero\t0\n世界\t1\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("user-ngram.tsv"),
        "我\t想\t2\ntoo\tmany\tcols\there\t1\tx\n",
    )
    .unwrap();
    let mut f = FileLearner::open(dir.path()).unwrap();
    assert_eq!(f.weight("好"), 3);
    assert_eq!(f.weight("世界"), 1);
    assert_eq!(f.weight("bad"), 0);
    assert_eq!(f.ngram().bigram_count("我", "想"), 2);
    f.flush();
    let weights = std::fs::read_to_string(dir.path().join("user.tsv")).unwrap();
    assert!(!weights.contains("not-a-number"), "{weights}");
    assert!(!weights.contains("only-one-column"), "{weights}");
    assert!(!weights.contains("zero"), "{weights}");
    assert!(weights.contains("好\t3\n"), "{weights}");
    assert!(weights.contains("世界\t1\n"), "{weights}");
    let ngram = std::fs::read_to_string(dir.path().join("user-ngram.tsv")).unwrap();
    assert!(!ngram.contains("too\tmany"), "{ngram}");
    assert!(ngram.contains("我\t想\t2\n"), "{ngram}");
}

#[test]
fn io_error_is_returned_not_swallowed() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("not-a-dir");
    std::fs::write(&file, "x").unwrap();
    let err = FileLearner::open(&file).expect_err("a file where the directory should be is an error");
    assert_ne!(err.kind(), std::io::ErrorKind::NotFound);
}

#[test]
fn missing_directory_opens_empty_and_is_created_at_flush() {
    let dir = tempfile::tempdir().unwrap();
    let learn = dir.path().join("learn");
    let mut f = FileLearner::open(&learn).unwrap();
    assert_eq!(f.weight("好"), 0);
    f.record("好");
    f.flush();
    assert!(learn.join("user.tsv").is_file());
}

fn names(dir: &std::path::Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn flush_writes_only_dirty_tables() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = FileLearner::open(dir.path()).unwrap();
    f.flush();
    assert!(names(dir.path()).is_empty(), "nothing dirty, nothing written");

    f.record("好");
    f.flush();
    assert_eq!(names(dir.path()), vec!["user.tsv"]);

    // Take the written file away: a flush that touched it again would put it
    // back, which is what proves the table was not rewritten.
    std::fs::remove_file(dir.path().join("user.tsv")).unwrap();
    f.record_choice("h", "好");
    f.learn_word("好好", "hao hao");
    f.flush();
    assert_eq!(names(dir.path()), vec!["user-choices.tsv", "user-words.tsv"]);

    f.record_transition(Context::after("很"), "好", 1);
    f.flush();
    assert_eq!(
        names(dir.path()),
        vec!["user-choices.tsv", "user-ngram.tsv", "user-words.tsv"]
    );
}

#[test]
fn flush_if_due_waits_for_the_interval_and_drop_flushes() {
    assert_eq!(FileLearner::FLUSH_INTERVAL, Duration::from_secs(60));
    let dir = tempfile::tempdir().unwrap();
    {
        let mut f = FileLearner::open(dir.path()).unwrap();
        f.record("好");
        f.flush_if_due(Duration::from_secs(3600));
        assert!(!dir.path().join("user.tsv").exists(), "not due yet");
        f.flush_if_due(Duration::ZERO);
        assert!(dir.path().join("user.tsv").is_file(), "due");
        std::fs::remove_file(dir.path().join("user.tsv")).unwrap();
        f.record("世界");
    }
    let weights = std::fs::read_to_string(dir.path().join("user.tsv")).unwrap();
    assert!(weights.contains("世界\t1\n"), "drop flushed what was dirty:\n{weights}");
}

#[test]
fn failed_write_keeps_the_table_dirty() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = FileLearner::open(dir.path()).unwrap();
    f.record("好");
    // A directory where the file should go makes the rename fail.
    std::fs::create_dir(dir.path().join("user.tsv")).unwrap();
    f.flush();
    assert!(
        dir.path().join("user.tsv").is_dir(),
        "the write failed and was not forced"
    );
    std::fs::remove_dir(dir.path().join("user.tsv")).unwrap();
    f.flush();
    let weights = std::fs::read_to_string(dir.path().join("user.tsv")).unwrap();
    assert!(weights.contains("好\t1\n"), "retried at the next flush:\n{weights}");
}

#[test]
fn choice_cap_halves() {
    let mut m = MemoryLearner::new();
    for _ in 0..4 {
        m.record_choice("keep", "留");
    }
    for i in 0..=MAX_CHOICE_ENTRIES {
        m.record_choice(&format!("k{i}"), "x");
    }
    assert!(m.choices().len() <= MAX_CHOICE_ENTRIES);
    assert_eq!(
        m.choice_weight("keep", "留"),
        2,
        "a count of four is halved, not dropped"
    );
    assert_eq!(m.choice_weight("k0", "x"), 0, "a count of one reaches zero and goes");
}
