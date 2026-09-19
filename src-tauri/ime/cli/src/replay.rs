//! `type` and `repl`: drive the session state machine from a key script.
//!
//! Prints, per key, what the key did — eaten or passed, committed text, the
//! preedit and the candidate page — which is how a behaviour is checked
//! without an operating system in the loop.

use std::io::BufRead;
use std::sync::Arc;

use meridian_ime_dict::{Catalog, DictSet};
use meridian_ime_engine::{Engine, MemoryLearner};
use meridian_ime_session::{KeyOutcome, Session, SessionConfig, keys::VK_SHIFT, parse_script};

use crate::Args;

pub fn run_script(args: &[String]) -> Result<(), String> {
    let args = Args::parse(args)?;
    let script = args
        .positional
        .first()
        .ok_or("usage: type <script> [--data-dir D] [--scheme S]")?;
    let (engine, mut session) = setup(&args)?;
    let mut learner = MemoryLearner::new();
    replay(&engine, &mut session, &mut learner, script)
}

pub fn run_repl(args: &[String]) -> Result<(), String> {
    let args = Args::parse(args)?;
    let (engine, mut session) = setup(&args)?;
    let mut learner = MemoryLearner::new();
    eprintln!("one key script per line; empty line resets the session; Ctrl+D ends");
    for line in std::io::stdin().lock().lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            session.reset();
            println!("(reset)");
            continue;
        }
        if let Err(e) = replay(&engine, &mut session, &mut learner, line.trim()) {
            eprintln!("error: {e}");
        }
    }
    Ok(())
}

fn setup(args: &Args) -> Result<(Arc<Engine>, Session), String> {
    let data_dir = args.data_dir()?;
    let dirs = meridian_ime_config::ImeDirs::new(&data_dir);
    let set: DictSet = match Catalog::load(&dirs.dicts()) {
        Ok(catalog) => catalog.open_all(&dirs.dicts()),
        Err(e) => return Err(format!("cannot read the dictionary catalog: {e}")),
    };
    let engine = Arc::new(Engine::new(Arc::new(set)));
    let config = SessionConfig {
        scheme: args.scheme()?,
        ..Default::default()
    };
    Ok((engine, Session::new(config)))
}

fn replay(engine: &Engine, session: &mut Session, learner: &mut MemoryLearner, script: &str) -> Result<(), String> {
    let events = parse_script(script)?;
    for ev in events {
        let label = match ev.ch {
            Some(' ') => "<space>".to_string(),
            Some(c) => c.to_string(),
            None if ev.vk == VK_SHIFT => "<shift>".into(),
            None => format!("<vk {:#x}>", ev.vk),
        };
        let KeyOutcome {
            consumed,
            commit,
            frame,
        } = session.handle_key(engine, learner, ev);
        let mut line = format!("{label:8} {}", if consumed { "eat " } else { "pass" });
        if let Some(c) = commit {
            line.push_str(&format!("  commit={c:?}"));
        }
        if !frame.is_empty() {
            line.push_str(&format!("  preedit={:?}", frame.preedit_text()));
            if !frame.candidates.is_empty() {
                let cands: Vec<String> = frame
                    .candidates
                    .iter()
                    .enumerate()
                    .map(|(i, c)| {
                        let mark = if i == frame.highlight { "*" } else { "" };
                        format!("{}{}{}", i + 1, mark, c.text)
                    })
                    .collect();
                line.push_str(&format!(
                    "  [{}] {}/{}",
                    cands.join(" "),
                    frame.page + 1,
                    frame.page_count
                ));
            }
            if let Some(n) = &frame.notice {
                line.push_str(&format!("  notice={n:?}"));
            }
        }
        println!("{line}");
    }
    Ok(())
}
