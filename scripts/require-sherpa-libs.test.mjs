import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const script = join(fileURLToPath(new URL('.', import.meta.url)), '..', '.github', 'scripts', 'require-sherpa-libs.sh')
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash'

function run(target) {
  return spawnSync(bash, [script], {
    encoding: 'utf8',
    env: { ...process.env, SHERPA_TARGET_DIR: target },
  })
}

test('a fingerprint without the runtime DLL is cleared, not treated as a cold tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'sherpa-libs-'))
  try {
    mkdirSync(join(root, 'debug', '.fingerprint', 'sherpa-onnx-sys-abc'), { recursive: true })
    writeFileSync(join(root, 'debug', '.fingerprint', 'sherpa-onnx-sys-abc', 'dep-build'), '')
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /runtime library missing/)
    assert.doesNotMatch(result.stdout, /nothing built yet/)
    assert.equal(existsSync(join(root, 'debug', '.fingerprint', 'sherpa-onnx-sys-abc')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a present DLL is left alone', () => {
  const root = mkdtempSync(join(tmpdir(), 'sherpa-libs-'))
  try {
    mkdirSync(join(root, 'debug'), { recursive: true })
    writeFileSync(join(root, 'debug', 'sherpa-onnx-c-api.dll'), '')
    mkdirSync(join(root, 'debug', '.fingerprint', 'sherpa-onnx-sys-abc'), { recursive: true })
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /runtime library present/)
    assert.equal(existsSync(join(root, 'debug', '.fingerprint', 'sherpa-onnx-sys-abc')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
