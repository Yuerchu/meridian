//! `keys`: the key string a scheme types for toned pinyin.
//!
//! The training repository derives the same strings from the evaluation set
//! and compares them byte for byte against this output, which is what keeps
//! the grid tables identical on both sides. `--labels` prints what a person
//! would see instead of the private-use keys.

use meridian_ime_dict::SyllableTable;
use meridian_ime_engine::{grid_label, keys_for_habit};

use crate::Args;
use crate::bench::{spelling_habit, tone_policy};

pub fn run(args: &[String]) -> Result<(), String> {
    let args = Args::parse(args)?;
    let scheme = args.scheme()?;
    let policy = tone_policy(args.flag("tones"))?;
    let habit = spelling_habit(args.flag("habit"))?;
    let labels = matches!(args.flag("labels"), Some("true" | "1" | "yes"));
    if args.positional.is_empty() {
        return Err("usage: keys \"ni3 hao3\" [--scheme S] [--tones all|none|random[:seed]] [--labels true]".into());
    }
    let table = SyllableTable::new();
    let keys = keys_for_habit(scheme, &args.positional.join(" "), policy, habit, &table)?;
    if labels {
        println!("{}", keys.chars().map(grid_label).collect::<String>());
    } else {
        println!("{keys}");
    }
    Ok(())
}
