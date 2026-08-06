#!/usr/bin/env bash
# Make Cargo re-download sherpa-onnx when the cache handed back an empty shell.
#
# `sherpa-onnx-sys` unpacks prebuilt libraries into
# `target/sherpa-onnx-prebuilt/<release>/lib` and, on any later build, returns
# early if that directory merely *exists*. Caching breaks that assumption in a
# way the crate cannot see: the restore brings back the build script's
# fingerprint — so Cargo considers the script done and replays its recorded
# `rustc-link-search` — while the libraries themselves may not survive, since
# the cache action prunes the target directory before saving it.
#
# The result is a link against a directory that is present and empty:
#
#   ld: library 'sherpa-onnx-c-api' not found
#
# and on Windows our own build script panics looking for the DLLs it stages.
#
# So check the invariant the crate assumes but never verifies — the unpack is
# complete — and if it does not hold, remove both halves of the inconsistency.
# Cargo then re-runs the script, which downloads afresh. This is a no-op on a
# cold cache and on a warm one that is intact.
set -euo pipefail

target="src-tauri/target"
prebuilt="$target/sherpa-onnx-prebuilt"

# A `lib` directory holding at least one file is what "unpacked" means here.
if compgen -G "$prebuilt/*/lib/*" > /dev/null; then
  echo "sherpa-onnx libraries present, leaving the cache alone"
  exit 0
fi

echo "sherpa-onnx libraries missing — clearing the unpack and its build script fingerprints"
rm -rf "$prebuilt"

# The fingerprints live under `build/`, one directory per build script run.
# Removing them is what actually makes Cargo run the script again; deleting the
# unpack alone would leave it convinced there is nothing to do.
for profile in "$target"/*/build; do
  [ -d "$profile" ] || continue
  find "$profile" -maxdepth 1 -name 'sherpa-onnx-sys-*' -exec rm -rf {} +
done
