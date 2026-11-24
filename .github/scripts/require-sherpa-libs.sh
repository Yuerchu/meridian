#!/usr/bin/env bash
# Make Cargo re-download sherpa-onnx when the cache kept the bookkeeping but
# dropped the libraries.
#
# `sherpa-onnx-sys` unpacks prebuilt libraries under the target directory and,
# on any later build, returns early if the `lib` directory merely exists. The
# cache breaks that assumption invisibly: a restore brings back Cargo's record
# that the build script already ran, while the libraries themselves may not
# survive, since the cache action prunes the target directory before saving it.
#
# What follows is a link against a path that is present and empty —
#
#   ld: library 'sherpa-onnx-c-api' not found
#
# — or, on Windows, our own build script panicking over the DLLs it stages.
#
# CI on 2026-11-04 (Windows, restore-key prefix match) printed "nothing built
# yet" because this script only looked for `sherpa-onnx-sys-*` directories, then
# `cargo test` compiled `sherpa-onnx` and `meridian` without compiling
# `sherpa-onnx-sys` — the rlib/fingerprint survived, the DLLs did not. The
# runtime library itself is the pairing: if it is missing, clear everything
# cargo could use to skip the download, including `cargo clean -p`.
set -euo pipefail

target="${SHERPA_TARGET_DIR:-src-tauri/target}"
[ -d "$target" ] || { echo "no target directory yet"; exit 0; }

# The file meridian's build.rs and the Unix linker actually need. Do not treat
# an empty `lib/` directory, a leftover Android jniLibs tree, or a fingerprint
# directory as "the libraries are here".
runtime_lib() {
  find "$target" -type f \( \
    -name 'sherpa-onnx-c-api.dll' -o \
    -name 'libsherpa-onnx-c-api.so' -o \
    -name 'libsherpa-onnx-c-api.dylib' \
  \) 2>/dev/null | head -n 1
}

if [ -n "$(runtime_lib)" ]; then
  echo "sherpa-onnx runtime library present, leaving the cache alone"
  exit 0
fi

echo "sherpa-onnx runtime library missing — clearing fingerprints so cargo re-downloads"
# find -delete errors if a parent is removed first; ignore that.
find "$target" -maxdepth 2 -type d -name sherpa-onnx-prebuilt -prune -exec rm -rf {} + 2>/dev/null || true
find "$target" \( -name 'sherpa-onnx-sys-*' -o -name 'sherpa_onnx_sys-*' \) -prune -exec rm -rf {} + 2>/dev/null || true

# A deps/*.rlib can keep the crate "fresh" even after the build-script
# directory is gone. Skip in fixture tests (SHERPA_TARGET_DIR) so they do not
# touch the real workspace.
if [ -z "${SHERPA_TARGET_DIR:-}" ] && [ -f src-tauri/Cargo.toml ]; then
  cargo clean -p sherpa-onnx-sys --manifest-path src-tauri/Cargo.toml || true
fi
echo "cleared"
