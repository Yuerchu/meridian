use crate::db::DbPool;
use crate::tools;

/// Build the file access policy for tool execution.
/// Desktop: unrestricted (legacy working_directory validation only).
/// Android: whitelist of authorized roots from preferences + system grants.
pub(crate) async fn build_file_access(pool: &DbPool) -> tools::FileAccess {
    #[cfg(target_os = "android")]
    {
        let pool = pool.clone();
        let prefs = tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().ok()?;
            let manage = crate::db::ops::preference::get_preference(&mut conn, "android.manage_storage_enabled")
                .ok()
                .flatten();
            let saf = crate::db::ops::preference::get_preference(&mut conn, "android.saf_roots")
                .ok()
                .flatten();
            Some((manage, saf))
        })
        .await
        .ok()
        .flatten();
        let (manage_pref, saf_pref) = prefs.unwrap_or((None, None));

        let mut roots = Vec::new();
        if manage_pref.as_deref() == Some("true")
            && crate::android_bridge::is_manage_storage_granted().unwrap_or(false)
        {
            let shared = std::path::PathBuf::from("/storage/emulated/0");
            roots.push(tools::AccessRoot {
                virtual_prefix: "/storage/emulated/0".to_string(),
                kind: tools::RootKind::RealPath(shared.clone()),
            });
            roots.push(tools::AccessRoot {
                virtual_prefix: "/sdcard".to_string(),
                kind: tools::RootKind::RealPath(shared),
            });
            if let Ok(rd) = std::fs::read_dir("/storage") {
                for entry in rd.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name == "emulated" || name == "self" { continue; }
                    let p = entry.path();
                    if p.is_dir() {
                        roots.push(tools::AccessRoot {
                            virtual_prefix: format!("/storage/{name}"),
                            kind: tools::RootKind::RealPath(p),
                        });
                    }
                }
            }
        }
        let valid_uris: Option<std::collections::HashSet<String>> =
            tokio::task::spawn_blocking(|| crate::android_bridge::persisted_tree_uris())
                .await
                .ok()
                .and_then(|r| r.ok())
                .map(|v| v.into_iter().collect());
        if let Some(json) = saf_pref {
            if let Ok(entries) = serde_json::from_str::<Vec<crate::platform::SafRootEntry>>(&json) {
                for e in entries {
                    if valid_uris.as_ref().is_none_or(|s| s.contains(&e.uri)) {
                        roots.push(tools::AccessRoot {
                            virtual_prefix: e.virtual_prefix,
                            kind: tools::RootKind::SafTree { tree_uri: e.uri },
                        });
                    }
                }
            }
        }
        tools::FileAccess::Roots(roots)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = pool;
        tools::FileAccess::default()
    }
}

/// Describe accessible file roots for the system prompt so the model knows
/// what paths it may use. Empty string when not in roots mode.
pub(crate) fn file_access_prompt(file_access: &tools::FileAccess) -> String {
    let tools::FileAccess::Roots(roots) = file_access else {
        return String::new();
    };
    if roots.is_empty() {
        return "\n\n# File access\nNo file locations are currently authorized on this device. \
                If the user asks for file operations, tell them to grant access in \
                Settings (an authorized directory or 'All files access')."
            .to_string();
    }
    let mut out = String::from(
        "\n\n# File access\nYou can access files under these locations (use absolute paths):\n",
    );
    for root in roots {
        match &root.kind {
            tools::RootKind::RealPath(_) => {
                out.push_str(&format!("- {} (direct access)\n", root.virtual_prefix));
            }
            tools::RootKind::SafTree { .. } => {
                out.push_str(&format!(
                    "- {} (user-authorized directory; recursive search/glob unavailable)\n",
                    root.virtual_prefix
                ));
            }
        }
    }
    out
}
