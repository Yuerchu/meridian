// The retry rule in scripts/fetch-fonts.mjs, against a local server: a
// dropped connection is tried again, while a 404 or the wrong bytes are not.
// Run with `pnpm lint:rules`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { download } from './fetch-fonts.mjs'

const BODY = Buffer.alloc(256 * 1024, 7)
const SHA = createHash('sha256').update(BODY).digest('hex')

/** A server whose nth request is answered by `answer(n, res)`. */
async function serve(answer) {
  let requests = 0
  const server = createServer((req, res) => answer(++requests, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}/font.zip`,
    requests: () => requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function withDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'fonts-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const quick = { delays: [0, 0] }

/** Both transient paths: before the response (`fetch` itself rejects) and
 *  during the body (the stream breaks after bytes have been written). */
test('a connection that fails before the response is tried again', async () => {
  const server = await serve((n, res) => {
    if (n === 1) {
      res.socket.destroy()
      return
    }
    res.end(BODY)
  })
  try {
    await withDir(async (dir) => {
      const dest = path.join(dir, 'font.zip')
      await download({ name: 'test', url: server.url, sha256: SHA }, dest, quick)
      assert.equal(server.requests(), 2)
      assert.deepEqual(await readFile(dest), BODY)
    })
  } finally {
    await server.close()
  }
})

test('a connection dropped mid-download is tried again', async () => {
  const server = await serve((n, res) => {
    res.writeHead(200, { 'content-length': BODY.length })
    if (n === 1) {
      // Headers and some body on the wire first, so the client is reading
      // the stream when it breaks — the "interrupted" path, not `fetch`'s.
      res.flushHeaders()
      res.write(BODY.subarray(0, 64 * 1024))
      setTimeout(() => res.socket.destroy(), 50)
    } else {
      res.end(BODY)
    }
  })
  try {
    await withDir(async (dir) => {
      const dest = path.join(dir, 'font.zip')
      await download({ name: 'test', url: server.url, sha256: SHA }, dest, quick)
      assert.equal(server.requests(), 2)
      assert.deepEqual(await readFile(dest), BODY)
    })
  } finally {
    await server.close()
  }
})

test('a 404 is not tried again', async () => {
  const server = await serve((_n, res) => {
    res.writeHead(404)
    res.end()
  })
  try {
    await withDir(async (dir) => {
      await assert.rejects(
        download({ name: 'test', url: server.url, sha256: SHA }, path.join(dir, 'font.zip'), quick),
        /HTTP 404/,
      )
      assert.equal(server.requests(), 1)
    })
  } finally {
    await server.close()
  }
})

test('the wrong bytes are not tried again', async () => {
  const server = await serve((_n, res) => res.end(Buffer.from('not the font')))
  try {
    await withDir(async (dir) => {
      await assert.rejects(
        download({ name: 'test', url: server.url, sha256: SHA }, path.join(dir, 'font.zip'), quick),
        /SHA-256 mismatch/,
      )
      assert.equal(server.requests(), 1)
    })
  } finally {
    await server.close()
  }
})
