use std::path::{Path, PathBuf};

fn main() {
    stage_sherpa_runtime();
    stage_ime_artifacts();
    tauri_build::build()
}

/// The input method's artifacts, staged under `resources/ime/` for the bundler.
///
/// The TSF DLL and the host are workspace members this package does not depend
/// on, so cargo never builds them as part of it: `pnpm ime:build` (and the
/// release workflow) builds them first, in release, and this copies whatever it
/// finds. The x86 DLL comes from a second cargo invocation with
/// `--target i686-pc-windows-msvc`, which lands under its own triple directory —
/// 32-bit apps (WPS, the 32-bit QQ) load a 32-bit text service, and Tauri's
/// build has no notion of a second target.
///
/// The DLL is copied under a version-suffixed name because the installer never
/// overwrites one: a text service is mapped into every process with a text
/// field, so the file in use cannot be replaced in place. The old file is left
/// behind and pruned once nothing holds it (`nsis/ime-hooks.nsh`). That makes
/// the version part of the file name, and the NSIS script spells it as
/// `${VERSION}` — which comes from `tauri.conf.json`, not from this crate. The
/// two are compared here so a bump to one and not the other fails the build
/// rather than producing an installer that registers a file it did not ship.
///
/// Missing sources are a warning, not an error: a plain `cargo build` on a
/// checkout that never built the input method must still succeed. The release
/// workflow sets `MERIDIAN_IME_REQUIRED=1`, which turns them into a panic, so an
/// installer without the input method cannot be produced by accident.
fn stage_ime_artifacts() {
    println!("cargo:rerun-if-env-changed=MERIDIAN_IME_REQUIRED");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let required = std::env::var("MERIDIAN_IME_REQUIRED").as_deref() == Ok("1");
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let version = std::env::var("CARGO_PKG_VERSION").unwrap();
    assert_versions_agree(&manifest_dir, &version);

    let Some(root) = target_root() else {
        let msg = "could not locate the cargo target directory from OUT_DIR";
        if required {
            panic!("{msg}, and MERIDIAN_IME_REQUIRED=1");
        }
        println!("cargo:warning={msg}; input method artifacts not staged");
        return;
    };
    let staged = manifest_dir.join("resources").join("ime");
    if let Err(e) = std::fs::create_dir_all(&staged) {
        panic!("could not create {}: {e}", staged.display());
    }

    // `pnpm ime:build` touches this once it has built, and that is what brings
    // the artifacts it just produced into `resources/ime/` on the next build.
    // The DLLs themselves are watched only once they exist (`stage_artifact`):
    // cargo treats a missing `rerun-if-changed` path as always changed, and
    // that would re-run this script — and so recompile the crate — on every
    // build for anyone without the input method. A path cargo cannot see
    // appear needs a file that is always there to stand in for it. Beside the
    // directory rather than inside it, because the bundle resource is a glob
    // over the directory and would ship the stamp.
    let stamp = manifest_dir.join("resources").join("ime.stamp");
    if !stamp.exists()
        && let Err(e) = std::fs::write(&stamp, b"")
    {
        panic!("could not create {}: {e}", stamp.display());
    }
    println!("cargo:rerun-if-changed={}", stamp.display());

    let dll64 = format!("meridian_ime_tsf-{version}.dll");
    let dll32 = format!("meridian_ime_tsf32-{version}.dll");

    // Earlier versions' DLLs go first: the bundle resource is a glob over this
    // directory, and a stale versioned DLL left here would ship inside the new
    // installer, be registered by nothing and deleted by nothing.
    if let Ok(entries) = std::fs::read_dir(&staged) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with("meridian_ime_tsf")
                && name.ends_with(".dll")
                && name != dll64
                && name != dll32
                && let Err(e) = std::fs::remove_file(entry.path())
            {
                panic!("could not remove stale {}: {e}", entry.path().display());
            }
        }
    }

    // Under `target/ime/`, its own target directory (`pnpm ime:build` and the
    // release workflow pass `--target-dir`), and not beside the app: the MSI
    // bundler ships every `*.dll` it finds next to the main binary, so an
    // unversioned `meridian_ime_tsf.dll` in `target/release` would land in the
    // installer a second time, in the root, registered by nothing.
    //
    // Both spellings of the x64 output, because the two builders disagree:
    // `pnpm ime:build` writes to `target/ime/release`, the release workflow
    // passes `--target` and gets `target/ime/x86_64-pc-windows-msvc/release`.
    // The newest wins where both exist, so a rebuild on one path cannot be
    // shadowed by an older artifact on the other.
    let ime = root.join("ime");
    let x64 = [ime.join("x86_64-pc-windows-msvc").join("release"), ime.join("release")];
    let x86 = [ime.join("i686-pc-windows-msvc").join("release")];

    stage_artifact(&x64, "meridian_ime_tsf.dll", &staged.join(&dll64), required);
    stage_artifact(&x86, "meridian_ime_tsf.dll", &staged.join(&dll32), required);
    stage_artifact(
        &x64,
        "meridian-ime-host.exe",
        &staged.join("meridian-ime-host.exe"),
        required,
    );
    // `DllRegisterServer` uses this file for the language-bar icon when it
    // finds it beside the DLL; the app's own icon, under the name it looks for.
    stage_artifact(
        &[manifest_dir.join("icons")],
        "icon.ico",
        &staged.join("meridian-ime.ico"),
        required,
    );
    write_ime_wxi(&manifest_dir, &staged, &version);
}

/// The two facts `wix/ime.wxs` cannot find out on its own, as a WiX include.
///
/// Tauri runs the fragment through Handlebars only to scan it for extension
/// namespaces; candle gets the file as written, so `{{version}}` there stays
/// literal. And light resolves relative `Source` paths against its own
/// working directory, `target/<profile>/wix/<arch>`, not against the
/// fragment. So the fragment includes this file for the versioned DLL names
/// and the absolute staging directory. Under `resources/`, which is
/// gitignored, beside the artifacts it describes.
fn write_ime_wxi(manifest_dir: &Path, staged: &Path, version: &str) {
    let escape = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let content = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n\
         <!-- Written by build.rs (write_ime_wxi); do not edit. -->\n\
         <Include>\n  \
           <?define IMEVersion=\"{}\" ?>\n  \
           <?define IMESourceDir=\"{}\" ?>\n\
         </Include>\n",
        escape(version),
        escape(&staged.display().to_string())
    );
    let path = manifest_dir.join("resources").join("ime.wxi");
    // Unchanged content is not rewritten, so the file's timestamp only moves
    // when something in it does.
    if std::fs::read_to_string(&path).ok().as_deref() == Some(content.as_str()) {
        return;
    }
    if let Err(e) = std::fs::write(&path, content) {
        panic!("could not write {}: {e}", path.display());
    }
}

/// Copy `name` from the newest of `dirs` that has it to `to`, or say why not.
fn stage_artifact(dirs: &[PathBuf], name: &str, to: &Path, required: bool) {
    let from = dirs
        .iter()
        .map(|dir| dir.join(name))
        .filter(|path| path.is_file())
        .max_by_key(|path| path.metadata().and_then(|m| m.modified()).ok());
    let Some(from) = from else {
        let looked_in = dirs
            .iter()
            .map(|d| d.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        if required {
            panic!(
                "{name} was not found in {looked_in}. Build the input method first \
                 (`pnpm ime:build`, which also needs `rustup target add i686-pc-windows-msvc` \
                 for the 32-bit DLL); MERIDIAN_IME_REQUIRED=1 refuses to bundle without it."
            );
        }
        println!("cargo:warning={name} not found in {looked_in}; the input method will not be bundled");
        return;
    };
    // Only for a source that exists: cargo re-runs a build script on every
    // build if a `rerun-if-changed` path is missing, which would cost every
    // checkout without the input method its incremental builds.
    println!("cargo:rerun-if-changed={}", from.display());
    if !is_current(&from, to)
        && let Err(e) = std::fs::copy(&from, to)
    {
        panic!("could not stage {} to {}: {e}", from.display(), to.display());
    }
}

/// `tauri.conf.json`'s top-level `version` must be this crate's. The NSIS
/// script names the DLL with the former and this script with the latter.
fn assert_versions_agree(manifest_dir: &Path, cargo_version: &str) {
    let conf = manifest_dir.join("tauri.conf.json");
    println!("cargo:rerun-if-changed={}", conf.display());
    let text = std::fs::read_to_string(&conf).unwrap_or_else(|e| panic!("could not read {}: {e}", conf.display()));
    // The top-level key is the first `"version"` in the file, at two spaces of
    // indent; a nested one (a plugin's, a window's) sits deeper. No JSON parser
    // is available to a build script that declares only `tauri-build`.
    let conf_version = text
        .lines()
        .filter(|line| line.starts_with("  \"version\""))
        .filter_map(|line| line.split('"').nth(3))
        .next()
        .unwrap_or_else(|| panic!("no top-level \"version\" found in {}", conf.display()));
    assert_eq!(
        conf_version, cargo_version,
        "tauri.conf.json says version {conf_version} but Cargo.toml says {cargo_version}; \
         the installer names the input method DLL after the former and the build script \
         after the latter, so they must agree"
    );
}

/// The cargo target root: `target/`, whether or not a `--target` triple sits
/// between it and the profile directory.
fn target_root() -> Option<PathBuf> {
    let profile = profile_dir()?;
    let parent = profile.parent()?;
    let is_triple = parent
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.contains("-pc-windows-"));
    let root = if is_triple { parent.parent()? } else { parent };
    Some(root.to_path_buf())
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
