// An animation class must name an animation that exists.
//
// `animate-[shimmer_2s_linear_infinite]` compiles to `animation: … shimmer`
// whether or not any stylesheet defines `@keyframes shimmer`, and an animation
// with no keyframes is simply nothing: no error in the build, none in the
// browser, and none in the tests, which run jsdom with `css: false`. That is
// how the HeroUI-era `shimmer` outlived the stylesheet that defined it and
// every "thinking" label in the app stopped moving without anybody noticing.
//
// Two shapes are checked against the project's own stylesheets:
//   animate-[name_…]   the keyframes `name` must be defined;
//   animate-name       Tailwind's four built-ins, or a `--animate-name` theme
//                      variable / `@utility animate-name` somewhere in src.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BUILT_IN = new Set(['spin', 'ping', 'pulse', 'bounce', 'none'])

function collect(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) collect(path, out)
    else if (name.endsWith('.css')) out.push(readFileSync(path, 'utf8'))
  }
  return out
}

let cache = null

function definitions(root) {
  if (cache && cache.root === root) return cache
  const css = collect(join(root, 'src'), []).join('\n')
  const keyframes = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]))
  const utilities = new Set([
    ...[...css.matchAll(/--animate-([\w-]+)\s*:/g)].map((m) => m[1]),
    ...[...css.matchAll(/@utility\s+animate-([\w-]+)/g)].map((m) => m[1]),
    // The registry's globals.css also defines some as a plain class
    // (`.animate-check-draw { animation: … }`).
    ...[...css.matchAll(/\.animate-([\w-]+)\s*\{/g)].map((m) => m[1]),
  ])
  cache = { root, keyframes, utilities }
  return cache
}

// `animate-` not preceded by a word character or `-`, so `data-animate-x` and
// `motion-safe:animate-x` are told apart correctly (the latter is a variant).
// The name stops at `_`, which is where an arbitrary value's duration starts
// (and which `\w` would swallow).
const CLASS_RE = /(?<![\w-])animate-(?:\[([a-zA-Z0-9-]+)[_\]]|([a-z][a-zA-Z0-9-]*))/g

export default {
  meta: {
    type: 'problem',
    docs: { description: 'animate-* must name keyframes or an animation utility defined in the stylesheets.' },
    schema: [],
    messages: {
      noKeyframes:
        '`{{name}}` has no @keyframes in src/**/*.css, so this animation silently does nothing. Define the keyframes or use the registry recipe that already exists.',
      noUtility:
        '`animate-{{name}}` is neither a Tailwind built-in nor a --animate-{{name}} / @utility animate-{{name}} in src/**/*.css, so it compiles to nothing.',
    },
  },
  create(context) {
    const defs = definitions(context.cwd)
    function check(node, text) {
      for (const m of text.matchAll(CLASS_RE)) {
        const [, arbitrary, named] = m
        if (arbitrary !== undefined) {
          if (!defs.keyframes.has(arbitrary))
            context.report({ node, messageId: 'noKeyframes', data: { name: arbitrary } })
        } else if (!BUILT_IN.has(named) && !defs.utilities.has(named)) {
          context.report({ node, messageId: 'noUtility', data: { name: named } })
        }
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
