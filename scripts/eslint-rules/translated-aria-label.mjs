// No accessible name is written in English in the source.
//
// A literal `aria-label="Close"` renders, type-checks and passes every test
// written in English — and a Chinese screen reader then announces "Close". The
// base layer had seven of these (Modal and Sheet's close button, the spinner,
// the sidebar drawer, the link popover, the prompt queue), each a default the
// caller could override and some callers never did.
//
// Refused:
//
// - a JSX `aria-label` whose value is a string containing a Latin letter
//   (`aria-label="Close"`, `aria-label={'Close'}`, `` aria-label={`Close ${n}`} ``);
// - a string English fallback for one (`aria-label={x ?? 'Queued'}`, `|| 'Queued'`);
// - an English default for an `aria-label` prop (`{ 'aria-label': a = 'Close' }`).
//
// Allowed: `t(…)`, variables, props, and non-Latin literals. A template's
// `${…}` holes are code, not text, so only its literal chunks are asked.
//
// The third shape is exempt in vendored registry files (`boardui.json`),
// through the `allowPropDefaults` option eslint.config.js sets for them: their
// English defaults are the registry's own and stay byte-identical to it, so the
// rule there is that every caller passes the prop — which this rule cannot
// see, and the review checklist has to. This replaces
// `src/i18n/hardcoded-labels.test.ts`, which did the same with regular
// expressions over the source text.

const LATIN = /[A-Za-z]/

/** The text a string expression would put on screen, or null when it is not a
 *  string written in the source. Template holes are dropped. */
function literalText(node) {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('')
  return null
}

function isLatin(node) {
  const text = literalText(node)
  return text !== null && LATIN.test(text)
}

function keyName(key) {
  if (!key) return null
  if (key.type === 'Literal') return String(key.value)
  if (key.type === 'Identifier') return key.name
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'An aria-label is translated, never an English literal, fallback or default.' },
    schema: [
      {
        type: 'object',
        properties: { allowPropDefaults: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      literal:
        'English aria-label literal: a Chinese screen reader announces it as written. Use t(…) — or pass a label the caller translated.',
      fallback:
        'English fallback for an aria-label: whenever the left side is missing, a Chinese screen reader announces English. Fall back to t(…) instead.',
      propDefault:
        "English default for an 'aria-label' prop: every caller that omits it announces English. Default to t(…) inside the component, or make the prop required.",
    },
  },
  create(context) {
    const allowPropDefaults = context.options[0]?.allowPropDefaults === true
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'aria-label') return
        const value = node.value
        if (!value) return
        if (value.type === 'Literal') {
          if (isLatin(value)) context.report({ node: value, messageId: 'literal' })
          return
        }
        if (value.type !== 'JSXExpressionContainer') return
        const expr = value.expression
        if (isLatin(expr)) {
          context.report({ node: expr, messageId: 'literal' })
          return
        }
        if (expr.type === 'LogicalExpression' && (expr.operator === '??' || expr.operator === '||')) {
          if (isLatin(expr.right)) context.report({ node: expr.right, messageId: 'fallback' })
        }
      },
      Property(node) {
        if (allowPropDefaults) return
        if (node.parent?.type !== 'ObjectPattern') return
        if (keyName(node.key) !== 'aria-label') return
        if (node.value?.type !== 'AssignmentPattern') return
        if (isLatin(node.value.right)) context.report({ node: node.value.right, messageId: 'propDefault' })
      },
    }
  },
}
