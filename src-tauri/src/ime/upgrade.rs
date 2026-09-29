//! Rebuilding dictionaries an older build wrote, when Meridian starts.
//!
//! Here and not in the keyboard: rebuilding rime-ice takes a few hundred
//! megabytes for a few seconds, which the keyboard's process is the one most
//! likely to be killed for. Until it is done the keyboard says what it is
//! waiting for (`DictionaryNotice::NeedsUpgrade`) instead of "import a
//! dictionary".
//!
//! Each file is upgraded under the dictionary write lock, so an import or a
//! removal from the settings page cannot land between reading a file and
//! renaming its replacement over it. The files being worked on are published
//! in `UpgradeProgress` so the dictionary list can say "upgrading" rather than
//! "unreadable" in the meantime; the notice in the inbox says the rest.

use std::collections::HashSet;
use std::sync::Mutex;

use meridian_ime_config::ImeDirs;
use meridian_ime_dict::{Catalog, DictError, DictFile, SyllableTable, Upgrade, upgrade_in_place};

use crate::commands::system_notice::{
    ImeDictionaryUpgradeFailureInfoResponse, ImeDictionaryUpgradeState, SystemNoticeDetail,
};
use crate::system_notice::SystemNotices;

/// Which catalog files are being rebuilt right now.
#[derive(Debug, Default)]
pub struct UpgradeProgress {
    files: Mutex<HashSet<String>>,
}

impl UpgradeProgress {
    pub fn is_upgrading(&self, file: &str) -> bool {
        self.lock().contains(file)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashSet<String>> {
        self.files.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// What a run did, for the log and the tests.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct UpgradeRun {
    pub upgraded: Vec<String>,
    pub failed: Vec<(String, String)>,
}

/// Upgrades every listed dictionary that needs it. Nothing to do is nothing
/// said: a notice appears only when there was something to upgrade.
pub fn run(
    dirs: &ImeDirs,
    writes: &Mutex<()>,
    progress: &UpgradeProgress,
    notices: &SystemNotices,
    nudge: impl Fn(),
) -> UpgradeRun {
    let dicts = dirs.dicts();
    let catalog = match Catalog::load(&dicts) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "dictionary catalog unreadable; nothing upgraded");
            return UpgradeRun::default();
        }
    };
    let pending: Vec<(String, String)> = catalog
        .entries
        .iter()
        .filter(|e| {
            matches!(
                DictFile::check_version(&dicts.join(&e.file)),
                Err(DictError::NeedsUpgrade(_))
            )
        })
        .map(|e| (e.file.clone(), e.name.clone()))
        .collect();
    if pending.is_empty() {
        return UpgradeRun::default();
    }

    progress.lock().extend(pending.iter().map(|(file, _)| file.clone()));
    let names: Vec<String> = pending.iter().map(|(_, name)| name.clone()).collect();
    let detail = |state, run: &UpgradeRun| SystemNoticeDetail::ImeDictionaryUpgrade {
        state,
        dictionaries: names.clone(),
        upgraded: run.upgraded.len() as u32,
        failures: run
            .failed
            .iter()
            .map(|(name, error)| ImeDictionaryUpgradeFailureInfoResponse {
                name: name.clone(),
                error: error.clone(),
            })
            .collect(),
    };
    let mut run = UpgradeRun::default();
    let id = notices.start(detail(ImeDictionaryUpgradeState::Running, &run));
    let table = SyllableTable::new();

    for (file, name) in pending {
        let outcome = {
            let _guard = writes.lock().unwrap_or_else(|p| p.into_inner());
            // Removed from the settings page while waiting for the lock.
            match Catalog::load(&dicts) {
                Ok(c) if c.get(&file).is_some() => Some(upgrade_in_place(&dicts.join(&file), &table)),
                _ => None,
            }
        };
        progress.lock().remove(&file);
        match outcome {
            Some(Ok(Upgrade::Upgraded { from, entries })) => {
                tracing::info!(file, from, entries, "dictionary upgraded");
                run.upgraded.push(name);
                nudge();
            }
            Some(Ok(Upgrade::Current { .. })) | None => {}
            Some(Err(e)) => {
                tracing::warn!(file, error = %e, "dictionary not upgraded");
                run.failed.push((name, e.to_string()));
            }
        }
        notices.update(&id, detail(ImeDictionaryUpgradeState::Running, &run), false);
    }

    let state = if run.failed.is_empty() {
        ImeDictionaryUpgradeState::Succeeded
    } else {
        ImeDictionaryUpgradeState::Failed
    };
    notices.update(&id, detail(state, &run), true);
    run
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use meridian_ime_dict::CatalogEntry;

    use super::*;
    use crate::commands::system_notice::SystemNoticeEvent;

    /// Written by the version 1 writer; see `meridian-ime-dict`'s upgrade tests.
    const V1: &[u8] = include_bytes!("../../ime/dict/tests/fixtures/v1.mdict");

    fn listed(dirs: &ImeDirs, files: &[(&str, &[u8])]) {
        dirs.ensure().unwrap();
        let mut catalog = Catalog::default();
        for (i, (file, bytes)) in files.iter().enumerate() {
            std::fs::write(dirs.dicts().join(file), bytes).unwrap();
            catalog.upsert(CatalogEntry {
                file: (*file).into(),
                name: file.trim_end_matches(".mdict").into(),
                enabled: true,
                priority: i as i32,
                entries: 18,
                license: "CC0-1.0".into(),
                imported_unix: 0,
            });
        }
        catalog.save(&dirs.dicts()).unwrap();
    }

    /// The fixture with its metadata claiming one entry more than it holds:
    /// it passes the header check and fails the upgrade's own count.
    fn damaged_v1() -> Vec<u8> {
        let mut bytes = V1.to_vec();
        let needle = b"entries = 18";
        let at = bytes.windows(needle.len()).position(|w| w == needle).unwrap();
        bytes[at + needle.len() - 1] = b'9';
        bytes
    }

    fn recorder() -> (SystemNotices, Arc<Mutex<Vec<SystemNoticeEvent>>>) {
        let seen: Arc<Mutex<Vec<SystemNoticeEvent>>> = Arc::default();
        let r = seen.clone();
        (SystemNotices::new(move |e| r.lock().unwrap().push(e.clone())), seen)
    }

    #[test]
    fn nothing_to_upgrade_says_nothing() {
        let root = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(root.path());
        dirs.ensure().unwrap();
        let (notices, seen) = recorder();
        let run = run(&dirs, &Mutex::new(()), &UpgradeProgress::default(), &notices, || {});
        assert_eq!(run, UpgradeRun::default());
        assert!(seen.lock().unwrap().is_empty());
        assert!(notices.list().is_empty());
    }

    #[test]
    fn upgrades_what_it_can_and_names_what_it_could_not() {
        let root = tempfile::tempdir().unwrap();
        let dirs = ImeDirs::new(root.path());
        let damaged = damaged_v1();
        listed(&dirs, &[("good.mdict", V1), ("bad.mdict", &damaged)]);
        let (notices, _) = recorder();
        let progress = UpgradeProgress::default();
        let nudged = Mutex::new(0);
        let run = run(&dirs, &Mutex::new(()), &progress, &notices, || {
            *nudged.lock().unwrap() += 1
        });

        assert_eq!(run.upgraded, vec!["good".to_string()]);
        assert_eq!(run.failed.len(), 1);
        assert_eq!(run.failed[0].0, "bad");
        assert_eq!(*nudged.lock().unwrap(), 1, "the host is told once per upgraded file");
        assert!(!progress.is_upgrading("good.mdict") && !progress.is_upgrading("bad.mdict"));
        assert!(DictFile::open(&dirs.dicts().join("good.mdict")).is_ok());
        assert_eq!(
            std::fs::read(dirs.dicts().join("bad.mdict")).unwrap(),
            damaged,
            "left as it was"
        );

        let list = notices.list();
        assert_eq!(list.len(), 1);
        assert!(list[0].finished_at.is_some());
        let SystemNoticeDetail::ImeDictionaryUpgrade {
            state,
            dictionaries,
            upgraded,
            failures,
        } = &list[0].detail;
        assert_eq!(*state, ImeDictionaryUpgradeState::Failed);
        assert_eq!(dictionaries, &vec!["good".to_string(), "bad".to_string()]);
        assert_eq!(*upgraded, 1);
        assert_eq!(failures[0].name, "bad");
    }
}
