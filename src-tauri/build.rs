use std::path::{Path, PathBuf};

fn main() {
    stage_sherpa_runtime();
    tauri_build::build()
}

/// The DLLs the bundler has to ship, copied somewhere it can actually name.
///
/// `sherpa-onnx-sys` drops its runtime libraries into `target/<profile>/`, and
/// the bundle resource list is a static JSON file with no way to say "whichever
/// profile is being built". Naming `target/release` there works only on a
/// machine that has already done a release build — on a clean checkout a plain
/// `cargo build` fails with a missing resource, which is a confusing way to
/// learn that debug and release disagree about a path. Staging the files under
/// a fixed directory takes the profile out of the question entirely.
///
/// Runs before `tauri_build::build()`, because that is what validates the
/// resource list.
fn stage_sherpa_runtime() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    // Only these three are loaded at runtime; the C++ API library is not.
    const RUNTIME_DLLS: [&str; 3] = [
        "sherpa-onnx-c-api.dll",
        "onnxruntime.dll",
        "onnxruntime_providers_shared.dll",
    ];

    let Some(profile_dir) = profile_dir() else { return };
    let staged = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("resources");
    if let Err(e) = std::fs::create_dir_all(&staged) {
        panic!("could not create {}: {e}", staged.display());
    }

    for name in RUNTIME_DLLS {
        let Some(from) = locate_dll(name, &profile_dir) else {
            panic!(
                "{name} was not found in {} nor in the sherpa-onnx prebuilt archive beside it. \
                 Build the dependency first (`cargo build`) so it unpacks its runtime libraries, \
                 or set SHERPA_ONNX_LIB_DIR to a directory containing them.",
                profile_dir.display()
            );
        };
        // Skipping an unchanged copy keeps this out of every incremental build,
        // and avoids rewriting a DLL a running app may still have open.
        let to = staged.join(name);
        if !is_current(&from, &to)
            && let Err(e) = std::fs::copy(&from, &to)
        {
            panic!("could not stage {} to {}: {e}", from.display(), to.display());
        }
    }
}

/// Where a runtime DLL can be found, preferring the copy the dependency makes.
///
/// The fallback is not paranoia. `sherpa-onnx-sys` copies these into
/// `target/<profile>` from its own build script, and that script is cached like
/// any other — delete a DLL from `target/<profile>` and it never comes back,
/// because as far as Cargo is concerned the work was already done. Cargo also
/// only orders build scripts against `[build-dependencies]`, so on a first
/// build ours may run before that copy has happened at all. Reading the
/// unpacked archive directly sidesteps both.
fn locate_dll(name: &str, profile_dir: &Path) -> Option<PathBuf> {
    let direct = profile_dir.join(name);
    if direct.exists() {
        return Some(direct);
    }
    let prebuilt = profile_dir.parent()?.join("sherpa-onnx-prebuilt");
    // One versioned directory per release, so the name cannot be hardcoded.
    for entry in std::fs::read_dir(prebuilt).ok()?.flatten() {
        let candidate = entry.path().join("lib").join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// `target/<profile>`, located the way the dependency locates it: walk up from
/// OUT_DIR until a component matches the profile name.
fn profile_dir() -> Option<PathBuf> {
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").ok()?);
    let profile = std::env::var("PROFILE").ok()?;
    out_dir
        .ancestors()
        .find(|p| p.file_name() == Some(std::ffi::OsStr::new(&profile)))
        .map(Path::to_path_buf)
}

fn is_current(from: &Path, to: &Path) -> bool {
    let (Ok(src), Ok(dst)) = (from.metadata(), to.metadata()) else {
        return false;
    };
    match (src.modified(), dst.modified()) {
        (Ok(s), Ok(d)) => src.len() == dst.len() && d >= s,
        _ => false,
    }
}
