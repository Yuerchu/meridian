import assert from 'node:assert/strict'
import { test } from 'node:test'

import { closure, importSpecifiers, licenceFor, packageName, resolveRelative } from './yuerchu-ui.mjs'

test('importSpecifiers finds static, side-effect, type, re-export and dynamic imports', () => {
  const source = [
    'import { a } from "react";',
    'import type { B } from "../../lib/motion";',
    'import "./button.css";',
    'export { c } from "./c";',
    'export * from "./d";',
    'const lazy = () => import("pinyin-pro");',
    'import {',
    '  e,',
    '  f,',
    '} from "./multi";',
  ].join('\n')
  assert.deepEqual(importSpecifiers('x.tsx', source), [
    'react',
    '../../lib/motion',
    './button.css',
    './c',
    './d',
    'pinyin-pro',
    './multi',
  ])
})

test('importSpecifiers reads @import in CSS and nothing else there', () => {
  const css = '@import "./base.css";\n@import url("./tokens.css");\n.a { background: url("x.png") }'
  assert.deepEqual(importSpecifiers('index.css', css), ['./base.css', './tokens.css'])
})

test('importSpecifiers does not mistake prose for an import', () => {
  const source = '/** 高亮在服务端做：用 @yuerchu/ui/lib/highlight 的 highlight() 生成 html 传进来。 */'
  assert.deepEqual(importSpecifiers('code-block.tsx', source), [])
})

test('packageName keeps the scope and drops the subpath', () => {
  assert.equal(packageName('motion/react'), 'motion')
  assert.equal(packageName('@internationalized/date'), '@internationalized/date')
  assert.equal(packageName('libphonenumber-js/min'), 'libphonenumber-js')
  assert.equal(packageName('react-aria/private/live-announcer/LiveAnnouncer'), 'react-aria')
})

test('resolveRelative tries the file, then .ts/.tsx, then an index', () => {
  const files = new Set(['lib/motion.ts', 'lib/icons.tsx', 'components/button/button.css', 'lib/file-icons/index.ts'])
  const has = (file) => files.has(file)
  assert.equal(resolveRelative('components/button/button.tsx', '../../lib/motion', has), 'lib/motion.ts')
  assert.equal(resolveRelative('components/button/button.tsx', '../../lib/icons', has), 'lib/icons.tsx')
  assert.equal(resolveRelative('components/button/button.tsx', './button.css', has), 'components/button/button.css')
  assert.equal(resolveRelative('lib/a.ts', './file-icons', has), 'lib/file-icons/index.ts')
  assert.equal(resolveRelative('lib/a.ts', './missing', has), null)
})

test('licenceFor names the sibling licence file', () => {
  assert.equal(licenceFor('lib/icons.tsx'), 'lib/icons.LICENSE')
  assert.equal(licenceFor('styles/tokens.css'), 'styles/tokens.LICENSE')
})

function tree(files) {
  const map = new Map(Object.entries(files))
  return { read: (file) => map.get(file), has: (file) => map.has(file) }
}

test('closure follows relative imports transitively and collects packages', () => {
  const { read, has } = tree({
    'components/button/button.tsx':
      'import "./button.css";\nimport { m } from "motion/react";\nimport { i } from "../../lib/icons";',
    'components/button/button.css': '.ui-button {}',
    'lib/icons.tsx': 'import { x } from "./class-name";',
    'lib/icons.LICENSE': 'MIT',
    'lib/class-name.ts': 'import type { Y } from "react-aria-components";',
    'lib/unused.ts': 'import "./never";',
  })
  const result = closure(['components/button/button.tsx'], read, has)
  assert.deepEqual(result.files, [
    'components/button/button.css',
    'components/button/button.tsx',
    'lib/class-name.ts',
    'lib/icons.LICENSE',
    'lib/icons.tsx',
  ])
  assert.deepEqual(result.packages, ['motion', 'react-aria-components'])
  assert.deepEqual(result.unresolved, [])
})

test('closure reports an import it cannot resolve instead of skipping it', () => {
  const { read, has } = tree({ 'a.ts': 'import { b } from "./b";' })
  const result = closure(['a.ts', 'missing-entry.ts'], read, has)
  assert.deepEqual(result.unresolved, [
    { from: 'yuerchu-ui.json', spec: 'missing-entry.ts' },
    { from: 'a.ts', spec: './b' },
  ])
})

test('closure survives an import cycle', () => {
  const { read, has } = tree({ 'a.ts': 'import "./b";', 'b.ts': 'import "./a";' })
  assert.deepEqual(closure(['a.ts'], read, has).files, ['a.ts', 'b.ts'])
})
