//! `dicts [--data-dir D]`: the catalog as a table.

use meridian_ime_config::ImeDirs;
use meridian_ime_dict::Catalog;

use crate::Args;

pub fn run(args: &[String]) -> Result<(), String> {
    let args = Args::parse(args)?;
    let dirs = ImeDirs::new(args.data_dir()?);
    let dicts_dir = dirs.dicts();
    let catalog = Catalog::load(&dicts_dir).map_err(|e| e.to_string())?;
    if catalog.entries.is_empty() {
        println!("no dictionaries in {}", dicts_dir.display());
        return Ok(());
    }
    let mut rows: Vec<&meridian_ime_dict::CatalogEntry> = catalog.entries.iter().collect();
    rows.sort_by(|a, b| a.priority.cmp(&b.priority).then_with(|| a.name.cmp(&b.name)));
    let name_w = rows.iter().map(|e| e.name.chars().count()).max().unwrap_or(4).max(4);
    let file_w = rows.iter().map(|e| e.file.chars().count()).max().unwrap_or(4).max(4);
    println!(
        "{:<name_w$}  {:<file_w$}  {:>9}  {:>8}  {:>7}  license",
        "name", "file", "entries", "enabled", "prio"
    );
    for e in rows {
        println!(
            "{:<name_w$}  {:<file_w$}  {:>9}  {:>8}  {:>7}  {}",
            e.name,
            e.file,
            e.entries,
            if e.enabled { "yes" } else { "no" },
            e.priority,
            e.license
        );
    }
    println!("\n{} dictionaries in {}", catalog.entries.len(), dicts_dir.display());
    Ok(())
}
