---
paths:
  - "src-tauri/tauri*.conf.json"
  - "src-tauri/build.rs"
  - "src-tauri/nsis/**"
  - "src-tauri/wix/**"
  - ".github/workflows/**"
  - "scripts/build-ime-android.mjs"
  - "scripts/fetch-fonts.mjs"
  - "src-tauri/gen/android/app/build.gradle.kts"
  - "src-tauri/gen/android/build.gradle.kts"
---

# Packaging

Moved verbatim out of `CLAUDE.md` on 2026-09-30, when it outgrew the context
budget; Claude Code loads it when a file matching `paths` is read. "Above",
"below" and "see X" may name a section that is now in `CLAUDE.md` or in
another file here — the index in `CLAUDE.md` says which.

## Packaging

**Only Windows and the AppImage ship sherpa-onnx.** `sherpa-onnx-sys` links its
library dynamically and emits an rpath of `$ORIGIN` (Linux) or `@loader_path`
(macOS), which resolves against whatever sits beside the binary — true in the
target directory, false in an installed package. Windows is covered because
`build.rs` stages the DLLs and `tauri.windows.conf.json` declares them as
resources; the AppImage is covered because linuxdeploy copies dependencies into
the image, given `LD_LIBRARY_PATH` in the release workflow.

Nothing does this for the deb, the rpm or the macOS bundle. A build of those
*succeeds* and produces something that cannot start: the loader fails on
`libsherpa-onnx-c-api` before any code runs, so it reads as the app not
opening rather than as a missing feature. Verified against the v0.2.0 macOS
bundle — the binary asks for two dylibs and the `.app` contains none.

So `tauri.linux.conf.json` limits Linux to the AppImage, and macOS is not
built. Lifting either means staging the libraries for that platform *and*
giving the binary an rpath that reaches wherever the bundler puts them —
Tauri's resources land in `/usr/lib/<product>` for a deb and
`Contents/Resources` for a `.app`, neither of which is beside the executable.

**Android gets its sherpa-onnx libraries from the crate, like every other
target.** Up to 1.13.5 `sherpa-onnx-sys` had no Android entry in its download
table, so `scripts/fetch-sherpa-android.sh` fetched them, `SHERPA_ONNX_LIB_DIR`
pointed the build at them and a second gradle `jniLibs` source directory
packaged them. 1.13.8 downloads the Android archive itself and copies the
libraries into `gen/android/app/src/main/jniLibs/<abi>/` beside Tauri's
`libmeridian_lib.so`, stamping `.sherpa-onnx-version` there (ignored, like the
`.so` files). The old arrangement was removed rather than kept beside it: the
crate's copy has no switch, and with the second source directory still in
place the same library would reach gradle twice and AGP refuses duplicates.

Two things about the crate are worth knowing. **Leave `SHERPA_ONNX_LIB_DIR`
unset.** It is still honoured for every target without checking which, and
cargo caches the resolved path in
`target/<profile>/build/sherpa-onnx-sys-*/output` past the variable being
cleared — a desktop build in a shell still holding an Android path fails at
`link.exe` with `LNK1181` naming neither. **And delete
`src-tauri/target/sherpa-onnx-prebuilt/jniLibs` before building after a
sherpa-onnx upgrade.** The Android archive has no top-level directory, so it
unpacks to that unversioned path, and the next version's build script finds it
before it looks for its own archive — then stamps the old libraries with the
new version. CI is not exposed: rust-cache keys on `Cargo.lock`, so an upgrade
is a cold cache there.

### The input method

**Both Windows installers carry it as an optional component, and both are
built from forked templates.** `tauri.ime.conf.json` is the whole switch:
`pnpm tauri build --config src-tauri/tauri.ime.conf.json`, which the
release workflow passes on Windows, points `bundle.windows.nsis.template`
at `src-tauri/nsis/installer.nsi` and `bundle.windows.wix.template` at
`src-tauri/wix/main.wxs` — each a verbatim copy of tauri-bundler 2.9.4's
template (the bundler inside `@tauri-apps/cli` 2.11.4) with every change
marked `Meridian:`, and a header saying to re-diff against upstream on a
Tauri upgrade. A plain `pnpm tauri build` uses the stock templates and
produces the old per-user installer without the input method, which is
what a development build wants. The artifacts are *not* in
`bundle.resources`: the stock resource list lands in the mandatory part of
both installers, which is exactly what optional means they must not do.

**NSIS: a components page, a read-only main section, and everything the
input method does in `nsis/ime-hooks.nsh`.** The fork adds
`MUI_PAGE_COMPONENTS`, names the stock `Section Install` and marks it
`SectionIn RO`, and adds `Section "Meridian 输入法" SecIME` whose body is
`IME_SECTION_INSTALL` from the hooks file — copy the files, `icacls`
`*S-1-15-2-1` (AppContainer apps must read the DLL, and the name of that
group is localised), `regsvr32 /s` both DLLs, prune older versions, an
all-users Startup shortcut for `meridian-ime-host.exe`, and
`nsis_tauri_utils::RunAsUser` to start the host. The section body stays in
the hooks file rather than the template so the template's diff against
upstream is a few dozen lines, and the hooks include is moved below the
`!define` block because the hooks file names the DLL after `${VERSION}` at
include time — where upstream puts it, at the top, that define does not
exist yet. `${SecIME}` likewise only exists once the section has been read,
so the `.onInit` logic is a function defined after the sections.
`IMEInstalled=1` under the product's uninstall key is the marker: `.onInit`
preselects the section from it, so an update — the updater's `/UPDATE /P`
never shows the page — keeps the input method exactly when it was there
before, and a hidden section after `SecIME` takes an earlier install's
input method out when the box was unticked. `/NOIME` on the command line
deselects it, for silent and passive installs. The uninstaller unregisters
only what it finds on disk, and only when not updating. Bundling with the
config and without the staged artifacts is a `!error` at makensis time,
not an installer whose section copies nothing.

**The DLL is version-named and the old one is never unregistered.** A text
service is mapped into every process with a text field, so the file in use
cannot be replaced in place: `build.rs` stages
`meridian_ime_tsf-<version>.dll` (and `meridian_ime_tsf32-<version>.dll`),
the new version registers the same CLSID over the old, and older files are
deleted with `/REBOOTOK` once nothing holds them. `regsvr32 /u` on an old
file would remove the registration the new one had just written, because
they share it. That is also why `build.rs` asserts `tauri.conf.json`'s
version equals `Cargo.toml`'s: the NSIS `${VERSION}` names the file.

**`$WINDIR\Sysnative\regsvr32.exe`, not `$SYSDIR`.** The installer is a
32-bit process, so `$SYSDIR` is redirected to `SysWOW64` and would register
the 64-bit DLL with the wrong loader; `Sysnative` is the alias that reaches
the real `System32` from a 32-bit caller. The x86 DLL goes through
`SysWOW64\regsvr32.exe` explicitly. TSF profile registration is what makes
the installer `perMachine`: `DllRegisterServer` writes the CLSID and the
zh-CN / zh-TW profiles under HKLM, and there is no HKCU registration path
that `ctfmon` honours. The hooks run the previous per-user copy's
uninstaller first so the machine install does not leave two copies.

**MSI: a `Feature Id="IME"` in `wix/ime.wxs`, registered by the SelfReg
table.** `SelfRegCost="1"` on the two DLLs has Windows Installer call
`DllRegisterServer` / `DllUnregisterServer` itself, in a surrogate of the
DLL's own bitness — so the 32-bit DLL has to be a `Win64="no"` component,
and ICE80 refuses one of those under `ProgramFiles64Folder` as an error
(Tauri passes light no `-sice`), so it lives in
`Program Files (x86)\Meridian\ime` with its own copy of the icon, which
`DllRegisterServer` looks for beside the DLL. No custom action registers
anything; the one deferred custom action is the `icacls` grant,
`Return="ignore"`. The feature is `Level="1"` (selected by default) with
`AllowAdvertise="no"`, and `msiexec REMOVE=IME` leaves it out. Three things
the stock template could not give it. The fork swaps `WixUI_InstallDir` for
`WixUI_FeatureTree`, because the stock UI has no dialog in which a feature
can be unticked (the directory is still changeable, through Browse on the
`ConfigurableDirectory` feature). It hoists `featureRefs` to top level,
because the stock template makes them children of the untitled `External`
feature. And the versioned file names come through `resources/ime.wxi`,
which `build.rs` writes (`write_ime_wxi`): Tauri runs a fragment through
Handlebars only to scan it for extension namespaces, so `{{version}}` stays
literal there, and light resolves a relative `Source` against
`target/<profile>/wix/<arch>`, so the include also carries the absolute
staging directory. The feature title is ASCII because the database is code
page 1252. Across a major upgrade the old product's `SelfUnreg` runs before
the new `SelfReg` (`Schedule="afterInstallInitialize"`), so the
registration is briefly absent and then rewritten; the NSIS path never has
that gap.

**The x86 DLL is a second cargo invocation outside Tauri's build, and the
whole input method builds into `target/ime/`.** 32-bit apps (WPS, the
32-bit QQ) load a 32-bit text service, and Tauri's build has one target.
`pnpm ime:build` builds the x64 DLL and host, then the DLL again with
`--target i686-pc-windows-msvc` (`rustup target add` it first), all under
`--target-dir target/ime`; `build.rs` copies whatever it finds there into
the gitignored `resources/ime/`, warns when something is missing, and
panics instead under `MERIDIAN_IME_REQUIRED=1`, which the release workflow
sets so an installer without the input method cannot ship by accident.
The separate target directory is not tidiness: the MSI bundler ships every
`*.dll` it finds beside the main binary, so an unversioned
`meridian_ime_tsf.dll` in `target/release` would be packaged a second time,
in the root, registered by nothing. `resources/ime.stamp`, touched by
`pnpm ime:build`, is what makes `build.rs` re-run for artifacts that did
not exist on the previous build — cargo treats a missing
`rerun-if-changed` path as always changed, so the artifacts themselves are
only watched once they exist.

### The Android keyboard

**`libmeridian_ime.so` is a third cargo invocation, and Gradle makes it.**
`scripts/build-ime-android.mjs` builds `meridian-ime-android` for
`aarch64-linux-android` and copies the library into
`src/main/jniLibs/arm64-v8a/`, beside what Tauri and sherpa-onnx put
there; `buildImeRust{Debug,Release}` in `app/build.gradle.kts` runs it
before every JNI merge, so `pnpm tauri android build` cannot produce an APK
without the keyboard. It takes the NDK from the environment the release
workflow already exports, and otherwise finds the newest one. It is Node,
not bash, because Gradle on Windows can resolve `bash` to WSL's. arm64 only.

**The library must be 16 KB aligned, and the script refuses it otherwise.**
A 16 KB-page device will not load anything less, and the symptom is a
keyboard that never appears. NDK r28 aligns to 16 KB by default; the check
(`llvm-readelf -lW`, every LOAD segment) is what keeps that true, and
linking with `max-page-size=4096` was used to see it fail. It links no ONNX
Runtime: the scorer opens sherpa-onnx's `libonnxruntime.so` by name at run
time.

**Three version ceilings, all measured on 2026-09-25.** Kotlin is 2.2.21
because Tauri's own Android projects (built from the cargo registry, so not
ours to edit) still write `kotlinOptions { jvmTarget }`, which 2.3 made an
error — Tauri's dev branch has moved to `compilerOptions`, so this lifts
with the next release. Compose stays on 1.11 (BOM 2026.06.01) because 1.12
needs compileSdk 37 and AGP 9.1, and AGP 9's built-in Kotlin conflicts with
those same projects applying `kotlin-android`. And material3 is
1.5.0-alpha18, because 1.4.0 keeps the Expressive API internal and alpha18 is
the last 1.5 built on Compose 1.11. The comments beside each pin say the same.
