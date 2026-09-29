//! The keyboard's typeface, handed over by the app.
//!
//! The Android keyboard runs in its own process and draws with MiSans, the
//! app's font. The font is not in the APK a second time: it is 20 MB, its
//! licence forbids subsetting it, and the app already carries it among its
//! frontend assets, embedded in this library where the keyboard's process
//! cannot read it. So the app writes it out once, to `ime/fonts/` under the
//! data directory the keyboard reads, and the keyboard uses it when it is
//! there and the system font until then. A stamp beside it names the app
//! version that wrote it, so an upgrade writes it again and an ordinary
//! start does not decompress 20 MB to find out nothing changed.

use std::io::Write;
use std::path::Path;

/// Where the frontend keeps it (`public/fonts`, fetched at build time).
pub const ASSET: &str = "fonts/MiSansVF.ttf";
/// Under the input method's data directory; the keyboard looks here.
pub const FONT_DIR: &str = "fonts";
pub const FONT_FILE: &str = "MiSansVF.ttf";
const STAMP_FILE: &str = "MiSansVF.ttf.version";

/// Writes the font under `ime_dir/fonts` unless the stamp says this version
/// already did. `asset` fetches it from the app's embedded assets. Returns
/// whether it wrote anything; a missing asset writes nothing and is not an
/// error (a build without fonts still has a keyboard).
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
