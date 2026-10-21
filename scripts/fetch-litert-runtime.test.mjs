import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { prepareRuntime, verifyFiles } from './fetch-litert-runtime.mjs'
import { extractEntry, readZipDirectory } from './lib/pinned-download.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const payloads = new Map([
  ['litert_lm/litert-lm.dll', Buffer.from('pinned test library, not executable')],
  ['litert_lm/dxcompiler.dll', Buffer.from('pinned compiler')],
  ['litert_lm/dxil.dll', Buffer.from('pinned dxil')],
])

function zip(entries) {
  const local = []
  const central = []
  let offset = 0
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt32LE(bytes.length, 18)
    header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(filename.length, 26)
    local.push(header, filename, bytes)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50)
    entry.writeUInt32LE(bytes.length, 20)
    entry.writeUInt32LE(bytes.length, 24)
    entry.writeUInt16LE(filename.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, filename)
    offset += 30 + filename.length + bytes.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

async function fixture(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'meridian-litert-test-'))
  assert.ok(path.basename(root).startsWith('meridian-litert-test-'))
  const archive = zip([...payloads, ['unselected.py', Buffer.from('must not be extracted or executed')]])
  let requests = 0
  const license = Buffer.from('test license')
  const server = createServer((req, res) => {
    requests += 1
    res.end(req.url === '/license' ? license : archive)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const platform = {
    library: 'litert-lm.dll',
    file: 'test.whl',
    url: `${base}/runtime`,
    sha256: hash(archive),
    files: [...payloads].map(([entry, body]) => ({
      entry,
      to: path.posix.basename(entry),
      size: body.length,
      sha256: hash(body),
    })),
  }
  const manifest = {
    version: '0.18.0',
    c_api_version: '0.2.0',
    license: { url: `${base}/license`, sha256: hash(license) },
    platforms: { 'windows-x86_64': platform },
  }
  await mkdir(path.join(root, 'src-tauri/crates/litert-lm'), { recursive: true })
  await writeFile(path.join(root, 'src-tauri/crates/litert-lm/runtime-manifest.json'), JSON.stringify(manifest))
  try {
    await fn({ root, platform, requests: () => requests, close: () => new Promise((resolve) => server.close(resolve)) })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
}

test('runtime preparation extracts only pinned files and a warm cache is offline', async () => {
  await fixture(async ({ root, platform, requests, close }) => {
    await prepareRuntime({ root, platformKey: 'windows-x86_64' })
    const out = path.join(root, 'src-tauri/resources')
    await verifyFiles(out, platform)
    assert.deepEqual((await readdir(out)).sort(), [
      'dxcompiler.dll',
      'dxil.dll',
      'litert-lm-LICENSE.txt',
      'litert-lm.dll',
    ])
    assert.equal(requests(), 2)
    await close()
    await prepareRuntime({ root, platformKey: 'windows-x86_64', checkOnly: true })
    await prepareRuntime({ root, platformKey: 'windows-x86_64' })
    assert.equal(requests(), 2)
  })
})

test('check rejects an old runtime instead of accepting the same filename', async () => {
  await fixture(async ({ root }) => {
    await prepareRuntime({ root, platformKey: 'windows-x86_64' })
    await writeFile(path.join(root, 'src-tauri/resources/litert-lm.dll'), 'old 0.17 runtime')
    await assert.rejects(prepareRuntime({ root, platformKey: 'windows-x86_64', checkOnly: true }), /mismatch/)
    await prepareRuntime({ root, platformKey: 'windows-x86_64' })
    assert.deepEqual(
      await readFile(path.join(root, 'src-tauri/resources/litert-lm.dll')),
      payloads.get('litert_lm/litert-lm.dll'),
    )
  })
})

test('same-sized changed bytes cannot bypass the runtime hash check', async () => {
  await fixture(async ({ root, platform }) => {
    await prepareRuntime({ root, platformKey: 'windows-x86_64' })
    const expected = platform.files.find((file) => file.to === 'litert-lm.dll')
    await writeFile(path.join(root, 'src-tauri/resources/litert-lm.dll'), Buffer.alloc(expected.size, 65))
    await assert.rejects(prepareRuntime({ root, platformKey: 'windows-x86_64', checkOnly: true }), /SHA-256 mismatch/)
  })
})

test('missing dependencies and unknown platforms are not silently optional', async () => {
  await fixture(async ({ root }) => {
    await assert.rejects(prepareRuntime({ root, platformKey: 'windows-x86_64', checkOnly: true }), /missing/)
    await assert.rejects(prepareRuntime({ root, platformKey: 'future-platform' }), /no pinned/)
    await assert.rejects(
      prepareRuntime({ root, platformKey: 'windows-x86_64', stageDir: path.join(root, 'missing-stage') }),
      /missing/,
    )
  })
})

test('an invalid license or changed file cannot pass the packaging check', async () => {
  await fixture(async ({ root }) => {
    await prepareRuntime({ root, platformKey: 'windows-x86_64' })
    await writeFile(path.join(root, 'src-tauri/resources/litert-lm-LICENSE.txt'), 'changed')
    await assert.rejects(prepareRuntime({ root, platformKey: 'windows-x86_64', checkOnly: true }), /license/)
  })
})

test('archive parser refuses duplicate entries, traversal, truncation and invalid offsets', async () => {
  await fixture(async ({ root }) => {
    for (const bytes of [
      zip([
        ['x', Buffer.from('a')],
        ['x', Buffer.from('b')],
      ]),
      zip([['../escape.dll', Buffer.from('bad')]]),
      Buffer.from('truncated'),
    ]) {
      const file = path.join(root, 'untrusted.zip')
      await writeFile(file, bytes)
      const handle = await open(file, 'r')
      try {
        await assert.rejects(readZipDirectory(handle, 'test.zip'))
      } finally {
        await handle.close()
      }
    }
    const bytes = zip([['x', Buffer.from('a')]])
    bytes.writeUInt32LE(0xfffffff0, bytes.length - 6)
    const file = path.join(root, 'invalid.zip')
    await writeFile(file, bytes)
    const handle = await open(file, 'r')
    try {
      await assert.rejects(readZipDirectory(handle, 'test.zip'), /bounds/)
    } finally {
      await handle.close()
    }
  })
})

test('entry extraction validates its pinned bytes and output target', async () => {
  await fixture(async ({ root }) => {
    const bytes = zip([['x', Buffer.from('a')]])
    const file = path.join(root, 'input.zip')
    await writeFile(file, bytes)
    const handle = await open(file, 'r')
    try {
      const entries = await readZipDirectory(handle, 'input.zip')
      await assert.rejects(
        extractEntry(file, 'input.zip', entries, handle, { entry: 'x', to: '../escape', sha256: hash('a') }, root),
        /outside/,
      )
      await assert.rejects(
        extractEntry(file, 'input.zip', entries, handle, { entry: 'x', to: 'bad', sha256: hash('b') }, root),
        /mismatch/,
      )
      assert.ok(!(await readdir(root)).includes('bad.part'))
    } finally {
      await handle.close()
    }
  })
})
