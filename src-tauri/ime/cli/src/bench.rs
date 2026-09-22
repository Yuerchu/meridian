//! `bench`: the sentence composer against sentences a person would expect.
//!
//! Each case is a key string and the text it should produce. Top-1 is the
//! number that matters for typing without looking; top-3 says whether the
//! answer was at least on the first page. The built-in cases are everyday
//! sentences any general dictionary should carry; `--cases file.tsv`
//! (`keys<TAB>expected`, `#` comments) swaps in a domain's own.

use std::time::{Duration, Instant};

use meridian_ime_engine::{InputScheme, MemoryLearner, SpanCache};

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
    let cases = match args.flag("cases") {
        Some(path) => load_cases(path)?,
        None => DEFAULT_CASES
            .iter()
            .map(|(k, e)| (k.to_string(), e.to_string()))
            .collect(),
    };
    if cases.is_empty() {
        return Err("no cases to run".into());
    }
    let (engine, names) = open_engine(&data_dir)?;
    println!("dictionaries: {}", names.join(", "));

    let learner = MemoryLearner::new();
    let mut top1 = 0usize;
    let mut top3 = 0usize;
    let mut total = Duration::ZERO;
    let mut slowest = Duration::ZERO;
    for (keys, expected) in &cases {
        // A fresh cache per case: the bench measures a first query, not a
        // keystroke after many.
        let mut cache = SpanCache::new();
        let started = Instant::now();
        let query = engine.query(keys, scheme, &learner, &mut cache);
        let elapsed = started.elapsed();
        total += elapsed;
        slowest = slowest.max(elapsed);
        let texts: Vec<&str> = query.candidates.iter().map(|c| c.text.as_str()).collect();
        let first = texts.first().copied().unwrap_or("(none)");
        let hit1 = first == expected;
        let hit3 = texts.iter().take(3).any(|t| *t == expected);
        top1 += usize::from(hit1);
        top3 += usize::from(hit3);
        let mark = if hit1 {
            "✓"
        } else if hit3 {
            "~"
        } else {
            "✗"
        };
        println!("{mark} {keys:<28} {first:<16} expected {expected}  ({elapsed:.2?})");
    }
    let n = cases.len();
    let pct = |k: usize| 100.0 * k as f64 / n as f64;
    println!();
    println!(
        "top-1 {top1}/{n} ({:.1}%)  top-3 {top3}/{n} ({:.1}%)",
        pct(top1),
        pct(top3)
    );
    println!("mean query {:.2?}, slowest {:.2?}", total / n as u32, slowest);
    if scheme == InputScheme::Zhuyin {
        println!("note: the built-in cases are pinyin key strings; pass --cases for zhuyin keys");
    }
    Ok(())
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
