//! `bench`: the sentence composer against sentences a person would expect.
//!
//! Each case is a key string and the text it should produce. Four numbers
//! come out of it:
//!
//! - **top-1** is the number that matters for typing without looking; top-3
//!   says whether the answer was at least on the first page.
//! - **KPC**, keystrokes per character: the keys typed plus what it costs to
//!   pick the answer (one key for the first candidate or a digit, a page-down
//!   per page before that), picking greedily the longest candidate that
//!   starts the expected text until it is all written. This is what compares
//!   schemes — grid against zhuyin against pinyin — and tone habits against
//!   each other. A sentence no sequence of picks can write is *unreachable*
//!   and counted apart.
//! - **misses per key**: dictionary lookups the span cache could not answer
//!   while the keys are typed one at a time, which is what the grid's fuzzy
//!   keys multiply, and the slowest of those keystrokes. The latency is the
//!   number that decides; the misses say where it would come from. Measured
//!   on rime-ice in release, 2026-09: grid averages 91 misses a key with a
//!   worst of 1212, and its slowest keystroke is 5.7 ms against a 30 ms
//!   budget, so pruning dead paths (`DictSet::has_code_prefix`) is not built.
//! - query time, cold.
//!
//! Cases come from three places. The built-in list is everyday pinyin; under
//! another scheme it is converted through [`keys_for`] with no tones typed.
//! `--cases file.tsv` is `keys<TAB>expected`. `--eval file.tsv` is the
//! evaluation set's own format — a header naming at least `text` and
//! `toned_pinyin` — with the keys derived per `--scheme` and `--tones`.
//!
//! `--lm <bundle dir>` runs the cases a second time with that model scoring
//! candidates and lists every case whose first candidate changed — fixed,
//! broken or just different — then the same numbers. `--ort <lib>` names the
//! ONNX Runtime library when it is not beside the executable, and
//! `--budget-ms` replaces the manifest's budget.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use meridian_ime_dict::SyllableTable;
use meridian_ime_engine::scheme::{PinyinScheme, SchemeParser};
use meridian_ime_engine::{
    Engine, InputScheme, MemoryLearner, SpanCache, SpellingHabit, TonePolicy, grid_label, keys_for_habit,
};
use meridian_ime_lm::{LmOptions, Platform, find_onnxruntime, open_bundle};

use crate::Args;
use crate::lookup::open_engine;

const DEFAULT_CASES: &[(&str, &str)] = &[
    ("nihao", "你好"),
    ("woxiangquchifan", "我想去吃饭"),
    ("zhonghuarenmingongheguo", "中华人民共和国"),
    ("jintiantianqizenmeyang", "今天天气怎么样"),
    ("womenyiqiquwan", "我们一起去玩"),
    ("xiexieni", "谢谢你"),
    ("zaijian", "再见"),
    ("zhongguo", "中国"),
    ("beijingshi", "北京市"),
    ("wozaixuexizhongwen", "我在学习中文"),
    ("qingwenxishoujianzainali", "请问洗手间在哪里"),
    ("mingtianjian", "明天见"),
    ("duibuqi", "对不起"),
    ("meiguanxi", "没关系"),
    ("woaini", "我爱你"),
    ("zhegeduoshaoqian", "这个多少钱"),
    ("nijiaoshenmemingzi", "你叫什么名字"),
    ("shurufa", "输入法"),
    ("jisuanji", "计算机"),
    ("rengongzhineng", "人工智能"),
    ("kaiyuanruanjian", "开源软件"),
    ("xianzaijidianle", "现在几点了"),
    ("wobuzhidao", "我不知道"),
    ("haojiubujian", "好久不见"),
    ("shengrikuaile", "生日快乐"),
    ("xinniankuaile", "新年快乐"),
    ("tianqihenhao", "天气很好"),
    ("womingtianyaoshangban", "我明天要上班"),
    ("zheshiyigeceshi", "这是一个测试"),
    ("huanyingshiyong", "欢迎使用"),
];

pub fn run(args: &[String]) -> Result<(), String> {
    let args = Args::parse(args)?;
    let data_dir = args.data_dir()?;
    let scheme = args.scheme()?;
    let policy = tone_policy(args.flag("tones"))?;
    let habit = spelling_habit(args.flag("habit"))?;
    let page_size: usize = match args.flag("page-size") {
        Some(v) => v.parse().map_err(|_| format!("--page-size {v:?} is not a number"))?,
        None => 5,
    };
    let table = SyllableTable::new();
    let cases = match (args.flag("cases"), args.flag("eval")) {
        (Some(_), Some(_)) => return Err("--cases and --eval are two ways to say the same thing; pass one".into()),
        (Some(path), None) => load_cases(path)?,
        (None, Some(path)) => load_eval(path, scheme, policy, habit, &table)?,
        (None, None) => builtin_cases(scheme, habit, &table)?,
    };
    if cases.is_empty() {
        return Err("no cases to run".into());
    }
    let (engine, names) = open_engine(&data_dir)?;
    println!("dictionaries: {}", names.join(", "));
    println!("scheme {scheme:?}, tones {policy:?}, habit {habit:?}, page size {page_size}");
    let dict = run_cases(&engine, scheme, &cases, page_size, true);
    dict.print();

    if let Some(bundle) = args.flag("lm") {
        let budget = match args.flag("budget-ms") {
            Some(v) => Some(Duration::from_millis(
                v.parse().map_err(|_| format!("--budget-ms {v:?} is not a number"))?,
            )),
            None => None,
        };
        let options = LmOptions {
            runtime: args.flag("ort").map(PathBuf::from).or_else(find_onnxruntime),
            platform: Platform::Desktop,
            threads: 2,
            budget,
        };
        let scorer = Arc::new(open_bundle(Path::new(bundle), &options, &table).map_err(|e| e.to_string())?);
        let (engine, _) = open_engine(&data_dir)?;
        let engine = engine.with_scorer(Box::new(scorer.clone()));
        println!();
        println!("== with the language model ({bundle})");
        let lm = run_cases(&engine, scheme, &cases, page_size, false);
        for (i, (keys, expected)) in cases.iter().enumerate() {
            if dict.firsts[i] != lm.firsts[i] {
                let shown: String = keys.chars().map(grid_label).collect();
                let verdict = if lm.firsts[i] == *expected {
                    "fixed"
                } else if dict.firsts[i] == *expected {
                    "broken"
                } else {
                    "changed"
                };
                println!(
                    "{verdict:<8} {shown:<28} {} → {}  expected {expected}",
                    dict.firsts[i], lm.firsts[i]
                );
            }
        }
        lm.print();
        let s = scorer.stats();
        println!(
            "model: {} runs, {} answered from cache, {} missed",
            s.runs, s.cached, s.missed
        );
    }
    Ok(())
}

/// What one pass over the cases measured.
struct Summary {
    n: usize,
    top1: usize,
    top3: usize,
    keystrokes: usize,
    chars: usize,
    unreachable: usize,
    miss_sum: u64,
    miss_keys: u64,
    miss_max: u64,
    worst_key: Duration,
    total: Duration,
    slowest: Duration,
    /// The first candidate of each case, for comparing two passes.
    firsts: Vec<String>,
}

impl Summary {
    fn print(&self) {
        let n = self.n;
        let pct = |k: usize| 100.0 * k as f64 / n as f64;
        println!();
        println!(
            "top-1 {}/{n} ({:.1}%)  top-3 {}/{n} ({:.1}%)",
            self.top1,
            pct(self.top1),
            self.top3,
            pct(self.top3)
        );
        if self.chars > 0 {
            println!(
                "KPC {:.3} over {} reachable case(s), {} unreachable",
                self.keystrokes as f64 / self.chars as f64,
                n - self.unreachable,
                self.unreachable
            );
        }
        if self.miss_keys > 0 {
            println!(
                "cache misses per key: mean {:.1}, max {}; slowest keystroke {:.2?}",
                self.miss_sum as f64 / self.miss_keys as f64,
                self.miss_max,
                self.worst_key
            );
        }
        println!("mean query {:.2?}, slowest {:.2?}", self.total / n as u32, self.slowest);
    }
}

fn run_cases(
    engine: &Engine,
    scheme: InputScheme,
    cases: &[(String, String)],
    page_size: usize,
    per_case: bool,
) -> Summary {
    let learner = MemoryLearner::new();
    let mut s = Summary {
        n: cases.len(),
        top1: 0,
        top3: 0,
        keystrokes: 0,
        chars: 0,
        unreachable: 0,
        miss_sum: 0,
        miss_keys: 0,
        miss_max: 0,
        worst_key: Duration::ZERO,
        total: Duration::ZERO,
        slowest: Duration::ZERO,
        firsts: Vec::with_capacity(cases.len()),
    };
    for (keys, expected) in cases {
        // A fresh cache: the bench measures a first query, not a keystroke
        // after many.
        let mut cache = SpanCache::new();
        let started = Instant::now();
        let query = engine.query(keys, scheme, &learner, &mut cache);
        let elapsed = started.elapsed();
        s.total += elapsed;
        s.slowest = s.slowest.max(elapsed);
        let texts: Vec<&str> = query.candidates.iter().map(|c| c.text.as_str()).collect();
        let first = texts.first().copied().unwrap_or("(none)");
        s.firsts.push(first.to_string());
        let hit1 = first == expected;
        let hit3 = texts.iter().take(3).any(|t| *t == expected);
        s.top1 += usize::from(hit1);
        s.top3 += usize::from(hit3);

        let kpc = match keystrokes_for(engine, scheme, keys, expected, page_size) {
            Some(k) => {
                s.keystrokes += k;
                s.chars += expected.chars().count();
                format!("kpc {:.2}", k as f64 / expected.chars().count() as f64)
            }
            None => {
                s.unreachable += 1;
                "unreachable".to_string()
            }
        };
        let (sum, max, n, key_slowest) = misses_while_typing(engine, scheme, keys);
        s.worst_key = s.worst_key.max(key_slowest);
        s.miss_sum += sum;
        s.miss_keys += n;
        s.miss_max = s.miss_max.max(max);

        if per_case {
            let mark = if hit1 {
                "✓"
            } else if hit3 {
                "~"
            } else {
                "✗"
            };
            let shown: String = keys.chars().map(grid_label).collect();
            let mean = if n == 0 { 0.0 } else { sum as f64 / n as f64 };
            println!(
                "{mark} {shown:<28} {first:<16} expected {expected}  {kpc}  miss/key {mean:.0} (max {max}, slowest key {key_slowest:.2?})  ({elapsed:.2?})"
            );
        }
    }
    s
}

/// `pinyin` (the default) or `zhuyin`: how the grid's rimes are spelled.
pub(crate) fn spelling_habit(flag: Option<&str>) -> Result<SpellingHabit, String> {
    match flag {
        None | Some("pinyin") => Ok(SpellingHabit::Pinyin),
        Some("zhuyin") => Ok(SpellingHabit::Zhuyin),
        Some(other) => Err(format!("--habit {other:?}: expected pinyin or zhuyin")),
    }
}

/// `all`, `none`, or `random` / `random:<seed>`.
pub(crate) fn tone_policy(flag: Option<&str>) -> Result<TonePolicy, String> {
    match flag {
        None | Some("all") => Ok(TonePolicy::All),
        Some("none") => Ok(TonePolicy::None),
        Some("random") => Ok(TonePolicy::Random(1)),
        Some(other) => match other.strip_prefix("random:") {
            Some(seed) => seed
                .parse()
                .map(TonePolicy::Random)
                .map_err(|_| format!("--tones {other:?}: the seed is not a number")),
            None => Err(format!("--tones {other:?}: expected all, none or random[:seed]")),
        },
    }
}

/// What picking the candidate at `rank` costs: a key for the first one or a
/// digit on the first page, one page-down per page before that.
fn pick_cost(rank: usize, page_size: usize) -> usize {
    rank / page_size.max(1) + 1
}

/// Keystrokes to write `expected` from `keys`: the keys themselves plus the
/// picks, taking at each step the longest candidate that starts what is left
/// (the earlier one on a tie). `None` when no candidate starts it.
fn keystrokes_for(engine: &Engine, scheme: InputScheme, keys: &str, expected: &str, page_size: usize) -> Option<usize> {
    let learner = MemoryLearner::new();
    let mut remaining_keys: String = keys.to_string();
    let mut remaining_text = expected;
    let mut cost = keys.chars().count();
    while !remaining_text.is_empty() {
        if remaining_keys.is_empty() {
            return None;
        }
        let mut cache = SpanCache::new();
        let query = engine.query(&remaining_keys, scheme, &learner, &mut cache);
        let (rank, cand) = query
            .candidates
            .iter()
            .enumerate()
            .filter(|(_, c)| c.consumed > 0 && !c.text.is_empty() && remaining_text.starts_with(&c.text))
            .max_by(|(ra, a), (rb, b)| a.text.len().cmp(&b.text.len()).then(rb.cmp(ra)))?;
        cost += pick_cost(rank, page_size);
        remaining_text = &remaining_text[cand.text.len()..];
        remaining_keys = remaining_keys.chars().skip(cand.consumed).collect();
    }
    Some(cost)
}

/// Lookups the cache could not answer as the keys are typed one by one, and
/// the slowest of those keystrokes: (sum, max for one key, keys, slowest).
fn misses_while_typing(engine: &Engine, scheme: InputScheme, keys: &str) -> (u64, u64, u64, Duration) {
    let learner = MemoryLearner::new();
    let mut cache = SpanCache::new();
    let chars: Vec<char> = keys.chars().collect();
    let (mut sum, mut max) = (0u64, 0u64);
    let mut slowest = Duration::ZERO;
    let mut before = 0u64;
    for i in 1..=chars.len() {
        let prefix: String = chars[..i].iter().collect();
        let started = Instant::now();
        let _ = engine.query(&prefix, scheme, &learner, &mut cache);
        slowest = slowest.max(started.elapsed());
        let now = cache.stats().misses;
        let delta = now - before;
        before = now;
        sum += delta;
        max = max.max(delta);
    }
    (sum, max, chars.len() as u64, slowest)
}

/// The built-in list, in `scheme`'s keys. The pinyin strings are cut into
/// syllables by the pinyin scheme's own reading, and typed without tones:
/// the list carries none to type.
fn builtin_cases(
    scheme: InputScheme,
    habit: SpellingHabit,
    table: &SyllableTable,
) -> Result<Vec<(String, String)>, String> {
    let pinyin = PinyinScheme::new(table);
    DEFAULT_CASES
        .iter()
        .map(|(keys, expected)| {
            if scheme == InputScheme::Pinyin {
                return Ok((keys.to_string(), expected.to_string()));
            }
            let seg = pinyin.segment(keys);
            if seg.edges.iter().any(|e| !e.complete) {
                return Err(format!("built-in case {keys:?} does not read as whole syllables"));
            }
            let syllables: Vec<&str> = seg.edges.iter().map(|e| e.text.as_str()).collect();
            let converted = keys_for_habit(scheme, &syllables.join(" "), TonePolicy::None, habit, table)?;
            Ok((converted, expected.to_string()))
        })
        .collect()
}

fn load_cases(path: &str) -> Result<Vec<(String, String)>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    let mut cases = Vec::new();
    for (no, line) in text.lines().enumerate() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((keys, expected)) = line.split_once('\t') else {
            return Err(format!("{path}:{}: expected `keys<TAB>expected`", no + 1));
        };
        cases.push((keys.trim().to_string(), expected.trim().to_string()));
    }
    Ok(cases)
}

/// The evaluation set: a header line naming the columns, then one sentence
/// per line. Only `text` and `toned_pinyin` are read.
fn load_eval(
    path: &str,
    scheme: InputScheme,
    policy: TonePolicy,
    habit: SpellingHabit,
    table: &SyllableTable,
) -> Result<Vec<(String, String)>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    let mut lines = text
        .lines()
        .enumerate()
        .map(|(no, l)| (no + 1, l.trim_end_matches('\r')))
        .filter(|(_, l)| !l.is_empty() && !l.starts_with('#'));
    let (_, header) = lines.next().ok_or_else(|| format!("{path}: empty"))?;
    let columns: Vec<&str> = header.split('\t').collect();
    let col = |name: &str| {
        columns
            .iter()
            .position(|c| *c == name)
            .ok_or_else(|| format!("{path}: the header names no `{name}` column"))
    };
    let (text_col, toned_col) = (col("text")?, col("toned_pinyin")?);
    let mut cases = Vec::new();
    for (no, line) in lines {
        let fields: Vec<&str> = line.split('\t').collect();
        let (Some(expected), Some(toned)) = (fields.get(text_col), fields.get(toned_col)) else {
            return Err(format!("{path}:{no}: fewer columns than the header"));
        };
        let keys = keys_for_habit(scheme, toned, policy, habit, table).map_err(|e| format!("{path}:{no}: {e}"))?;
        cases.push((keys, expected.trim().to_string()));
    }
    Ok(cases)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picking_costs_a_key_per_page() {
        assert_eq!(pick_cost(0, 5), 1, "first candidate: space");
        assert_eq!(pick_cost(4, 5), 1, "a digit on the first page");
        assert_eq!(pick_cost(5, 5), 2, "one page down, then a digit");
        assert_eq!(pick_cost(12, 5), 3);
    }

    #[test]
    fn tone_flags() {
        assert_eq!(tone_policy(None).unwrap(), TonePolicy::All);
        assert_eq!(tone_policy(Some("none")).unwrap(), TonePolicy::None);
        assert_eq!(tone_policy(Some("random:9")).unwrap(), TonePolicy::Random(9));
        assert!(tone_policy(Some("some")).is_err());
    }

    #[test]
    fn builtin_cases_convert_to_every_scheme() {
        let t = SyllableTable::new();
        for scheme in [InputScheme::Pinyin, InputScheme::Zhuyin, InputScheme::Grid] {
            let cases = builtin_cases(scheme, SpellingHabit::Pinyin, &t).unwrap();
            assert_eq!(cases.len(), DEFAULT_CASES.len());
        }
        let grid = builtin_cases(InputScheme::Grid, SpellingHabit::Pinyin, &t).unwrap();
        let shown: String = grid[0].0.chars().map(grid_label).collect();
        assert_eq!(shown, "nyhao");
    }
}
