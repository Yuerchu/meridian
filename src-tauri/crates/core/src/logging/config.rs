//! What gets written, and what gets kept out.

use tracing_subscriber::EnvFilter;

pub(crate) const DEFAULT_LEVEL: &str = "info";

/// Levels the log panel offers. `trace` is deliberately absent: at that level
/// the transport crates alone can fill the size budget in minutes, and anyone
/// who genuinely wants it can set `RUST_LOG` and read stdout.
pub(crate) const SELECTABLE_LEVELS: &[&str] = &["error", "warn", "info", "debug"];

/// A floor under the dependency tree.
///
/// `tracing-log` is on by default, so `log::` records from hyper, rustls, h2 and
/// the webview bridge into this subscriber as well. h2 emits a record per frame;
/// left alone it would spend the whole file on protocol chatter. EnvFilter picks
/// the most specific directive rather than the first, so these override the bare
/// level in front of them regardless of order.
const NOISE: &str = "hyper=warn,hyper_util=warn,h2=warn,reqwest=warn,rustls=warn,\
tokio_tungstenite=warn,tungstenite=warn,tokio_util=warn,mio=warn,want=warn,\
wry=warn,tao=warn,tauri=warn,muda=warn,zbus=warn,\
globset=warn,ignore=warn,selectors=warn,html5ever=warn,\
r2d2=warn,keyring=warn";

/// Build the file filter for a level name.
///
/// Never panics on a bad level: the value comes from a preference row, which is
/// editable outside the app. An unparseable one falls back to the default rather
/// than taking the process down at startup.
pub(crate) fn build_filter(level: &str) -> EnvFilter {
    EnvFilter::try_new(format!("{level},{NOISE}"))
        .unwrap_or_else(|_| EnvFilter::new(format!("{DEFAULT_LEVEL},{NOISE}")))
}

/// Normalise a requested level, rejecting anything not on the menu.
pub(crate) fn normalize_level(level: &str) -> Option<&'static str> {
    let lower = level.trim().to_ascii_lowercase();
    SELECTABLE_LEVELS.iter().copied().find(|l| *l == lower)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_selectable_level_parses() {
        // One malformed directive makes EnvFilter drop the whole string, and the
        // failure is silent, so this has to be checked rather than eyeballed.
        for level in SELECTABLE_LEVELS {
            let filter = build_filter(level);
            assert!(
                filter.to_string().contains("hyper"),
                "level {level} lost the noise floor: {filter}"
            );
        }
    }

    #[test]
    fn a_bad_level_falls_back_instead_of_panicking() {
        let filter = build_filter("not-a-level");
        assert!(filter.to_string().contains("hyper"), "{filter}");
    }

    #[test]
    fn only_offered_levels_are_accepted() {
        assert_eq!(normalize_level("WARN"), Some("warn"));
        assert_eq!(normalize_level(" info "), Some("info"));
        assert_eq!(normalize_level("trace"), None);
        assert_eq!(normalize_level(""), None);
    }
}
