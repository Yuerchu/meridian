use std::path::PathBuf;

use diesel::sqlite::SqliteConnection;

use crate::ServicesExt;
use crate::agent::skills;
use crate::db;
use crate::db::models::skill::{NewSkill, Skill, SkillUpdate};
use crate::db::models::skill_binding::SkillLayer;
use crate::db::ops::skill_binding::MAX_BINDINGS_PER_ANCHOR;
use crate::util::{get_conn, now_ms};

pub fn skills_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let services = app.services();
    let dir = services.paths.skills_root.clone();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Reconcile the index with what is actually on disk. The filesystem wins:
/// directories that vanished lose their rows (and, by cascade, their bindings).
pub fn sync_index(conn: &mut SqliteConnection, root: &std::path::Path) -> Result<Vec<Skill>, String> {
    let found = skills::scan_skills(root);
    let now = now_ms();

    for meta in &found {
        let source = if crate::agent::is_builtin_skill_dir(&meta.dir_name) {
            "official"
        } else {
            "user"
        };
        let is_builtin = i32::from(source == "official");
        // Display fields default to the LLM-facing ones on first sight; the user
        // can rename them afterwards without a rescan clobbering the change.
        let existing = db::ops::skill::get_skill(conn, &meta.dir_name).ok();
        let display_name = existing
            .as_ref()
            .map(|s| s.display_name.clone())
            .unwrap_or_else(|| meta.llm_name.clone());
        let display_description = existing.as_ref().and_then(|s| s.display_description.clone());

        db::ops::skill::upsert_skill(
            conn,
            &NewSkill {
                dir_name: &meta.dir_name,
                llm_name: &meta.llm_name,
                llm_description: &meta.llm_description,
                display_name: &display_name,
                display_description: display_description.as_deref(),
                source,
                is_enabled: 1,
                is_builtin,
                mtime_hash: Some(&meta.mtime_hash),
                created_at: now,
                updated_at: now,
            },
        )
        .map_err(|e| e.to_string())?;
    }

    // A directory that cannot be read scans as empty, and `delete_missing` with
    // an empty list deletes every row — taking all bindings with it by cascade.
    // Guarding the destructive half means a transient read failure costs one
    // launch's listing rather than the user's whole skill library.
    if found.is_empty() && std::fs::read_dir(root).is_err() {
        tracing::error!(
            skills_root = %root.display(),
            "skills directory unreadable; keeping the existing index rather than clearing it"
        );
        return db::ops::skill::list_skills(conn).map_err(|e| e.to_string());
    }

    let present: Vec<String> = found.iter().map(|m| m.dir_name.clone()).collect();
    let removed = db::ops::skill::delete_missing(conn, &present).map_err(|e| e.to_string())?;
    if removed > 0 {
        tracing::info!(
            rows_deleted = removed,
            scanned = found.len(),
            "dropped skills that are no longer on disk"
        );
    }
    db::ops::skill::list_skills(conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_skills(app: tauri::AppHandle) -> Result<Vec<Skill>, String> {
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::skill::list_skills(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rescan_skills(app: tauri::AppHandle) -> Result<Vec<Skill>, String> {
    let root = skills_root(&app)?;
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    sync_index(&mut conn, &root)
}

#[tauri::command]
pub fn get_skill_body(app: tauri::AppHandle, dir_name: String) -> Result<String, String> {
    let root = skills_root(&app)?;
    skills::read_skill_body(&root, &dir_name).ok_or_else(|| format!("skill '{dir_name}' has no readable SKILL.md"))
}

#[tauri::command]
pub fn create_skill(
    app: tauri::AppHandle,
    dir_name: String,
    llm_description: String,
    body: String,
    display_name: Option<String>,
) -> Result<Skill, String> {
    let root = skills_root(&app)?;
    if root.join(&dir_name).exists() {
        return Err(format!("A skill directory named '{dir_name}' already exists"));
    }
    // Directory name doubles as the LLM-facing name: one identifier, so the two
    // can never drift apart.
    skills::write_skill_file(&root, &dir_name, &dir_name, &llm_description, &body)?;

    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    sync_index(&mut conn, &root)?;

    if let Some(name) = display_name.filter(|n| !n.trim().is_empty()) {
        db::ops::skill::update_skill(
            &mut conn,
            &dir_name,
            &SkillUpdate {
                display_name: Some(name),
                updated_at: Some(now_ms()),
                ..Default::default()
            },
        )
        .map_err(|e| e.to_string())?;
    }
    db::ops::skill::get_skill(&mut conn, &dir_name).map_err(|e| e.to_string())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPatch {
    display_name: Option<String>,
    llm_description: Option<String>,
    body: Option<String>,
    is_enabled: Option<bool>,
}

#[tauri::command]
pub fn update_skill(app: tauri::AppHandle, dir_name: String, updates: SkillPatch) -> Result<Skill, String> {
    let root = skills_root(&app)?;
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    let current = db::ops::skill::get_skill(&mut conn, &dir_name).map_err(|e| e.to_string())?;

    if updates.llm_description.is_some() || updates.body.is_some() {
        if current.is_builtin == 1 {
            return Err(format!(
                "'{dir_name}' is generated by Meridian; its contents are rewritten on every launch"
            ));
        }
        let description = updates
            .llm_description
            .clone()
            .unwrap_or_else(|| current.llm_description.clone());
        let body = match updates.body.clone() {
            Some(b) => b,
            None => skills::read_skill_body(&root, &dir_name).unwrap_or_default(),
        };
        skills::write_skill_file(&root, &dir_name, &current.llm_name, &description, &body)?;
        sync_index(&mut conn, &root)?;
    }

    db::ops::skill::update_skill(
        &mut conn,
        &dir_name,
        &SkillUpdate {
            display_name: updates.display_name,
            is_enabled: updates.is_enabled.map(i32::from),
            updated_at: Some(now_ms()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_skill(app: tauri::AppHandle, dir_name: String) -> Result<(), String> {
    let root = skills_root(&app)?;
    let services = app.services();
    let mut conn = get_conn(&services.db)?;

    // Enforced here and not only in the UI: the frontend hiding a button is not
    // a guarantee, and a regenerated skill would reappear anyway.
    let skill = db::ops::skill::get_skill(&mut conn, &dir_name).map_err(|e| e.to_string())?;
    if skill.is_builtin == 1 {
        return Err(format!("'{dir_name}' is a built-in skill and cannot be deleted"));
    }

    skills::delete_skill_dir(&root, &dir_name)?;
    db::ops::skill::delete_skill(&mut conn, &dir_name).map_err(|e| e.to_string())
}

fn parse_layer(layer: &str) -> Result<SkillLayer, String> {
    match layer {
        "global" => Ok(SkillLayer::Global),
        "project" => Ok(SkillLayer::Project),
        "assistant" => Ok(SkillLayer::Assistant),
        other => Err(format!("unknown skill binding layer '{other}'")),
    }
}

#[tauri::command]
pub fn list_skill_bindings(
    app: tauri::AppHandle,
    layer: String,
    anchor_id: Option<String>,
) -> Result<Vec<String>, String> {
    let layer = parse_layer(&layer)?;
    let services = app.services();
    let mut conn = get_conn(&services.db)?;
    db::ops::skill_binding::list_layer(&mut conn, layer, anchor_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_skill_binding(
    app: tauri::AppHandle,
    layer: String,
    anchor_id: Option<String>,
    dir_name: String,
    bound: bool,
) -> Result<Vec<String>, String> {
    let layer = parse_layer(&layer)?;
    if layer != SkillLayer::Global && anchor_id.is_none() {
        return Err(format!("binding at the {} layer needs an anchor id", layer.as_str()));
    }
    let services = app.services();
    let mut conn = get_conn(&services.db)?;

    if bound {
        // Each binding costs context on every request, so the cap is per anchor
        // rather than a global storage limit.
        let count =
            db::ops::skill_binding::count_layer(&mut conn, layer, anchor_id.as_deref()).map_err(|e| e.to_string())?;
        if count >= MAX_BINDINGS_PER_ANCHOR {
            return Err(format!(
                "At most {MAX_BINDINGS_PER_ANCHOR} skills can be bound here; each one costs context on every message"
            ));
        }
        db::ops::skill_binding::bind(&mut conn, layer, anchor_id.as_deref(), &dir_name).map_err(|e| e.to_string())?;
    } else {
        db::ops::skill_binding::unbind(&mut conn, layer, anchor_id.as_deref(), &dir_name).map_err(|e| e.to_string())?;
    }

    db::ops::skill_binding::list_layer(&mut conn, layer, anchor_id.as_deref()).map_err(|e| e.to_string())
}

fn autobind_key(dir_name: &str) -> String {
    format!("skills.autobind.{dir_name}")
}

/// Bind each built-in skill globally, once ever.
///
/// Indexing a skill does not make it visible: the model only sees skills that
/// are bound, and with none bound the `load_skill` tool disappears entirely, so
/// an unbound built-in is indistinguishable from one that does not exist.
///
/// The per-skill flag is what makes an unbind stick — the user takes it away,
/// the flag stays set, and the next launch does not put it back. A single global
/// "seeded" flag would instead mean a built-in added in a later version could
/// never seed itself on an existing install.
///
/// Must run after `sync_index`: the binding tables carry a foreign key onto
/// `skills.dir_name`, and that row is what `sync_index` creates.
pub fn seed_builtin_bindings(conn: &mut SqliteConnection) {
    for dir_name in crate::agent::BUILTIN_SKILL_DIRS {
        let key = autobind_key(dir_name);
        let already_seeded = db::ops::preference::get_preference(conn, &key).ok().flatten().is_some();
        if already_seeded {
            continue;
        }
        // The flag is written only once the binding lands, so a bind that failed
        // because indexing did not happen retries on the next launch instead of
        // being skipped for good. Deliberately skips the per-anchor cap that the
        // command layer enforces: two built-ins are not what that limit is for.
        if db::ops::skill_binding::bind(conn, SkillLayer::Global, None, dir_name).is_ok() {
            let _ = db::ops::preference::set_preference(conn, &key, "1", now_ms());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn sync_indexes_disk_and_drops_vanished_skills() {
        let dir = tempfile::tempdir().unwrap();
        skills::write_skill_file(dir.path(), "one", "one", "First", "b").unwrap();
        skills::write_skill_file(dir.path(), "two", "two", "Second", "b").unwrap();

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let indexed = sync_index(&mut conn, dir.path()).unwrap();
        assert_eq!(indexed.len(), 2);

        skills::delete_skill_dir(dir.path(), "two").unwrap();
        let after = sync_index(&mut conn, dir.path()).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].dir_name, "one");
    }

    /// An unreadable directory scans as empty, and an empty scan used to mean
    /// "delete everything" — one bad launch would take the whole library and,
    /// by cascade, every binding.
    #[test]
    fn an_unreadable_skills_directory_does_not_wipe_the_index() {
        let dir = tempfile::tempdir().unwrap();
        skills::write_skill_file(dir.path(), "one", "one", "First", "b").unwrap();

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        assert_eq!(sync_index(&mut conn, dir.path()).unwrap().len(), 1);

        // Unmounted volume, revoked permissions, a path that moved.
        let gone = dir.path().join("not-here");
        let after = sync_index(&mut conn, &gone).unwrap();

        assert_eq!(after.len(), 1, "the index was cleared by a directory it could not read");
    }

    /// The guard must not overreach: a readable directory that is genuinely
    /// empty still means the skills are gone.
    #[test]
    fn an_empty_but_readable_directory_still_clears_the_index() {
        let dir = tempfile::tempdir().unwrap();
        skills::write_skill_file(dir.path(), "one", "one", "First", "b").unwrap();

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        sync_index(&mut conn, dir.path()).unwrap();

        let empty = tempfile::tempdir().unwrap();
        let after = sync_index(&mut conn, empty.path()).unwrap();

        assert!(after.is_empty(), "{after:?}");
    }

    #[test]
    fn sync_picks_up_edited_descriptions() {
        let dir = tempfile::tempdir().unwrap();
        skills::write_skill_file(dir.path(), "s", "s", "Before", "b").unwrap();

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        sync_index(&mut conn, dir.path()).unwrap();

        skills::write_skill_file(dir.path(), "s", "s", "After", "b").unwrap();
        let after = sync_index(&mut conn, dir.path()).unwrap();
        assert_eq!(after[0].llm_description, "After");
    }

    #[test]
    fn sync_preserves_a_renamed_display_name() {
        let dir = tempfile::tempdir().unwrap();
        skills::write_skill_file(dir.path(), "s", "s", "D", "b").unwrap();

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        sync_index(&mut conn, dir.path()).unwrap();
        db::ops::skill::update_skill(
            &mut conn,
            "s",
            &SkillUpdate {
                display_name: Some("我的技能".into()),
                ..Default::default()
            },
        )
        .unwrap();

        let after = sync_index(&mut conn, dir.path()).unwrap();
        assert_eq!(after[0].display_name, "我的技能");
    }

    #[test]
    fn the_generated_manual_is_marked_builtin() {
        let dir = tempfile::tempdir().unwrap();
        crate::agent::manual::write_manual(dir.path(), &[]).unwrap();

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let indexed = sync_index(&mut conn, dir.path()).unwrap();

        assert_eq!(indexed.len(), 1);
        assert_eq!(indexed[0].source, "official");
        assert_eq!(indexed[0].is_builtin, 1);
    }

    #[test]
    fn the_diagnostics_skill_is_recognised_as_official_too() {
        let dir = tempfile::tempdir().unwrap();
        crate::agent::diagnostics::write_diagnostics(dir.path()).unwrap();

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        let indexed = sync_index(&mut conn, dir.path()).unwrap();

        assert_eq!(indexed.len(), 1);
        assert_eq!(indexed[0].is_builtin, 1);
    }

    #[test]
    fn built_in_skills_are_bound_on_first_launch() {
        let dir = tempfile::tempdir().unwrap();
        crate::agent::manual::write_manual(dir.path(), &[]).unwrap();
        crate::agent::diagnostics::write_diagnostics(dir.path()).unwrap();

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        sync_index(&mut conn, dir.path()).unwrap();
        seed_builtin_bindings(&mut conn);

        let bound = db::ops::skill_binding::list_layer(&mut conn, SkillLayer::Global, None).unwrap();
        for dir_name in crate::agent::BUILTIN_SKILL_DIRS {
            assert!(bound.iter().any(|b| b == dir_name), "{dir_name} not bound: {bound:?}");
        }
    }

    /// The point of the per-skill flag: seeding is a one-time nudge, not a
    /// policy the app re-enforces on every launch.
    #[test]
    fn unbinding_a_built_in_skill_survives_the_next_launch() {
        let dir = tempfile::tempdir().unwrap();
        crate::agent::diagnostics::write_diagnostics(dir.path()).unwrap();

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        sync_index(&mut conn, dir.path()).unwrap();
        seed_builtin_bindings(&mut conn);

        db::ops::skill_binding::unbind(
            &mut conn,
            SkillLayer::Global,
            None,
            crate::agent::diagnostics::DIAGNOSTICS_DIR,
        )
        .unwrap();

        seed_builtin_bindings(&mut conn);

        let bound = db::ops::skill_binding::list_layer(&mut conn, SkillLayer::Global, None).unwrap();
        assert!(
            !bound.iter().any(|b| b == crate::agent::diagnostics::DIAGNOSTICS_DIR),
            "the skill came back after being unbound: {bound:?}"
        );
    }

    /// A bind that could not land must not burn its flag, or the skill would
    /// never be seeded again.
    #[test]
    fn a_failed_bind_is_retried_on_the_next_launch() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();

        // No sync_index, so there is no skills row for the foreign key.
        seed_builtin_bindings(&mut conn);
        let bound = db::ops::skill_binding::list_layer(&mut conn, SkillLayer::Global, None).unwrap();
        assert!(bound.is_empty(), "{bound:?}");

        let dir = tempfile::tempdir().unwrap();
        crate::agent::diagnostics::write_diagnostics(dir.path()).unwrap();
        sync_index(&mut conn, dir.path()).unwrap();
        seed_builtin_bindings(&mut conn);

        let bound = db::ops::skill_binding::list_layer(&mut conn, SkillLayer::Global, None).unwrap();
        assert!(
            bound.iter().any(|b| b == crate::agent::diagnostics::DIAGNOSTICS_DIR),
            "{bound:?}"
        );
    }
}
