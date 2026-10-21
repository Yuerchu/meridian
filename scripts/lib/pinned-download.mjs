import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw } from 'node:zlib'

export class ArtifactError extends Error {}
class TransientFetchError extends ArtifactError {}

export async function sha256File(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

function hashing(hash) {
  return new Transform({
    transform(chunk, _enc, done) {
      hash.update(chunk)
      done(null, chunk)
    },
  })
}

function mismatch(what, expected, actual) {
  return new ArtifactError(`${what}: SHA-256 mismatch\n  expected ${expected}\n  actual   ${actual}`)
}

export async function download(source, dest, { delays = [3000, 10000] } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadOnce(source, dest)
    } catch (error) {
      if (!(error instanceof TransientFetchError) || attempt >= delays.length) throw error
      console.warn(`assets: ${error.message}; trying again in ${delays[attempt] / 1000}s`)
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
    }
  }
}

async function downloadOnce(source, dest) {
  const part = `${dest}.part`
  console.log(`assets: downloading ${source.name} from ${source.url}`)
  let response
  try {
    response = await fetch(source.url)
  } catch (error) {
    throw new TransientFetchError(`${source.name}: download failed: ${error.cause?.message ?? error.message}`)
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    const Failure = response.status >= 500 || response.status === 429 ? TransientFetchError : ArtifactError
    throw new Failure(`${source.name}: download failed: HTTP ${response.status} ${response.statusText}`)
  }
  const hash = createHash('sha256')
  try {
    await pipeline(Readable.fromWeb(response.body), hashing(hash), createWriteStream(part))
  } catch (error) {
    await rm(part, { force: true })
    throw new TransientFetchError(`${source.name}: download interrupted: ${error.message}`)
  }
  const actual = hash.digest('hex')
  if (actual !== source.sha256) {
    await rm(part, { force: true })
    throw mismatch(source.name, source.sha256, actual)
  }
  await rename(part, dest)
}

async function readExactly(handle, buffer, position, name) {
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
  if (bytesRead !== buffer.length) throw new ArtifactError(`${name}: truncated zip`)
}

// 只读中央目录；数据描述符可能使本地文件头中的长度为零。
export async function readZipDirectory(handle, archiveName) {
  const { size } = await handle.stat()
  if (size < 22) throw new ArtifactError(`${archiveName}: not a zip archive`)
  const tailLength = Math.min(size, 0xffff + 22)
  const tail = Buffer.alloc(tailLength)
  await readExactly(handle, tail, size - tailLength, archiveName)
  let eocd = -1
  for (let i = tailLength - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tailLength) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ArtifactError(`${archiveName}: not a zip archive`)
  const count = tail.readUInt16LE(eocd + 10)
  const dirSize = tail.readUInt32LE(eocd + 12)
  const dirOffset = tail.readUInt32LE(eocd + 16)
  if (count === 0xffff || dirOffset === 0xffffffff || dirSize === 0xffffffff) {
    throw new ArtifactError(`${archiveName}: zip64 archives are not supported`)
  }
  if (tail.readUInt16LE(eocd + 4) !== 0 || tail.readUInt16LE(eocd + 6) !== 0) {
    throw new ArtifactError(`${archiveName}: multi-disk archives are not supported`)
  }
  if (dirOffset + dirSize > size - tailLength + eocd) {
    throw new ArtifactError(`${archiveName}: central directory is out of bounds`)
  }
  const dir = Buffer.alloc(dirSize)
  await readExactly(handle, dir, dirOffset, archiveName)
  const entries = new Map()
  let p = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.length || dir.readUInt32LE(p) !== 0x02014b50) {
      throw new ArtifactError(`${archiveName}: corrupt central directory`)
    }
    const flags = dir.readUInt16LE(p + 8)
    const method = dir.readUInt16LE(p + 10)
    const compressedSize = dir.readUInt32LE(p + 20)
    const uncompressedSize = dir.readUInt32LE(p + 24)
    const nameLength = dir.readUInt16LE(p + 28)
    const extraLength = dir.readUInt16LE(p + 30)
    const commentLength = dir.readUInt16LE(p + 32)
    const localOffset = dir.readUInt32LE(p + 42)
    const next = p + 46 + nameLength + extraLength + commentLength
    if (next > dir.length || localOffset + 30 > dirOffset) {
      throw new ArtifactError(`${archiveName}: entry is out of bounds`)
    }
    const name = dir.toString('utf8', p + 46, p + 46 + nameLength)
    if (name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) {
      throw new ArtifactError(`${archiveName}: unsafe entry name`)
    }
    if (entries.has(name)) throw new ArtifactError(`${archiveName}: duplicate entry ${name}`)
    entries.set(name, { flags, method, compressedSize, uncompressedSize, localOffset, dataLimit: dirOffset })
    p = next
  }
  if (p !== dir.length) throw new ArtifactError(`${archiveName}: inconsistent central directory`)
  return entries
}

// 目的路径只能来自调用方的固定清单，绝不采用归档条目的任意写入路径。
export async function extractEntry(archive, archiveName, entries, handle, item, outDir) {
  const entry = entries.get(item.entry)
  if (!entry) throw new ArtifactError(`${archiveName}: no entry named ${item.entry}`)
  if (entry.flags & 0x1) throw new ArtifactError(`${archiveName}: ${item.entry} is encrypted`)
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ArtifactError(`${archiveName}: ${item.entry} uses unsupported compression method ${entry.method}`)
  }
  const dest = path.resolve(outDir, item.to)
  const relative = path.relative(path.resolve(outDir), dest)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ArtifactError(`${archiveName}: output is outside the destination`)
  }
  const local = Buffer.alloc(30)
  await readExactly(handle, local, entry.localOffset, archiveName)
  if (local.readUInt32LE(0) !== 0x04034b50) throw new ArtifactError(`${archiveName}: corrupt local header`)
  const dataStart = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
  if (dataStart + entry.compressedSize > entry.dataLimit) {
    throw new ArtifactError(`${archiveName}: compressed data is out of bounds`)
  }
  const part = `${dest}.part`
  await mkdir(path.dirname(dest), { recursive: true })
  const hash = createHash('sha256')
  let length = 0
  const counter = new Transform({
    transform(chunk, _enc, done) {
      length += chunk.length
      if (length > entry.uncompressedSize) return done(new ArtifactError(`${archiveName}: size mismatch`))
      hash.update(chunk)
      done(null, chunk)
    },
  })
  const stages =
    entry.compressedSize === 0
      ? [Readable.from([])]
      : [createReadStream(archive, { start: dataStart, end: dataStart + entry.compressedSize - 1 })]
  if (entry.method === 8) stages.push(createInflateRaw())
  stages.push(counter, createWriteStream(part, { flags: 'wx' }))
  try {
    await pipeline(...stages)
    if (length !== entry.uncompressedSize) throw new ArtifactError(`${archiveName}: size mismatch`)
    const actual = hash.digest('hex')
    if (actual !== item.sha256) throw mismatch(`${archiveName}: ${item.entry}`, item.sha256, actual)
    await rename(part, dest)
  } catch (error) {
    await rm(part, { force: true })
    throw error
  }
}
