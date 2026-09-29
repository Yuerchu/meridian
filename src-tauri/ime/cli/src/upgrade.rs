//! `upgrade [--data-dir D]`: brings every listed dictionary up to this
//! build's format, the way Meridian does when it starts.

use std::time::Instant;

use meridian_ime_config::ImeDirs;
use meridian_ime_dict::{Catalog, SyllableTable, Upgrade, upgrade_in_place};

use crate::Args;

pub fn run(args: &[String]) -> Result<(), String> {
    let args = Args::parse(args)?;
    let dirs = ImeDirs::new(args.data_dir()?);
    let dicts_dir = dirs.dicts();
    let catalog = Catalog::load(&dicts_dir).map_err(|e| e.to_string())?;
    let table = SyllableTable::new();
    let mut failed = 0;
    for entry in &catalog.entries {
        let started = Instant::now();
        match upgrade_in_place(&dicts_dir.join(&entry.file), &table) {
            Ok(Upgrade::Current { version }) => println!("{}: already version {version}", entry.name),
            Ok(Upgrade::Upgraded { from, entries }) => println!(
                "{}: upgraded from version {from}, {entries} entries in {:.1?}",
                entry.name,
                started.elapsed()
            ),
            Err(e) => {
                failed += 1;
                println!("{}: {e}", entry.name);
            }
        }
    }
    if failed > 0 {
        return Err(format!("{failed} dictionaries could not be upgraded"));
    }
    Ok(())
}
