// A read that failed is not an empty value.
//
// Four times in this repository a settings page answered a failed load by
// putting a default into state, and every one of them was a form that could
// then be saved: `getSkillBody().catch(() => setBody(''))` wrote an empty
// SKILL.md body back over the real one, auto-review drew DEFAULTS after its
// load failed, the model page read a failed `Promise.all` as a new form, and
// general settings took its first-frame defaults for the stored values. The
// defect is the same each time: an error is converted into a value that is
// indistinguishable from "the user has nothing here", and the save path cannot
// tell the difference.
//
// This rule refuses the conversion at its source: inside a rejection handler
// — `.catch(cb)`, the second argument of `.then(ok, cb)`, or a `catch {}`
// block — a `set*` state setter called with a literal default: `''`, an empty
// template, `[]`, `{}`, `null`, `undefined`, `0`, `false`, `new Set()`,
// `new Map()`, or anything named or derived from `DEFAULT…`/`default…`.
// Busy flags (`setSaving`, `setDeletingId`) are exempt. The replacement is an
// error state (an Alert with a retry) that keeps the form from saving. A
// read-only display where "nothing" is genuinely what a failure should show,
// and nothing can be written back from it, says so with a disable comment and
// a reason.

const DEFAULT_NAME = /^(DEFAULT|default)/

function rootIdentifier(node) {
  let current = node
  while (current && current.type === 'MemberExpression') current = current.object
  return current && current.type === 'Identifier' ? current : null
}

function isDefaultValue(node) {
  if (!node) return false
  switch (node.type) {
    case 'Literal':
      return node.value === '' || node.value === null || node.value === 0 || node.value === false
    case 'TemplateLiteral':
      return node.expressions.length === 0 && node.quasis.every((q) => q.value.cooked === '')
    case 'ArrayExpression':
      return node.elements.length === 0
    case 'ObjectExpression':
      return (
        node.properties.length === 0 ||
        node.properties.some((p) => p.type === 'SpreadElement' && isDefaultName(p.argument))
      )
    case 'Identifier':
      return node.name === 'undefined' || DEFAULT_NAME.test(node.name)
    case 'MemberExpression':
      return isDefaultName(node)
    case 'CallExpression':
      // `DEFAULTS.args.join(...)`: a value derived from a default is one.
      return node.callee.type === 'MemberExpression' && isDefaultName(node.callee)
    case 'NewExpression':
      return (
        node.callee.type === 'Identifier' &&
        (node.callee.name === 'Set' || node.callee.name === 'Map') &&
        node.arguments.length === 0
      )
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return isDefaultValue(node.expression)
    default:
      return false
  }
}

function isDefaultName(node) {
  const root = rootIdentifier(node)
  return root !== null && DEFAULT_NAME.test(root.name)
}

// `setSaving(false)`, `setDeletingId(null)`: a busy flag put back after a
// failed action is not a value the form can save.
const BUSY_SETTER = /^set[A-Z]\w*ing(Id|Key)?$/

function isSetterCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    /^set[A-Z]\w*$/.test(node.callee.name) &&
    !BUSY_SETTER.test(node.callee.name) &&
    node.arguments.length >= 1 &&
    isDefaultValue(node.arguments[0])
  )
}

const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'])

// Walk a handler's body without descending into nested functions: a callback
// scheduled from inside the handler is not the handler's answer to the failure.
function* setterCalls(node, visitorKeys) {
  if (!node || typeof node.type !== 'string') return
  if (isSetterCall(node)) yield node
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key]
    const children = Array.isArray(child) ? child : [child]
    for (const c of children) {
      if (c && typeof c.type === 'string' && !FUNCTION_TYPES.has(c.type)) yield* setterCalls(c, visitorKeys)
    }
  }
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'A failed read must not be turned into an empty/default value in state.' },
    schema: [],
    messages: {
      defaultOnFailure:
        'A failed read must not masquerade as an empty/default value ({{setter}}): the save path cannot tell it ' +
        'from real data and will write it back. Enter an error state (Alert + retry) and disable saving instead.',
    },
  },
  create(context) {
    const visitorKeys = context.sourceCode.visitorKeys

    function checkHandler(fn) {
      if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return
      for (const call of setterCalls(fn.body, visitorKeys)) {
        context.report({ node: call, messageId: 'defaultOnFailure', data: { setter: call.callee.name } })
      }
    }

    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return
        if (callee.property.name === 'catch') checkHandler(node.arguments[0])
        else if (callee.property.name === 'then') checkHandler(node.arguments[1])
      },
      CatchClause(node) {
        for (const call of setterCalls(node.body, visitorKeys)) {
          context.report({ node: call, messageId: 'defaultOnFailure', data: { setter: call.callee.name } })
        }
      },
    }
  },
}
