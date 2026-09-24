// A static `@utility` takes no `/` modifier.
//
// `bg-button-primary` is not a colour in the theme: it is an `@utility` in
// src/styles/theme.css that paints a gradient and a hover `::before`. Tailwind
// only understands `/NN` on a utility that takes a value, so
// `bg-button-primary/10` compiles to *nothing* — no error in the build, none in
// the browser, none in jsdom (`css: false`). Three call sites shipped that way,
// each a pale accent wash that was never drawn. The light fill the registry
// uses is a token (`bg-button-ghost-background`, `bg-date-range-background`,
// `bg-dropdown-item-hover-background`), not an alpha of the button.
//
// The list is read from the stylesheets, as `animation-needs-keyframes` does,
// so a new static `@utility` is covered the day it is written. A functional
// utility (`@utility tab-* { … }`) takes a value and is left alone.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function collect(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) collect(path, out)
    else if (name.endsWith('.css')) out.push(readFileSync(path, 'utf8'))
  }
  return out
}

let cache = null

function staticUtilities(root) {
  if (cache && cache.root === root) return cache.names
  const css = collect(join(root, 'src'), []).join('\n')
  const names = new Set([...css.matchAll(/@utility\s+([\w-]+)\s*\{/g)].map((m) => m[1]))
  cache = { root, names }
  return names
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default {
  meta: {
    type: 'problem',
    docs: { description: 'A static @utility takes no /opacity (or any other) modifier; it compiles to nothing.' },
    schema: [],
    messages: {
      modifier:
        '`{{name}}/{{modifier}}` compiles to nothing: `{{name}}` is a static @utility in src/**/*.css, not a colour, and takes no modifier. Use a token for the light fill (e.g. bg-button-ghost-background, bg-date-range-background, bg-dropdown-item-hover-background).',
    },
  },
  create(context) {
    const names = staticUtilities(context.cwd)
    if (names.size === 0) return {}
    const re = new RegExp(`(?<![\\w-])(${[...names].map(escape).join('|')})/(\\[[^\\]\\s]*\\]|[\\w.]+)`, 'g')
    function check(node, text) {
      for (const m of text.matchAll(re)) {
        context.report({ node, messageId: 'modifier', data: { name: m[1], modifier: m[2] } })
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.raw)
      },
    }
  },
}
