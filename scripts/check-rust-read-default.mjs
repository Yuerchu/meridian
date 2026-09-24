#!/usr/bin/env node
// A failed read in a command is an error, not an empty value.
//
// The Rust half of `meridian-ui/no-default-on-load-failure`. `update_skill`
// filled a body it was not sent with
// `skills::read_skill_body(&root, &dir_name).unwrap_or_default()` and then
// wrote SKILL.md — so an unreadable file came back as a description with an
// empty body, over the real one. The frontend had the same defect four times.
//
// Deliberately narrow: a call to a `read_*` / `load_*` function whose result
// goes straight into `.unwrap_or_default()` (optionally through `.ok()`), in
// `src-tauri/src/commands/**`. That is the shape where a read's failure and
// "there is nothing" become one value. Wider nets — every `.ok()` on a
// `Result`, every `unwrap_or_default` — catch mostly display fallbacks and
// would be an allowlist to maintain rather than a gate; those stay with review
// (REVIEW-CHECKLIST.md).
//
// A line that is a genuine "absent means empty" read, never written back, can
// say so with `// read-default: <reason>` on the line before the call.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dirs = (process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['src-tauri/src/commands']).map((d) =>
  join(root, d),
)

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (name.endsWith('.rs')) out.push(path)
  }
  return out
}

// `read_x(a, f(b))` then optional `.ok()`, then `.unwrap_or_default()`, with
// rustfmt's line breaks between the links of the chain allowed.
const PATTERN =
  /\b((?:read|load)_\w*)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)(?:\s*\.\s*ok\s*\(\s*\))?\s*\.\s*unwrap_or_default\s*\(\s*\)/g

const hits = []
for (const file of dirs.flatMap(walk)) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  for (const match of text.matchAll(PATTERN)) {
    const line = text.slice(0, match.index).split('\n').length
    if (/\/\/\s*read-default:\s*\S/.test(lines[line - 2] ?? '')) continue
    hits.push(`${relative(root, file)}:${line}: ${match[1]}(…).unwrap_or_default()`)
  }
}

if (hits.length > 0) {
  for (const hit of hits) console.error(`  ${hit}`)
  console.error(
    `check-rust-read-default: ${hits.length} read(s) whose failure becomes an empty value. Return the error ` +
      '(`.ok_or_else(|| …)?` / `.map_err(…)?`) instead: a command that reads, merges and writes back would ' +
      'persist the default. A genuine "absent means empty" read says so with `// read-default: <reason>`.',
  )
  process.exit(1)
}
console.log('check-rust-read-default: no read-then-default in commands.')
