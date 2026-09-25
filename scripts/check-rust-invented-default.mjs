#!/usr/bin/env node
// An unknown fact stays unknown — the Rust half of
// `meridian-ui/no-invented-domain-default`.
//
// `assistant.as_ref().map(|a| a.context_limit as usize).unwrap_or(128000)` in
// the chat command sized a turn with no assistant for a window nobody had
// configured. A value that describes a model, a provider or a configured limit
// is either known or it is `None`; `None` is carried to where it is shown or
// refused (`ok_or_else(|| …)?`), never replaced with a plausible number.
//
// Flagged: `.unwrap_or(<number>)`, `.unwrap_or(<CONST or path::CONST>)`,
// `.unwrap_or_else(|| <number or CONST>)`, `.map_or(<number or CONST>, …)` and
// `.unwrap_or_default()`, when the receiver (or the binding / field the result
// lands in) names domain vocabulary — `VOCABULARY` in
// `scripts/eslint-rules/domain-vocabulary.mjs`, shared with the ESLint rule.
// Method names do not count (`.len()`, `.max()`), only fields and bindings.
// `#[cfg(test)] mod` blocks are skipped: a fixture is allowed to invent.
//
// A genuine exception — a page size nobody configures, this app's own policy
// constant — says so with `// domain-default: <reason>` on the line before.
//
//   node scripts/check-rust-invented-default.mjs                 # src-tauri/src
//   node scripts/check-rust-invented-default.mjs src-tauri/crates/core/src
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vocabularyWord } from './eslint-rules/domain-vocabulary.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'tests' && name !== 'target') out.push(...walk(path))
    } else if (name.endsWith('.rs')) out.push(path)
  }
  return out
}

const NUMBER = String.raw`-?\d[\d_]*(?:\.\d[\d_]*)?(?:_?[iu](?:8|16|32|64|128|size)|_?f(?:32|64))?`
const CONST = String.raw`(?:[A-Za-z_]\w*::)*[A-Z][A-Z0-9_]*`
const FALLBACK = `(?:${NUMBER}|${CONST})`
const CALL = new RegExp(
  String.raw`\.\s*(?:unwrap_or\s*\(\s*(${FALLBACK})\s*\)|unwrap_or_else\s*\(\s*\|\|\s*(${FALLBACK})\s*\)|map_or\s*\(\s*(${FALLBACK})\s*,|(unwrap_or_default)\s*\(\s*\))`,
  'g',
)

/**
 * Where the brace that opens at `open` closes, skipping comments, strings,
 * raw strings and char literals — a `'{'` in a test must not end the module.
 */
function matchingBrace(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i)
      if (i === -1) return text.length
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1
      if (i === 0) return text.length
    } else if (c === 'r' && /^r#*"/.test(text.slice(i, i + 20)) && !/\w/.test(text[i - 1] ?? '')) {
      const hashes = /^r(#*)"/.exec(text.slice(i, i + 20))[1]
      const end = text.indexOf(`"${hashes}`, i + hashes.length + 2)
      if (end === -1) return text.length
      i = end + hashes.length
    } else if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
    } else if (c === "'") {
      // A char literal (`'{'`, `'\''`, `'\u{7b}'`); otherwise a lifetime.
      const literal = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'])'/.exec(text.slice(i, i + 12))
      if (literal) i += literal[0].length - 1
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return text.length
}

/**
 * The file with its `#[cfg(test)] mod … { … }` blocks blanked out — fixtures
 * may invent. Blanked rather than cut, so line numbers stay true: test modules
 * sit in the middle of files here as often as at the end.
 */
function withoutTests(text) {
  const header = /#\[cfg\(test\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/g
  let out = ''
  let from = 0
  for (const match of text.matchAll(header)) {
    if (match.index < from) continue
    const open = match.index + match[0].length - 1
    const close = matchingBrace(text, open)
    out += text.slice(from, match.index) + text.slice(match.index, close + 1).replace(/[^\n]/g, ' ')
    from = close + 1
  }
  return out + text.slice(from)
}

/**
 * The expression the call hangs off, read backwards from the `.` with brackets
 * balanced: `assistant.as_ref().map(|a| a.context_limit as usize)`. Stops at
 * the `=`, `,`, `;`, a field's single `:` or an unbalanced bracket that
 * starts it.
 */
function receiverStart(text, end) {
  let depth = 0
  let i = end - 1
  for (; i >= 0; i--) {
    const c = text[i]
    if (c === ')' || c === ']' || c === '}') {
      depth++
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) break
      depth--
      continue
    }
    if (depth > 0) continue
    if (c === ':') {
      if (text[i - 1] === ':') {
        i--
        continue
      }
      break
    }
    if (c === '>' && text[i - 1] === '=') break // `=>` of a match arm
    if (/[=,;|+*/%^!<>]/.test(c) && !(c === '!' && /\w/.test(text[i - 1] ?? ''))) {
      // `<`/`>` of a turbofish stay inside the receiver.
      if ((c === '<' || c === '>') && /::\s*$|\w$/.test(text.slice(Math.max(0, i - 3), i))) continue
      break
    }
  }
  return i + 1
}

/** The binding or field the result lands in: `let size_bytes =`, `file_size:`. */
function destination(text, start) {
  const before = text.slice(Math.max(0, start - 120), start)
  const binding = /(?:let\s+(?:mut\s+)?)?([A-Za-z_]\w*)\s*(?::\s*[\w<>:&' ]+)?\s*=\s*$/.exec(before)
  if (binding) return binding[1]
  const field = /([A-Za-z_]\w*)\s*:\s*$/.exec(before)
  return field ? field[1] : null
}

/**
 * Fields and bindings named in the receiver: identifiers not called as
 * functions or macros, not path segments, and not constants — a `TIMEOUT`
 * handed to a builder is the value, not the thing being defaulted.
 */
function subjectNames(receiver) {
  const names = []
  for (const match of receiver.matchAll(/[A-Za-z_]\w*/g)) {
    const next = receiver.slice(match.index + match[0].length).trimStart()
    if (next.startsWith('(') || next.startsWith('!') || next.startsWith('::')) continue
    if (/^[A-Z][A-Z0-9_]*$/.test(match[0])) continue
    names.push(match[0])
  }
  return names
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

const targets = (process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['src-tauri/src']).map((d) =>
  resolve(root, d),
)

const hits = []
for (const file of targets.flatMap(walk)) {
  const text = withoutTests(readFileSync(file, 'utf8'))
  const lines = text.split('\n')
  for (const match of text.matchAll(CALL)) {
    const fallback = match[1] ?? match[2] ?? match[3] ?? match[4]
    const start = receiverStart(text, match.index)
    const receiver = text.slice(start, match.index)
    const names = subjectNames(receiver)
    const dest = destination(text, start)
    if (dest) names.push(dest)
    const named = names.find((name) => vocabularyWord(name))
    if (!named) continue
    const line = lineOf(text, match.index)
    // The annotation sits on the line before the statement or before the call.
    const statementLine = lineOf(text, start)
    const annotated = [line - 2, statementLine - 2, statementLine - 3].some((l) =>
      /\/\/\s*domain-default:\s*\S/.test(lines[l] ?? ''),
    )
    if (annotated) continue
    hits.push(`${relative(root, file)}:${line}: \`${named}\` defaulted to ${fallback}`)
  }
}

if (hits.length > 0) {
  for (const hit of hits) console.error(`  ${hit}`)
  console.error(
    `check-rust-invented-default: ${hits.length} fact(s) about a model, provider or limit replaced with a value ` +
      'nobody configured. Keep it `None` and refuse or show it as unknown (`.ok_or_else(|| …)?`). A genuine ' +
      'exception says so with `// domain-default: <reason>` on the line before.',
  )
  process.exit(1)
}
console.log('check-rust-invented-default: no invented domain defaults.')
