// The names that describe a fact about the world — a model, a provider, a
// configured limit — rather than about this app's layout. Shared by the ESLint
// rule `no-invented-domain-default` and `scripts/check-rust-invented-default.mjs`,
// so the TypeScript and Rust gates cannot come to disagree about what a
// "domain" name is.
//
// Matched per word: `maxOutputTokens` → max, output, tokens; `context_limit`
// → context, limit. `context` itself is not a word here — `contextRefs` and
// `context_items` are lists, and every window worth catching also says
// `limit` or `window`. `token` in the singular is an auth or idempotency token
// far more often than a count, so only `tokens` counts.

export const VOCABULARY = new Set([
  'budget',
  'ceiling',
  'cost',
  'costs',
  'deadline',
  'limit',
  'limits',
  'max',
  'price',
  'prices',
  'quota',
  'rate',
  'rates',
  'size',
  'threshold',
  'timeout',
  'tokens',
  'ttl',
  'window',
])

/**
 * `size` alone is an icon's pixels or a `Set`'s cardinality far more often than
 * a window, so it counts only inside a compound name (`sizeBytes`,
 * `file_size`). The cost is `usage.size ?? 128000` going unseen; review has it.
 */
const COMPOUND_ONLY = new Set(['size'])

/** `maxOutputTokens` → [max, output, tokens]; `context_limit` → [context, limit]. */
export function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** The vocabulary word a name carries, or null when it carries none. */
export function vocabularyWord(name) {
  const parts = words(name)
  return parts.find((word) => VOCABULARY.has(word) && (parts.length > 1 || !COMPOUND_ONLY.has(word))) ?? null
}
