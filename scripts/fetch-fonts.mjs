#!/usr/bin/env node
// Fetches the bundled typefaces into `public/fonts/`, which Vite copies into
// `dist/` as it is. Neither directory is in git, and for MiSans that is not a
// preference: its licence allows embedding in software but forbids
// distributing the font on its own, and this repository is public. So the
// archives are fetched from their publishers at build time, pinned by SHA-256,
// and the files are copied out byte for byte — no subsetting, no woff2
// conversion, since the MiSans licence also forbids modifying the glyphs and a
// format conversion is at best a grey area.
//
// Every archive and every extracted file carries a pinned hash. A cached
// archive whose hash matches is not downloaded again, and an extracted file
// whose hash matches is not extracted again, so a warm run touches no network.
// A failed download or a hash mismatch exits non-zero: a build that silently
// fell back to system fonts would look fine on the machine that made it.
//
// 零依赖；下载、哈希与 ZIP 定点提取复用 scripts/lib/pinned-download.mjs。
// 只支持固定归档所需的 stored/deflate 条目，拒绝不认识的格式。
//
// Usage: node scripts/fetch-fonts.mjs

import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ArtifactError as FontFetchError,
  download,
  sha256File,
  readZipDirectory,
  extractEntry,
} from './lib/pinned-download.mjs'

export { download } from './lib/pinned-download.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache', 'fonts')
const outDir = path.join(root, 'public', 'fonts')

/**
 * What is fetched and what is taken out of it. `entry` is the path inside the
 * archive; `to` is the path under `public/fonts/`. Updating a font means
 * changing a URL and every hash beside it — the script prints the actual hash
 * on a mismatch, which is how the new values are found.
 */
export const SOURCES = [
  {
    name: 'Inter 4.1',
    url: 'https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip',
    file: 'Inter-4.1.zip',
    sha256: '9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e',
    extract: [
      {
        entry: 'web/InterVariable.woff2',
        to: 'InterVariable.woff2',
        sha256: '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3',
      },
      {
        entry: 'web/InterVariable-Italic.woff2',
        to: 'InterVariable-Italic.woff2',
        sha256: 'e564f652916db6c139570fefb9524a77c4d48f30c92928de9db19b6b5c7a262a',
      },
      {
        entry: 'LICENSE.txt',
        to: 'licenses/Inter-OFL.txt',
        sha256: '262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a',
      },
    ],
  },
  {
    name: 'MiSans',
    url: 'https://hyperos.mi.com/font-download/MiSans.zip',
    file: 'MiSans.zip',
    sha256: 'b6aa1fc827035922612df8edf36e5609bca1c5441e25cd57572204569b7b81d9',
    extract: [
      {
        entry: 'MiSans/可变字体/MiSansVF.ttf',
        to: 'MiSansVF.ttf',
        sha256: '0ddef90648998900175cfdca9a6f087a2544c182f130b0ad4f7e94a03a115e79',
      },
    ],
  },
  {
    name: 'MiSans L3',
    url: 'https://hyperos.mi.com/font-download/MiSans_L3.zip',
    file: 'MiSans_L3.zip',
    sha256: '467fe0171ec9ea21d925aba9c032b1a775a3e756c458f075e7a2ee57568b0c79',
    extract: [
      {
        entry: 'MiSans L3/MiSans L3.ttf',
        to: 'MiSansL3.ttf',
        sha256: '710bc52d40d01d8846254a095780bec95e2f39382500939e4536e4a999bdd844',
      },
    ],
  },
  {
    name: 'MiSans licence',
    url: 'https://hyperos.mi.com/font-download/MiSans%E5%AD%97%E4%BD%93%E7%9F%A5%E8%AF%86%E4%BA%A7%E6%9D%83%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE.pdf',
    file: 'MiSans-License.pdf',
    sha256: '4a93a27cd2bd81b3b5ecfd0a853144a876fa26938a93a68443c67d74172fcb86',
    // Not an archive: copied as a whole.
    copyTo: 'licenses/MiSans-License.pdf',
  },
  {
    name: 'Maple Mono NF CN 7.9',
    url: 'https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-NF-CN.zip',
    file: 'MapleMono-NF-CN-7.9.zip',
    sha256: 'af913b6322905348b3f50e4397fedc35b3a880db5effcce7969003051dcd3e94',
    extract: [
      {
        entry: 'MapleMono-NF-CN-Regular.ttf',
        to: 'MapleMono-NF-CN-Regular.ttf',
        sha256: 'bb8e8e8c263896f42555107202f1847f7a42c340a3e532df9c4d585c9794411c',
      },
      {
        entry: 'MapleMono-NF-CN-Bold.ttf',
        to: 'MapleMono-NF-CN-Bold.ttf',
        sha256: '9e0c22a032c255b2da2c073d6cca6f8cf6fd6f214ae5407eb9f1aa523713729b',
      },
      {
        entry: 'MapleMono-NF-CN-Italic.ttf',
        to: 'MapleMono-NF-CN-Italic.ttf',
        sha256: '39e6c6e611e65e6d0780f6279561f954f9db51221987d0924c45f6121eaf9054',
      },
      {
        entry: 'MapleMono-NF-CN-BoldItalic.ttf',
        to: 'MapleMono-NF-CN-BoldItalic.ttf',
        sha256: '9d6e76fbb5767406efd1f5ae2d32f5439de3b4d4063b128e4186ad5619267120',
      },
      {
        entry: 'LICENSE.txt',
        to: 'licenses/MapleMono-OFL.txt',
        sha256: 'eb2d28d2e565a0757e3d64e34ebb452e75a0cad87c0ab3faf4e08ba7596de902',
      },
    ],
  },
]

const NOTICE = `Fonts bundled with Meridian

Inter — Copyright (c) 2016 The Inter Project Authors. SIL Open Font License 1.1, see Inter-OFL.txt.
Maple Mono — Copyright (c) 2022 subframe7536. SIL Open Font License 1.1, see MapleMono-OFL.txt.
MiSans, MiSans L3 — Copyright (c) Xiaomi Inc. This software uses MiSans.
  Used under the MiSans Font Intellectual Property License Agreement, see MiSans-License.pdf.
  https://hyperos.mi.com/font/

本软件使用了 MiSans 字体（小米公司版权所有），依据《MiSans 字体知识产权许可协议》使用，见 MiSans-License.pdf。
`

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** Returns the cached archive, downloading it when absent or not the pinned bytes. */
async function ensureArchive(source) {
  const dest = path.join(cacheDir, source.file)
  if (await exists(dest)) {
    const actual = await sha256File(dest)
    if (actual === source.sha256) return dest
    console.warn(`fonts: cached ${source.file} does not match its pinned hash; downloading again`)
    await rm(dest, { force: true })
  }
  await download(source, dest)
  return dest
}

/** True when every output of a source is already present with its pinned hash. */
async function outputsCurrent(items) {
  for (const item of items) {
    const dest = path.join(outDir, item.to)
    if (!(await exists(dest)) || (await sha256File(dest)) !== item.sha256) return false
  }
  return true
}

async function fetchSource(source) {
  const items = source.copyTo ? [{ to: source.copyTo, sha256: source.sha256 }] : source.extract
  if (await outputsCurrent(items)) return 'current'

  const archive = await ensureArchive(source)
  if (source.copyTo) {
    const dest = path.join(outDir, source.copyTo)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, await readFile(archive))
    return 'written'
  }

  const handle = await open(archive, 'r')
  try {
    const entries = await readZipDirectory(handle, source.file)
    for (const item of source.extract) {
      const dest = path.join(outDir, item.to)
      if ((await exists(dest)) && (await sha256File(dest)) === item.sha256) continue
      await extractEntry(archive, source.file, entries, handle, item, outDir)
    }
  } finally {
    await handle.close()
  }
  return 'written'
}

async function main() {
  await mkdir(cacheDir, { recursive: true })
  await mkdir(path.join(outDir, 'licenses'), { recursive: true })
  for (const source of SOURCES) {
    const state = await fetchSource(source)
    console.log(`fonts: ${source.name} ${state === 'current' ? 'up to date' : 'ready'}`)
  }
  const noticePath = path.join(outDir, 'licenses', 'NOTICE.txt')
  const current = (await exists(noticePath)) ? await readFile(noticePath, 'utf8') : null
  if (current !== NOTICE) await writeFile(noticePath, NOTICE)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof FontFetchError ? `fonts: ${err.message}` : err)
    // exitCode rather than exit(): exiting with undici's socket still closing
    // trips a libuv assertion on Windows and replaces the message with a crash.
    process.exitCode = 1
  })
}
