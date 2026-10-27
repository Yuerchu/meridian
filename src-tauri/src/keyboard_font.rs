//! The keyboard's typeface, copied out of the app assets when one is present.
//!
//! The Android keyboard runs in its own process. `install` writes the asset to
//! `ime/fonts/` under the data directory the keyboard reads, with a stamp naming
//! the app version that wrote it. A missing asset is `Ok(false)` and the
//! keyboard uses the system font.

use std::io::Write;
use std::path::Path;

/// Path of the typeface inside the app assets.
pub const ASSET: &str = "fonts/MiSansVF.ttf";
/// Under the input method's data directory; the keyboard looks here.
pub const FONT_DIR: &str = "fonts";
pub const FONT_FILE: &str = "MiSansVF.ttf";
const STAMP_FILE: &str = "MiSansVF.ttf.version";

/// Writes the font under `ime_dir/fonts` unless the stamp says this version
/// already did. `asset` fetches it from the app's embedded assets. Returns
/// whether it wrote anything; a missing asset writes nothing and is not an
/// error.
pub fn install(asset: impl FnOnce(&str) -> Option<Vec<u8>>, ime_dir: &Path, version: &str) -> std::io::Result<bool> {
    let dir = ime_dir.join(FONT_DIR);
    let font = dir.join(FONT_FILE);
    let stamp = dir.join(STAMP_FILE);
    if font.is_file() && std::fs::read_to_string(&stamp).is_ok_and(|v| v == version) {
        return Ok(false);
    }
    let Some(bytes) = asset(ASSET) else {
        return Ok(false);
    };
    std::fs::create_dir_all(&dir)?;
    // Written aside and renamed, so the keyboard never opens half a font.
    let tmp = dir.join(format!(".{FONT_FILE}.tmp"));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, &font)?;
    std::fs::write(&stamp, version)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_once_per_version() {
        let tmp = tempfile::tempdir().unwrap();
        let calls = std::cell::Cell::new(0);
        let asset = |path: &str| {
            calls.set(calls.get() + 1);
            assert_eq!(path, ASSET);
            Some(b"font".to_vec())
        };
        assert!(install(asset, tmp.path(), "0.3.0").unwrap());
        assert_eq!(std::fs::read(tmp.path().join("fonts/MiSansVF.ttf")).unwrap(), b"font");
        assert!(
            !install(asset, tmp.path(), "0.3.0").unwrap(),
            "same version: nothing to do"
        );
        assert_eq!(calls.get(), 1, "and the asset is not even read");
        assert!(
            install(asset, tmp.path(), "0.3.1").unwrap(),
            "an upgrade writes it again"
        );
    }

    #[test]
    fn a_deleted_font_is_written_again_and_a_missing_asset_is_no_error() {
        let tmp = tempfile::tempdir().unwrap();
        install(|_| Some(b"font".to_vec()), tmp.path(), "1").unwrap();
        std::fs::remove_file(tmp.path().join("fonts/MiSansVF.ttf")).unwrap();
        assert!(install(|_| Some(b"font".to_vec()), tmp.path(), "1").unwrap());

        let empty = tempfile::tempdir().unwrap();
        assert!(!install(|_| None, empty.path(), "1").unwrap());
        assert!(!empty.path().join("fonts/MiSansVF.ttf").exists());
    }
}
