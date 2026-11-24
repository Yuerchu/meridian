import test from 'node:test'
import assert from 'node:assert/strict'
import { crateFor, mismatches, looseNpmSpecifiers, looseCargoPins } from './check-tauri-versions.mjs'

test('api pairs with the tauri crate; plugins with tauri-plugin-*', () => {
  assert.equal(crateFor('@tauri-apps/api'), 'tauri')
  assert.equal(crateFor('@tauri-apps/plugin-shell'), 'tauri-plugin-shell')
  assert.equal(crateFor('@tauri-apps/cli'), null)
})

test('mismatches only when major.minor disagrees', () => {
  const cargo = new Map([
    ['tauri', new Set(['2.12.5'])],
    ['tauri-plugin-shell', new Set(['2.5.0'])],
  ])
  const npm = new Map([
    ['@tauri-apps/api', '2.12.4'],
    ['@tauri-apps/plugin-shell', '2.6.0'],
  ])
  assert.deepEqual(mismatches(cargo, npm), ['tauri-plugin-shell (v2.5.0) : @tauri-apps/plugin-shell (v2.6.0)'])
})

test('a caret npm specifier is the jump that desyncs the pair', () => {
  const problems = looseNpmSpecifiers({
    dependencies: {
      '@tauri-apps/api': '^2.12.4',
      '@tauri-apps/plugin-shell': '~2.5.0',
    },
    devDependencies: { '@tauri-apps/cli': '^2.12.4' },
  })
  assert.deepEqual(problems, [
    '@tauri-apps/api specifier ^2.12.4 allows a minor jump; use ~',
    '@tauri-apps/cli specifier ^2.12.4 allows a minor jump; use ~',
  ])
})

test('tilde and exact npm specifiers are accepted', () => {
  assert.deepEqual(
    looseNpmSpecifiers({
      dependencies: {
        '@tauri-apps/api': '~2.12.4',
        '@tauri-apps/plugin-dialog': '=2.8.3',
      },
    }),
    [],
  )
})

test('a cargo pin without ~ is caret and lets cargo update jump minor', () => {
  const toml = `
tauri = { version = "2.12", features = ["tray-icon"] }
tauri-plugin-shell = "2.5"
tauri-plugin-notification = "~2.4"
`
  assert.deepEqual(looseCargoPins(toml), [
    'tauri = 2.12 allows a minor jump; use ~',
    'tauri-plugin-shell = 2.5 allows a minor jump; use ~',
  ])
})

test('tilde cargo pins are accepted', () => {
  const toml = `
tauri-build = { version = "~2.7", features = [] }
tauri = { version = "~2.12", features = ["tray-icon"] }
tauri-plugin-shell = "~2.5"
`
  assert.deepEqual(looseCargoPins(toml), [])
})
