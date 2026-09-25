//! `meridian-ime`: the input method without an operating system around it.
//!
//! Every subcommand drives the same crates the host does, so a dictionary
//! import, a lookup or a replayed key script can be checked from a terminal
//! on any platform.

mod bench;
mod dicts;
mod import;
mod keys;
mod lookup;
mod replay;

use std::process::ExitCode;

const USAGE: &str = "\
meridian-ime <command> [args]

  import <file.dict.yaml> [--data-dir <dir>] [--license <SPDX>] [--name <name>]
                              import a Rime dictionary into <data-dir>/dicts
  dicts  [--data-dir <dir>]   list imported dictionaries
  lookup <keys> [--data-dir <dir>] [--scheme pinyin|zhuyin|grid] [--limit N]
                              rank candidates for a key string
  bench  [--data-dir <dir>] [--scheme S] [--cases <file.tsv> | --eval <eval.tsv>]
         [--tones all|none|random[:seed]] [--habit pinyin|zhuyin] [--page-size N]
         [--lm <bundle dir> [--ort <onnxruntime lib>] [--budget-ms N]]
                              top-1/top-3, keystrokes per character and cache misses per key
  keys   \"ni3 hao3\" [--scheme S] [--tones ...] [--labels true]
                              the keys a scheme types for toned pinyin
  type   <script> [--data-dir <dir>] [--scheme pinyin|zhuyin|grid]
                              replay a key script through the session state machine
  repl   [--data-dir <dir>] [--scheme pinyin|zhuyin|grid]
                              read key scripts from stdin, one per line

<data-dir> defaults to $MERIDIAN_IME_DATA_DIR, then the app data directory.
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first() else {
        eprint!("{USAGE}");
        return ExitCode::from(2);
    };
    let rest = &args[1..];
    let result = match cmd.as_str() {
        "import" => import::run(rest),
        "dicts" => dicts::run(rest),
        "lookup" => lookup::run(rest),
        "bench" => bench::run(rest),
        "keys" => keys::run(rest),
        "type" => replay::run_script(rest),
        "repl" => replay::run_repl(rest),
        "-h" | "--help" | "help" => {
            print!("{USAGE}");
            Ok(())
        }
        other => Err(format!("unknown command {other:?}\n{USAGE}")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Shared flag parsing: `--key value` pairs and positionals.
pub(crate) struct Args {
    pub positional: Vec<String>,
    pub flags: Vec<(String, String)>,
}

impl Args {
    pub fn parse(args: &[String]) -> Result<Self, String> {
        let mut positional = Vec::new();
        let mut flags = Vec::new();
        let mut i = 0;
        while i < args.len() {
            let a = &args[i];
            if let Some(name) = a.strip_prefix("--") {
                let value = args.get(i + 1).ok_or_else(|| format!("--{name} needs a value"))?;
                flags.push((name.to_string(), value.clone()));
                i += 2;
            } else {
                positional.push(a.clone());
                i += 1;
            }
        }
        Ok(Self { positional, flags })
    }

    pub fn flag(&self, name: &str) -> Option<&str> {
        self.flags
            .iter()
            .rev()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    /// The data directory: `--data-dir`, else the configured default.
    pub fn data_dir(&self) -> Result<std::path::PathBuf, String> {
        if let Some(d) = self.flag("data-dir") {
            return Ok(std::path::PathBuf::from(d));
        }
        meridian_ime_config::default_ime_dir()
            .ok_or_else(|| "no data directory on this platform; pass --data-dir".to_string())
    }

    pub fn scheme(&self) -> Result<meridian_ime_engine::InputScheme, String> {
        match self.flag("scheme").unwrap_or("pinyin") {
            "pinyin" => Ok(meridian_ime_engine::InputScheme::Pinyin),
            "zhuyin" => Ok(meridian_ime_engine::InputScheme::Zhuyin),
            "grid" => Ok(meridian_ime_engine::InputScheme::Grid),
            other => Err(format!("unknown scheme {other:?}")),
        }
    }
}
