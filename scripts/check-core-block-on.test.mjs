// node --test --test-isolation=none scripts/check-core-block-on.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import { blockOnProblems } from './check-core-block-on.mjs'
import { loadSources } from './check-transaction-graph.mjs'

const CORE = 'src-tauri/crates/core/src'

function problemsFor(files) {
  const read = (p) => files[p] ?? null
  const list = (dir) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`))
  return blockOnProblems(loadSources(read, list))
}

test('block_on in core production code is refused', () => {
  const problems = problemsFor({
    [`${CORE}/bootstrap.rs`]: `
      pub fn start() -> Services {
          tokio::runtime::Handle::current().block_on(open())
      }`,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /bootstrap\.rs:3/)
})

test('test code may block on a future', () => {
  for (const source of [
    '#[cfg(test)]\nmod tests {\n    fn t() { rt.block_on(f()); }\n}',
    '#[test]\nfn t() { rt.block_on(f()); }',
    '#[tokio::test(flavor = "multi_thread")]\nasync fn t() { rt.block_on(f()); }',
    '#[cfg(test)]\nfn helper() { rt.block_on(f()); }',
  ]) {
    assert.deepEqual(problemsFor({ [`${CORE}/x.rs`]: source }), [], source)
  }
})

test('a file declared as a test module may block on a future', () => {
  const problems = problemsFor({
    [`${CORE}/db/sea/mod.rs`]: '#[cfg(test)]\nmod poc;',
    [`${CORE}/db/sea/poc.rs`]: 'fn helper() { rt.block_on(f()); }',
  })
  assert.deepEqual(problems, [])
})

test('the word in a comment or a string is not a call', () => {
  const problems = problemsFor({
    [`${CORE}/x.rs`]: '// never block_on(here)\nfn f() { let s = "block_on(x)"; }',
  })
  assert.deepEqual(problems, [])
})

test('only core is checked', () => {
  const problems = problemsFor({
    'src-tauri/src/lib.rs': 'fn setup() { tauri::async_runtime::block_on(bootstrap()); }',
    'src-tauri/crates/meridiand/src/main.rs': 'fn main() { runtime.block_on(bootstrap()); }',
  })
  assert.deepEqual(problems, [])
})
