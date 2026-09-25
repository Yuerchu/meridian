// An unknown fact stays unknown.
//
// `assistant?.context_limit ?? 128000` in the context hook: a model nobody had
// given a window was drawn against 128k, and the ring showed a ratio of the
// transcript to a number nobody chose. The owner's rule (2026-09): a value that
// describes the world — a context window, an output ceiling, a price, a rate, a
// timeout, a size, a budget — is either known or it is `null`, and `null` is
// drawn as unknown. It is never replaced with a plausible constant, because a
// reader cannot tell the constant from a configured value and neither can the
// code downstream of it. `no-parse-or-default` is the save-path half of this
// (an unparseable input); this is the read-path half (an absent one).
//
// Refused, when the name on the left is domain vocabulary (`VOCABULARY` in
// `domain-vocabulary.mjs`, shared with the Rust gate, matched per
// camelCase/snake_case word of the last property or identifier):
//
//   x.contextLimit ?? 128000        x.max_tokens || 4096
//   x.timeoutMs ?? DEFAULT_TIMEOUT  x.window ?? LIMITS.window
//   function f({ budget = 8000 })   const { priceTier = 1 } = row
//
// The right side counts when it is a number literal (including `0` and a
// negative), or an ALL_CAPS constant or a member of one. Not refused: a
// fallback that is itself nullable (`?? null`), a string or a boolean, or a
// call. A sum's `?? 0` accumulator and a collection's `.length ?? 0` are not
// caught because their names (`input`, `total`, `count`, `length`) are not
// vocabulary; keep it that way rather than widening the vocabulary into
// counts, where `?? 0` is usually the honest answer.
//
// Replace the fallback with `null` (and a type that says `number | null`), and
// draw the unknown state where the value is shown — with its own i18n text. A
// genuine exception (a layout constant that happens to be called `maxWidth`, a
// page size nobody configures) says so with a disable comment and a reason.

import { vocabularyWord } from './domain-vocabulary.mjs'

const ALL_CAPS = /^[A-Z][A-Z0-9_]*$/

function unwrap(node) {
  let current = node
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression')
  ) {
    current = current.expression
  }
  return current
}

/** The name a reader takes the value to be: the last property, or the identifier. */
function subjectName(node) {
  const target = unwrap(node)
  if (!target) return null
  if (target.type === 'Identifier') return target.name
  if (target.type === 'MemberExpression') {
    if (!target.computed && target.property.type === 'Identifier') return target.property.name
    if (target.computed && target.property.type === 'Literal' && typeof target.property.value === 'string') {
      return target.property.value
    }
  }
  // `a ?? b ?? 128000`: the chain's own left side names it.
  if (target.type === 'LogicalExpression' && (target.operator === '??' || target.operator === '||')) {
    return subjectName(target.left) ?? subjectName(target.right)
  }
  return null
}

function isNumberLiteral(node) {
  if (node.type === 'Literal' && typeof node.value === 'number') return true
  return node.type === 'UnaryExpression' && node.operator === '-' && isNumberLiteral(node.argument)
}

function capsRoot(node) {
  let current = node
  while (current && current.type === 'MemberExpression') current = current.object
  return current && current.type === 'Identifier' && ALL_CAPS.test(current.name) ? current.name : null
}

/** A value that asserts something: a number, or a named constant. */
function isAssertedValue(node) {
  const target = unwrap(node)
  if (!target) return false
  return isNumberLiteral(target) || capsRoot(target) !== null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No `?? N` / `|| N` / `= N` for a context window, limit, price, rate, timeout, size…: unknown stays null.',
    },
    schema: [],
    messages: {
      invented:
        '`{{name}}` is a fact about the model/provider/config, and `{{fallback}}` asserts a value nobody configured. ' +
        'Keep it `null` when unknown (type it `number | null`) and draw the unknown state where it is shown.',
    },
  },
  create(context) {
    const source = context.sourceCode

    function check(node, subject, fallback) {
      if (!isAssertedValue(fallback)) return
      const name = subjectName(subject)
      if (!name || !vocabularyWord(name)) return
      context.report({ node, messageId: 'invented', data: { name, fallback: source.getText(fallback) } })
    }

    return {
      LogicalExpression(node) {
        if (node.operator !== '??' && node.operator !== '||') return
        check(node, node.left, node.right)
      },
      AssignmentExpression(node) {
        if (node.operator !== '??=' && node.operator !== '||=') return
        check(node, node.left, node.right)
      },
      // `function f(limit = 4096)`, `const { maxTokens = 4096 } = row`.
      AssignmentPattern(node) {
        check(node, node.left, node.right)
      },
    }
  },
}
