//! `learn export` / `learn merge`: the four TSV tables without a settings page.
//!
//! Export writes the tables as they sit on disk. Merge files a request the
//! host/keyboard carries out, unless `--apply true` writes them now — only
//! then, and only when nothing else holds the store.

use std::path::PathBuf;

use meridian_ime_config::{ImeDirs, MergeKind, request_merge};
use meridian_ime_engine::{FileLearner, Learner};

use crate::Args;

pub fn run(args: &[String]) -> Result<(), String> {
    let args = Args::parse(args)?;
    let Some(sub) = args.positional.first() else {
        return Err("usage: learn export [--data-dir D] [--out DIR]\n       learn merge --add|--replace PATH [--data-dir D] [--apply true]".into());
    };
    match sub.as_str() {
        "export" => export(&args),
        "merge" => merge(&args),
        other => Err(format!("unknown learn command {other:?}")),
    }
}

fn dirs(args: &Args) -> Result<ImeDirs, String> {
    Ok(ImeDirs::new(args.data_dir()?))
}

fn export(args: &Args) -> Result<(), String> {
    let dirs = dirs(args)?;
    let out = args
        .flag("out")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs.root.join("learn-export"));
    let tables = FileLearner::read(&dirs.learn()).map_err(|e| e.to_string())?;
    FileLearner::write_tables(&out, &tables).map_err(|e| e.to_string())?;
    println!("{}", out.display());
    Ok(())
}

fn merge(args: &Args) -> Result<(), String> {
    let dirs = dirs(args)?;
    let kind = if args.flag("add").is_some() {
        MergeKind::Add
    } else if args.flag("replace").is_some() {
        MergeKind::Replace
    } else {
        return Err("pass --add PATH or --replace PATH".into());
    };
    let path = args
        .flag("add")
        .or_else(|| args.flag("replace"))
        .map(PathBuf::from)
        .ok_or("pass --add PATH or --replace PATH")?;
    if !path.is_dir() {
        return Err(format!("{} is not a directory of learned tables", path.display()));
    }
    FileLearner::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let apply = matches!(args.flag("apply"), Some("true" | "1" | "yes"));
    if apply {
        let mut learner = FileLearner::open(&dirs.learn()).map_err(|e| e.to_string())?;
        let incoming = FileLearner::read(&path).map_err(|e| e.to_string())?;
        if kind == MergeKind::Replace {
            learner.erase_all();
        }
        learner.absorb(&incoming);
        learner.flush();
        if learner.unsaved() {
            return Err("merged in memory but could not write the tables".into());
        }
        println!("applied {}", path.display());
        return Ok(());
    }
    request_merge(&dirs, kind, &path).map_err(|e| e.to_string())?;
    println!("filed; the host or keyboard will apply it");
    Ok(())
}
