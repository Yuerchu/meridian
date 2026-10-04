import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectAndroidAbsent,
  evalOnAndroid,
  expandUse,
  findViolations,
  parseCfg,
  stripRust,
} from './android-cfg-lib.mjs'

const onAndroid = (pred) => evalOnAndroid(parseCfg(`cfg(${pred})`).args[0])

test('a cfg is false on Android only when it cannot hold there', () => {
  assert.equal(onAndroid('not(target_os = "android")'), false)
  assert.equal(onAndroid('desktop'), false)
  assert.equal(onAndroid('windows'), false)
  assert.equal(onAndroid('test'), false)
  assert.equal(onAndroid('all(feature = "x", not(target_os = "android"))'), false)
  // `unix` holds on Android, and an unknown feature decides nothing.
  assert.equal(onAndroid('unix'), true)
  assert.equal(onAndroid('feature = "x"'), null)
  assert.equal(onAndroid('any(windows, feature = "x")'), null)
})

test('comments and strings are blanked without moving anything', () => {
  const src = 'let a = "meridian_core::acp"; // services.acp\nlet b = 1;'
  const out = stripRust(src)
  assert.equal(out.length, src.length)
  assert.ok(!out.includes('acp'))
  assert.equal(out.indexOf('let b'), src.indexOf('let b'))
})

test('a use tree expands to every path it names', () => {
  assert.deepEqual(expandUse('meridian_core::{acp, tools::{a, b as c}}'), [
    ['meridian_core', 'acp'],
    ['meridian_core', 'tools', 'a'],
    ['meridian_core', 'tools', 'b'],
  ])
})

const CORE = {
  'lib.rs': `#[cfg(not(target_os = "android"))]\npub mod onebot;\n#[cfg(not(target_os = "android"))]\npub mod sandbox;\npub mod agent;`,
  'services.rs': `pub struct ServicesInner {\n    pub db: Pool,\n    /// Absent on Android.\n    #[cfg(not(target_os = "android"))]\n    pub acp: Arc<AcpRegistry>,\n}`,
  // A desktop body with an Android twin under the same name is not absent.
  'agent/mod.rs': `#[cfg(not(target_os = "android"))]\npub fn load() {}\n#[cfg(target_os = "android")]\npub fn load() {}\n#[cfg(desktop)]\npub fn desk() {}`,
}
const absent = collectAndroidAbsent(CORE)
const check = (src, file = 'commands/x.rs') => findViolations({ [file]: src }, absent)

test('what core lacks on Android is read off its own cfgs', () => {
  const paths = absent.paths.map((p) => p.join('::'))
  assert.ok(paths.includes('onebot') && paths.includes('sandbox') && paths.includes('agent::desk'))
  assert.ok(!paths.includes('agent::load'), 'an Android twin keeps the path alive')
  assert.ok(!paths.includes('agent'))
  assert.deepEqual(absent.servicesFields, ['acp'])
})

// The three that reached CI's Android check: 068a93a, 6707c62, cbc60c2.
test('each historical shape is caught when ungated', () => {
  assert.equal(check('fn f() { let s = meridian_core::sandbox::CommandSettings::read(); }').length, 1)
  assert.equal(check('async fn f() { meridian_core::onebot::refresh_voice_policy(&s, &c).await }').length, 1)
  assert.equal(check('async fn f(services: S) { if let Some(x) = services.acp.get(&id) { x.go() } }').length, 1)
  assert.equal(check('fn f(app: A) { let r = app.services().acp.get(&id); }').length, 1)
  assert.equal(check('use meridian_core::{agent, onebot};').length, 1)
})

test('each historical shape passes behind a cfg that is false on Android', () => {
  const gated = [
    // the statement
    'async fn f(services: S) {\n    #[cfg(not(target_os = "android"))]\n    if let Some(x) = services.acp.get(&id) { x.go() }\n}',
    // a block, and a let with a closure
    'fn f() {\n    #[cfg(not(target_os = "android"))]\n    {\n        meridian_core::onebot::refresh();\n    }\n    #[cfg(desktop)]\n    let r = || async move { meridian_core::onebot::refresh().await };\n}',
    // the item, with a generic comma in its signature
    '#[cfg(not(target_os = "android"))]\nasync fn f(s: &S) -> Result<Vec<u8>, String> { let a = meridian_core::sandbox::x(); Ok(a) }',
    // a struct literal's field
    'fn f() -> C { C {\n    #[cfg(not(target_os = "android"))]\n    sandbox_policy: meridian_core::sandbox::CommandSandbox::UNCONFINED,\n    other: 1,\n} }',
    // the use
    '#[cfg(desktop)]\nuse meridian_core::onebot::refresh;',
  ]
  for (const src of gated) assert.deepEqual(check(src), [], src)
})

test('a cfg that holds on Android does not count as gating', () => {
  assert.equal(check('#[cfg(unix)]\nfn f() { meridian_core::onebot::x(); }').length, 1)
  assert.equal(
    check('fn f() {\n    // #[cfg(not(target_os = "android"))]\n    meridian_core::onebot::x();\n}').length,
    1,
  )
})

test('a whole file or module can be gated', () => {
  assert.deepEqual(check('#![cfg(not(target_os = "android"))]\nfn f() { meridian_core::onebot::x(); }'), [])
  const shell = {
    'lib.rs': '#[cfg(desktop)]\nmod remote;\nmod commands;',
    'remote/mod.rs': 'fn f() { meridian_core::onebot::x(); }',
    'commands/mod.rs': '#[cfg(not(target_os = "android"))]\npub mod acp;\npub mod queue;',
    'commands/acp.rs': 'fn f(services: S) { services.acp.get(1); }',
    'commands/queue.rs': 'fn f(services: S) { services.acp.get(1); }',
  }
  assert.deepEqual(
    findViolations(shell, absent).map((v) => v.file),
    ['commands/queue.rs'],
  )
})
