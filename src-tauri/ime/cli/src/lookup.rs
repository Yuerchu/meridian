//! `lookup`: rank candidates for one key string and say how long it took.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use meridian_ime_dict::Catalog;
use meridian_ime_engine::{CandidateSource, Engine, MemoryLearner, Query, SpanCache};
use meridian_ime_proto::PreeditKind;

use crate::Args;

const DEFAULT_LIMIT: usize = 20;

pub fn run(args: &[String]) -> Result<(), String> {
    let args = Args::parse(args)?;
    let keys = args
        .positional
        .first()
        .ok_or("lookup needs a key string, e.g. `lookup nihao`")?
        .clone();
    let limit = match args.flag("limit") {
        Some(s) => s
            .parse::<usize>()
            .map_err(|_| format!("--limit needs a number, got {s:?}"))?,
        None => DEFAULT_LIMIT,
    };
    let scheme = args.scheme()?;
    let data_dir = args.data_dir()?;
    let (engine, names) = open_engine(&data_dir)?;
    let learner = MemoryLearner::new();
    let mut cache = SpanCache::new();

    let started = Instant::now();
    let query = engine.query(&keys, scheme, &learner, &mut cache);
    let elapsed = started.elapsed();

    println!("dictionaries: {}", names.join(", "));
    println!("preedit: {}", preedit_line(&query));
    if query.candidates.is_empty() {
        println!("(no candidates)");
    }
    for (i, c) in query.candidates.iter().take(limit).enumerate() {
        println!(
            "{:>3}. {}  [{}] {:.3} consumed={}",
            i + 1,
            c.text,
            source_name(c.source),
            c.score,
            c.consumed
        );
    }
    println!("{} candidates in {:.2?}", query.candidates.len(), elapsed);
    Ok(())
}

/// Every `.mdict` under `<data-dir>/dicts`, in name order, as one engine.
/// Returns the names beside it for the report line.
///
/// The catalog (`meridian_ime_dict::catalog`) is still a placeholder, so the
/// files are opened directly; once `Catalog::load(..).open_all(..)` exists this
/// should go through it so disabled dictionaries stay out.
pub(crate) fn open_engine(data_dir: &Path) -> Result<(Engine, Vec<String>), String> {
    let dicts_dir = data_dir.join("dicts");
    let catalog = Catalog::load(&dicts_dir).map_err(|e| format!("cannot read the dictionary catalog: {e}"))?;
    let (set, failures) = catalog.open_all_report(&dicts_dir);
    for (file, err) in &failures {
        eprintln!("warning: {file}: {err}");
    }
    let names: Vec<String> = catalog
        .entries
        .iter()
        .filter(|e| e.enabled)
        .map(|e| format!("{} ({} entries)", e.name, e.entries))
        .collect();
    if set.is_empty() {
        return Err(format!(
            "no dictionary in {}; import one first: meridian-ime import <file.dict.yaml> --data-dir {}",
            dicts_dir.display(),
            data_dir.display()
        ));
    }
    Ok((Engine::new(Arc::new(set)), names))
}

/// The preedit as one line, with a syllable still being typed marked `…`.
pub(crate) fn preedit_line(query: &Query) -> String {
    let mut s = String::new();
    for seg in &query.preedit {
        s.push_str(&seg.text);
        if seg.kind == PreeditKind::Partial {
            s.push('…');
        }
    }
    s
}

pub(crate) fn source_name(source: CandidateSource) -> &'static str {
    match source {
        CandidateSource::Dict => "dict",
        CandidateSource::User => "user",
        CandidateSource::Sentence => "sentence",
    }
}
