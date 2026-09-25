//! JSON fixtures shared with the Kotlin tests, under `ime/android/fixtures/`.
//!
//! Each is what this crate sends across JNI for a known input. The Rust test
//! asserts the crate still produces it byte for byte; the Kotlin test decodes
//! the same file with the keyboard's own classes. Between them, a field
//! renamed or retyped on either side fails a test instead of a keyboard.

use std::path::PathBuf;

pub const UPDATE_ENV: &str = "MERIDIAN_UPDATE_FIXTURES";

fn path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name)
}

/// Compares `actual` with the fixture, or writes it under [`UPDATE_ENV`].
pub fn check(name: &str, actual: &str) {
    let path = path(name);
    if std::env::var_os(UPDATE_ENV).is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e}; run with {UPDATE_ENV}=1 to create it", path.display()))
        .replace("\r\n", "\n");
    assert_eq!(
        expected,
        actual,
        "{} is stale; if the change is intended, rerun with {UPDATE_ENV}=1 and update the Kotlin side",
        path.display()
    );
}
