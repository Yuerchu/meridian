// Fixtures for scripts/check-rust-invented-default.mjs, run by `pnpm lint:rules`.
// Each flagged case is a shape that shipped (or the one the vocabulary exists
// for); each clean case is its fix or a neutral default the gate must leave
// alone. A gate that stays green when a flagged case is pasted back is not one.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./check-rust-invented-default.mjs', import.meta.url))

function check(source) {
  const dir = mkdtempSync(join(tmpdir(), 'invented-default-'))
  try {
    writeFileSync(join(dir, 'sample.rs'), source)
    const run = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })
    return { flagged: run.status !== 0, output: run.stderr + run.stdout }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const FLAGGED = {
  // chat.rs: a turn with no assistant sized for a window nobody configured.
  'a window from nowhere': `fn f() { let context_limit = assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128000); }`,
  // emoji.rs: an unreadable file stored as 0 bytes.
  'a size into a struct field': `fn f() { g(Row { file_size: std::fs::metadata(p).map(|m| m.len() as i64).unwrap_or(0) }); }`,
  // ime/dictionary.rs: the binding names it, the receiver does not.
  'a size into a binding': `fn f() { let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0); }`,
  'an output ceiling on the wire': `fn f() { body["max_tokens"] = json!(params.max_tokens.unwrap_or(4096)); }`,
  'a constant is still invented': `fn f() { let t = tool.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS); }`,
  'a path constant': `fn f() { let t = cfg.request_timeout.unwrap_or(limits::REQUEST_TIMEOUT); }`,
  unwrap_or_else: `fn f() { let w = profile.context_window.unwrap_or_else(|| 200_000); }`,
  map_or: `fn f() { let b = cfg.budget.map_or(8_000, |b| b as usize); }`,
  unwrap_or_default: `fn f() { let price = row.input_price.unwrap_or_default(); }`,
  'across rustfmt line breaks': `fn f() {\n    let limit = row\n        .context_limit\n        .unwrap_or(128_000);\n}`,
  // The first version cut every file at its first test module, and chat.rs has
  // one at line 468 of ~2000: the mutation that restored the original defect
  // stayed green. A brace in a char literal must not end the module early either.
  'code after a mid-file test module': `#[cfg(test)]\nmod contract_tests {\n    fn g() { let c = '{'; let s = "}"; }\n}\nfn f() { let context_limit = a.context_limit.unwrap_or(128000); }`,
}

const CLEAN = {
  'the fix: refuse': `fn f() -> Result<(), String> { let w = profile.context_window.ok_or_else(|| "no window".to_string())?; Ok(()) }`,
  'the fix: carry None': `fn f() { let size_bytes = std::fs::metadata(&path).map(|m| m.len()).ok(); }`,
  'a count is not vocabulary': `fn f() { let count = counts.get(&id).copied().unwrap_or(0); }`,
  'a method named max is not a field': `fn f() { let w = rows.iter().map(|e| e.name.len()).max().unwrap_or(4); }`,
  'a constant handed to a builder': `fn f() { let c = Client::builder().timeout(REQUEST_TIMEOUT).build().unwrap_or_default(); }`,
  'an attempt token is not a token count': `fn f() { let t = row.attempt_token.clone().unwrap_or_default(); }`,
  'an annotated exception': `fn f() {\n    // domain-default: a page size the caller did not ask about\n    let limit = request.limit.unwrap_or(20);\n}`,
  'fixtures may invent': `fn f() {}\n#[cfg(test)]\nmod tests {\n    fn g() { let context_limit = a.context_limit.unwrap_or(128000); }\n}`,
}

describe('check-rust-invented-default', () => {
  for (const [name, source] of Object.entries(FLAGGED)) {
    it(`flags: ${name}`, () => {
      const { flagged, output } = check(source)
      assert.ok(flagged, `expected a hit, got: ${output}`)
    })
  }
  for (const [name, source] of Object.entries(CLEAN)) {
    it(`leaves alone: ${name}`, () => {
      const { flagged, output } = check(source)
      assert.ok(!flagged, `expected no hit, got: ${output}`)
    })
  }
})
