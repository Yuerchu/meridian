//! `import <file.dict.yaml> [--data-dir D] [--license X] [--name N]`: a Rime
//! dictionary into `<data-dir>/dicts`, listed in the catalog.

use std::path::Path;
use std::time::{Duration, Instant};

use meridian_ime_config::ImeDirs;
use meridian_ime_dict::{
    Catalog, CatalogEntry, DictFile, FileReport, ImportError, ImportOptions, ImportReport, SyllableTable, rime,
};

use crate::Args;

pub fn run(args: &[String]) -> Result<(), String> {
    let args = Args::parse(args)?;
    let Some(file) = args.positional.first() else {
        return Err("import needs a file: import <file.dict.yaml> [--data-dir <dir>]".into());
    };
    let source = Path::new(file);
    let dirs = ImeDirs::new(args.data_dir()?);
    dirs.ensure()
        .map_err(|e| format!("cannot create {}: {e}", dirs.root.display()))?;
    let dicts_dir = dirs.dicts();
    let opts = ImportOptions {
        license: args.flag("license").map(str::to_string),
        attribution: None,
        name: args.flag("name").map(str::to_string),
    };
    let table = SyllableTable::new();

    let started = Instant::now();
    let report = match rime::import(source, &dicts_dir, &opts, &table) {
        Ok(r) => r,
        Err(ImportError::NoUsableEntries(r)) => {
            print_report(&r, source, started.elapsed());
            return Err("no usable entries; nothing was written".into());
        }
        Err(e) => return Err(e.to_string()),
    };
    let elapsed = started.elapsed();

    let dict = DictFile::open(&report.output).map_err(|e| format!("{}: {e}", report.output.display()))?;
    let mut catalog = Catalog::load(&dicts_dir).map_err(|e| e.to_string())?;
    let mut entry = CatalogEntry::from_report(&report, dict.meta());
    if let Some(existing) = catalog.get(&entry.file) {
        entry.enabled = existing.enabled;
        entry.priority = existing.priority;
    } else {
        entry.priority = catalog.entries.len() as i32;
    }
    catalog.upsert(entry);
    catalog
        .save(&dicts_dir)
        .map_err(|e| format!("cannot write catalog: {e}"))?;

    print_report(&report, source, elapsed);
    println!(
        "catalog: {} ({} dictionaries listed)",
        dicts_dir.join("catalog.toml").display(),
        catalog.entries.len()
    );
    Ok(())
}

fn print_report(report: &ImportReport, source: &Path, elapsed: Duration) {
    let root_dir = source.parent().unwrap_or_else(|| Path::new(""));
    let width = report
        .files
        .iter()
        .map(|f| relative(&f.path, root_dir).chars().count())
        .max()
        .unwrap_or(0)
        .max(8);
    for f in &report.files {
        println!(
            "{:<width$}  {}",
            relative(&f.path, root_dir),
            file_line(f),
            width = width
        );
    }
    let s = &report.skipped;
    println!();
    println!(
        "total: accepted {}, duplicates {}, skipped {}{}",
        report.accepted,
        report.duplicates,
        s.total(),
        skip_detail(s)
    );
    println!("name: {}", report.name);
    println!(
        "output: {}{}",
        report.output.display(),
        if report.cache_hit { " (cache hit)" } else { "" }
    );
    println!("cache key: {}", report.cache_key);
    println!("elapsed: {:.2}s", elapsed.as_secs_f64());
}

fn file_line(f: &FileReport) -> String {
    match &f.reason {
        Some(reason) => format!("skipped: {reason} ({} rows)", f.rows),
        None => format!(
            "rows {:>8}  accepted {:>8}{}",
            f.rows,
            f.accepted,
            skip_detail(&f.skipped)
        ),
    }
}

fn skip_detail(s: &meridian_ime_dict::SkipCounts) -> String {
    let parts: Vec<String> = [
        ("no_code", s.no_code),
        ("invalid_syllable", s.invalid_syllable),
        ("unspaced_code", s.unspaced_code),
        ("empty_text", s.empty_text),
        ("ascii_text", s.ascii_text),
        ("malformed", s.malformed),
        ("bad_weight", s.bad_weight),
    ]
    .iter()
    .filter(|(_, n)| *n > 0)
    .map(|(name, n)| format!("{name} {n}"))
    .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!("  ({})", parts.join(", "))
    }
}

fn relative(path: &Path, root_dir: &Path) -> String {
    path.strip_prefix(root_dir).unwrap_or(path).display().to_string()
}
