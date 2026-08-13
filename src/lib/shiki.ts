import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

/**
 * One Shiki highlighter for the whole app, assembled by hand.
 *
 * Not `shiki`'s own entry point: that one reaches every grammar it ships, which
 * Vite turns into a chunk apiece — several hundred of them — and pulls in the
 * oniguruma WASM besides. Here the engine is the JavaScript one (no WASM at
 * all) and grammars are named one at a time below, so a language costs a chunk
 * only if this project can actually produce it.
 *
 * The important part for callers: `codeToHtml` on a highlighter *instance* is
 * synchronous. Only the package-level shorthand is async. So a diff can be
 * coloured a line at a time, hundreds of lines per render, without a promise in
 * sight — as long as the grammar was loaded first, which is what `isReady` and
 * `ensureLanguage` are for.
 */

/** Grammars worth their chunk. Anything else renders as plain text. */
const LOADERS: Record<string, () => Promise<unknown>> = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  docker: () => import('@shikijs/langs/docker'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  lua: () => import('@shikijs/langs/lua'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
}

/** What a fence label or a file extension goes by above. */
const ALIASES: Record<string, string> = {
  ts: 'typescript', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', golang: 'go', cs: 'csharp',
  'c++': 'cpp', 'c#': 'csharp', h: 'c', hpp: 'cpp', kt: 'kotlin',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', ps1: 'powershell',
  yml: 'yaml', md: 'markdown', dockerfile: 'docker', htm: 'html',
  patch: 'diff', svelte: 'html', scss: 'css', less: 'css',
}

export const PLAIN = 'plaintext'

/** The grammar id this label resolves to, or `PLAIN` if we do not carry it. */
export function resolveLanguage(label: string | null | undefined): string {
  if (!label) return PLAIN
  const key = label.toLowerCase()
  const id = ALIASES[key] ?? key
  return id in LOADERS ? id : PLAIN
}

let highlighter: HighlighterCore | null = null
let starting: Promise<HighlighterCore> | null = null
const loading = new Map<string, Promise<void>>()

function start(): Promise<HighlighterCore> {
  starting ??= (async () => {
    const [light, dark] = await Promise.all([
      import('@shikijs/themes/github-light'),
      import('@shikijs/themes/github-dark'),
    ])
    highlighter = await createHighlighterCore({
      themes: [light.default, dark.default],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
    return highlighter
  })()
  return starting
}

/** Whether `highlight` can be called for this language right now. */
export function isReady(language: string): boolean {
  if (!highlighter) return false
  if (language === PLAIN) return true
  return highlighter.getLoadedLanguages().includes(language)
}

/** Loads the grammar, and the highlighter itself the first time. */
export async function ensureLanguage(language: string): Promise<void> {
  const core = await start()
  if (language === PLAIN || core.getLoadedLanguages().includes(language)) return
  const loader = LOADERS[language]
  if (!loader) return
  let pending = loading.get(language)
  if (!pending) {
    // A failed grammar must not poison the map, or the language stays broken
    // for the rest of the session.
    pending = core.loadLanguage(loader as never).catch(() => {}).finally(() => loading.delete(language))
    loading.set(language, pending)
  }
  await pending
}

/**
 * Both themes at once: Shiki writes `--shiki-light` and `--shiki-dark` onto
 * every token and a stylesheet rule picks the side, so switching theme costs
 * nothing at runtime and needs no second pass.
 */
const THEMES = { light: 'github-light', dark: 'github-dark' } as const

/** A whole block, `<pre><code>` and all. Call only when `isReady`. */
export function highlight(code: string, language: string): string {
  if (!highlighter) return ''
  return highlighter.codeToHtml(code, { lang: language, themes: THEMES, defaultColor: false })
}

/**
 * One line, as bare spans with no `<pre>` around them.
 *
 * For diffs, where each line has to sit in its own row next to a marker and a
 * line number. A diff is not a program — its lines come from two versions with
 * the context between them missing — so there is no whole to parse anyway.
 */
export function highlightInline(text: string, language: string): string {
  if (!highlighter) return ''
  return highlighter.codeToHtml(text, {
    lang: language,
    themes: THEMES,
    defaultColor: false,
    structure: 'inline',
  })
}
