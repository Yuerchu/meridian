#!/usr/bin/env bash
# Fetch the prebuilt sherpa-onnx libraries for Android and print the directory
# to point SHERPA_ONNX_LIB_DIR at.
#
# Unlike every other platform, Android cannot get these on its own:
# `sherpa-onnx-sys` has no android entry in the table it picks a download from,
# so its build script panics with "Unsupported target" unless the variable is
# already set. That makes this a build prerequisite, not an optimisation.
#
# One ABI at a time, deliberately. SHERPA_ONNX_LIB_DIR holds a single path while
# the libraries are per-ABI, so a multi-ABI gradle run — which invokes cargo
# once per ABI inside one process, sharing one environment — would link three of
# the four against the wrong architecture. Voice input is arm64-v8a only.
set -euo pipefail

ABI="${1:-arm64-v8a}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/src-tauri/target/sherpa-onnx-android"

# Must match the crate, or the headers the bindings were generated against stop
# describing the library they are linked to.
VERSION="$(sed -n 's/^sherpa-onnx = { version = "\([^"]*\)".*/\1/p' "$ROOT/src-tauri/crates/core/Cargo.toml")"
if [ -z "$VERSION" ]; then
  echo "could not read the sherpa-onnx version out of Cargo.toml" >&2
  exit 1
fi

LIB_DIR="$DEST/jniLibs/$ABI"

# Whoever consumes this path is cargo, which under Git Bash is a native Windows
# program and cannot read /c/... — `cygpath -w` is the only reason the caller
# gets a usable value there.
emit_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    echo "$1"
  fi
}

# Check for a file, not the directory. An interrupted unpack leaves the
# directory behind, and treating that as done is exactly the failure
# .github/scripts/require-sherpa-libs.sh exists to undo.
if [ -f "$LIB_DIR/libsherpa-onnx-c-api.so" ] && [ -f "$LIB_DIR/libonnxruntime.so" ]; then
  emit_path "$LIB_DIR"
  exit 0
fi

ARCHIVE="sherpa-onnx-v${VERSION}-android.tar.bz2"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/${ARCHIVE}"

mkdir -p "$DEST"
echo "downloading $ARCHIVE (~45 MB)" >&2
curl -fL --retry 3 -o "$DEST/$ARCHIVE.part" "$URL"
mv "$DEST/$ARCHIVE.part" "$DEST/$ARCHIVE"

echo "unpacking $ABI" >&2
tar xjf "$DEST/$ARCHIVE" -C "$DEST" "./jniLibs/$ABI"

# The archive also carries the JNI and C++ wrappers, which are for callers
# going through Kotlin. Linking from Rust needs only the C API and the runtime,
# and leaving the other two behind would put 5 MB of dead weight in the APK.
rm -f "$LIB_DIR/libsherpa-onnx-jni.so" "$LIB_DIR/libsherpa-onnx-cxx-api.so"
rm -f "$DEST/$ARCHIVE"

for lib in libsherpa-onnx-c-api.so libonnxruntime.so; do
  if [ ! -f "$LIB_DIR/$lib" ]; then
    echo "archive did not contain $lib for $ABI" >&2
    exit 1
  fi
done

emit_path "$LIB_DIR"
