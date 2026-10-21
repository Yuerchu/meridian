import { copyFile, mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArtifactError, download, extractEntry, readZipDirectory, sha256File } from './lib/pinned-download.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = 'src-tauri/crates/litert-lm/runtime-manifest.json'
const LICENSE_FILE = 'litert-lm-LICENSE.txt'

export async function loadManifest(root = ROOT) {
  return JSON.parse(await readFile(path.join(root, MANIFEST), 'utf8'))
}

export async function verifyFiles(dir, platform) {
  for (const file of platform.files) {
    const target = path.join(dir, file.to)
    let info
    try {
      info = await stat(target)
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new ArtifactError(`LiteRT-LM runtime missing: ${file.to}; run pnpm litert:fetch`)
      throw error
    }
    if (!info.isFile() || info.size !== file.size || (await sha256File(target)) !== file.sha256) {
      throw new ArtifactError(`LiteRT-LM runtime SHA-256 mismatch: ${file.to}; run pnpm litert:fetch`)
    }
  }
}

async function matches(file, expected) {
  try {
    return (await sha256File(file)) === expected
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function archiveFor(source, cache) {
  const target = path.join(cache, source.file)
  if (await matches(target, source.sha256)) return target
  const isolated = await mkdtemp(path.join(cache, 'download-'))
  const downloaded = path.join(isolated, source.file)
  await download({ ...source, name: `LiteRT-LM ${source.file}` }, downloaded)
  await rename(downloaded, target)
  return target
}

async function publish(source, dest) {
  const staging = await mkdtemp(path.join(path.dirname(dest), '.litert-publish-'))
  const staged = path.join(staging, path.basename(dest))
  try {
    await copyFile(source, staged)
    await rename(staged, dest)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export async function prepareRuntime({ root = ROOT, platformKey = null, checkOnly = false, stageDir = null } = {}) {
  const key = platformKey ?? (process.platform === 'win32' && process.arch === 'x64' ? 'windows-x86_64' : null)
  if (key === null) return { skipped: true }
  const manifest = await loadManifest(root)
  const platform = manifest.platforms[key]
  if (!platform) throw new ArtifactError(`no pinned LiteRT-LM runtime for ${key}`)
  const out = path.join(root, 'src-tauri/resources')
  const license = path.join(out, LICENSE_FILE)
  try {
    await verifyFiles(out, platform)
    if (!(await matches(license, manifest.license.sha256)))
      throw new ArtifactError('LiteRT-LM license is missing or changed')
    return { skipped: false, version: manifest.version, directory: out }
  } catch (error) {
    if (checkOnly || !(error instanceof ArtifactError)) throw error
  }
  const cache = path.join(root, '.cache/litert-runtime', manifest.version, key)
  await mkdir(cache, { recursive: true })
  const prepared = await mkdtemp(path.join(cache, 'prepared-'))
  if (stageDir !== null) {
    await verifyFiles(stageDir, platform)
    for (const file of platform.files) await copyFile(path.join(stageDir, file.to), path.join(prepared, file.to))
  } else {
    const archive = await archiveFor(platform, cache)
    const handle = await open(archive, 'r')
    try {
      const entries = await readZipDirectory(handle, platform.file)
      for (const file of platform.files) await extractEntry(archive, platform.file, entries, handle, file, prepared)
    } finally {
      await handle.close()
    }
  }
  await verifyFiles(prepared, platform)
  const licenseSource = { ...manifest.license, file: LICENSE_FILE }
  const cachedLicense = await archiveFor(licenseSource, cache)
  await mkdir(out, { recursive: true })
  for (const file of platform.files) {
    if (!(await matches(path.join(out, file.to), file.sha256))) {
      await publish(path.join(prepared, file.to), path.join(out, file.to))
    }
  }
  if (!(await matches(license, manifest.license.sha256))) await publish(cachedLicense, license)
  await verifyFiles(out, platform)
  return { skipped: false, version: manifest.version, directory: out }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--check')) throw new ArtifactError('only --check is supported')
  prepareRuntime({ checkOnly: args.includes('--check'), stageDir: process.env.LITERT_LM_STAGE_DIR ?? null })
    .then((result) =>
      console.log(
        result.skipped
          ? 'LiteRT-LM: no automatic runtime distribution on this platform'
          : `LiteRT-LM ${result.version}: verified`,
      ),
    )
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
