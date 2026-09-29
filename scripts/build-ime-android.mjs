#!/usr/bin/env node
// Builds the Android keyboard's engine, libmeridian_ime.so, and puts it beside
// the app's own libraries in the Gradle project's jniLibs.
//
//   node scripts/build-ime-android.mjs [--release]
//
// Gradle runs this before merging JNI libraries (see buildImeRust in
// app/build.gradle.kts), so `pnpm tauri android build` produces an APK with
// the keyboard in it and nobody has to remember a second step. It is its own
// cargo invocation because the app's library must not carry an input method
// and the keyboard's process (`:ime`) must not load the app.
//
// The NDK is taken from the environment the Android build already has: the
// release workflow exports CC_/AR_/CARGO_TARGET_*_LINKER for aarch64 before
// calling Tauri, and Gradle passes them on. Without them the newest NDK under
// NDK_HOME, ANDROID_NDK_HOME or the SDK's ndk/ directory is used.
//
// Every LOAD segment of the result must be aligned to 16 KB or more: Android
// 15 devices with 16 KB pages refuse to load anything less, and that failure
// is a keyboard that silently never appears. The check fails the build.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGET = 'aarch64-linux-android'
const ABI = 'arm64-v8a'
const API = 34
const LIB = 'libmeridian_ime.so'
export const MIN_ALIGN = 0x4000

/** The newest version-named directory, compared numerically part by part. */
export function newestVersion(names) {
  const parts = (n) => n.split('.').map((p) => Number.parseInt(p, 10))
  return (
    names
      .filter((n) => /^\d+(\.\d+)*$/.test(n))
      .sort((a, b) => {
        const [x, y] = [parts(a), parts(b)]
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
          const d = (x[i] ?? 0) - (y[i] ?? 0)
          if (d !== 0) return d
        }
        return 0
      })
      .at(-1) ?? null
  )
}

/** Alignment of every LOAD segment in `llvm-readelf -lW` output. */
export function loadAlignments(readelf) {
  return readelf
    .split('\n')
    .filter((line) => line.trim().startsWith('LOAD'))
    .map((line) => Number.parseInt(line.trim().split(/\s+/).at(-1), 16))
}

/** Segments aligned below `MIN_ALIGN`; none is the passing answer. */
export function misaligned(alignments) {
  if (alignments.length === 0) return ['no LOAD segments']
  return alignments.filter((a) => !(a >= MIN_ALIGN)).map((a) => `0x${a.toString(16)}`)
}

function hostTag() {
  if (process.platform === 'win32') return 'windows-x86_64'
  if (process.platform === 'darwin') return 'darwin-x86_64'
  return 'linux-x86_64'
}

function findNdk() {
  for (const v of ['NDK_HOME', 'ANDROID_NDK_HOME', 'ANDROID_NDK_LATEST_HOME']) {
    if (process.env[v] && existsSync(process.env[v])) return process.env[v]
  }
  const sdks = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
  ].filter(Boolean)
  for (const sdk of sdks) {
    const dir = join(sdk, 'ndk')
    if (!existsSync(dir)) continue
    const newest = newestVersion(readdirSync(dir))
    if (newest) return join(dir, newest)
  }
  return null
}

function fail(message) {
  console.error(`build-ime-android: ${message}`)
  process.exit(1)
}

function main() {
  const release = process.argv.includes('--release')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = join(root, 'src-tauri', 'Cargo.toml')
  const env = { ...process.env }

  const linkerVar = 'CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER'
  let toolchain
  if (env[linkerVar]) {
    toolchain = dirname(env[linkerVar])
  } else {
    const ndk = findNdk()
    if (!ndk) fail('no Android NDK found; set NDK_HOME')
    toolchain = join(ndk, 'toolchains', 'llvm', 'prebuilt', hostTag(), 'bin')
    const clang = join(toolchain, `${TARGET}${API}-clang${process.platform === 'win32' ? '.cmd' : ''}`)
    if (!existsSync(clang)) fail(`${clang} does not exist`)
    env.CC_aarch64_linux_android = clang
    env.AR_aarch64_linux_android = join(toolchain, `llvm-ar${process.platform === 'win32' ? '.exe' : ''}`)
    env[linkerVar] = clang
  }

  const args = ['build', '--manifest-path', manifest, '--target', TARGET, '-p', 'meridian-ime-android']
  if (release) args.push('--release')
  const built = spawnSync('cargo', args, { stdio: 'inherit', env })
  if (built.status !== 0) fail(`cargo exited with ${built.status}`)

  const lib = join(root, 'src-tauri', 'target', TARGET, release ? 'release' : 'debug', LIB)
  const readelf = join(toolchain, `llvm-readelf${process.platform === 'win32' ? '.exe' : ''}`)
  const read = spawnSync(readelf, ['-lW', lib], { encoding: 'utf8' })
  if (read.status !== 0) fail(`llvm-readelf failed on ${lib}: ${read.stderr}`)
  const bad = misaligned(loadAlignments(read.stdout))
  if (bad.length > 0) fail(`${LIB} has LOAD segments below 16 KB alignment: ${bad.join(', ')}`)

  const dest = join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'jniLibs', ABI)
  mkdirSync(dest, { recursive: true })
  copyFileSync(lib, join(dest, LIB))
  console.log(`build-ime-android: ${LIB} (${release ? 'release' : 'debug'}) -> ${dest}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
