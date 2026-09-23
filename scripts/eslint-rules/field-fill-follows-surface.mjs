// A text field keeps the registry's fill; where it is invisible, the surface
// under it is what changes.
//
// The registry field is the tertiary well (`bg-background-tertiary-default`),
// and in the dark theme that is neutral-800 — exactly the fill of
// `background-primary-default`. Twice now a field (and once a switch track,
// which is the same token) has vanished on a primary card, and each time the
// tempting fix was to paint that one field another colour, which makes every
// field its own decision and the next one wrong again. BoardUI's own answer is
// narrower: the one fill it ever puts on a field is the secondary one, on the
// lighter surface (`data-table.tsx`, `settings-storage.tsx`:
// `fieldClassName="… bg-background-secondary-default"`). That is allowed;
// every other `bg-background-*` on a field is reported.
//
// `src/styles/surface-contrast.test.ts` holds the other half: that the
// tertiary well differs from every surface it may sit on, in both themes.

const FIELDS = new Set([
  'Input',
  'InputBase',
  'TextArea',
  'TextareaBase',
  'TextField',
  'SearchField',
  'SearchField.Group',
  'InputGroup',
])
const CLASS_ATTRS = new Set(['fieldClassName', 'className'])
const ALLOWED = 'bg-background-secondary-default'

function elementName(name) {
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') return `${elementName(name.object)}.${name.property.name}`
  return ''
}

function findConstInit(context, node) {
  let scope = context.sourceCode.getScope(node)
  while (scope) {
    const variable = scope.set.get(node.name)
    if (variable) {
      const def = variable.defs[0]
      if (def?.type === 'Variable' && def.parent?.kind === 'const') return def.node.init
      return null
    }
    scope = scope.upper
  }
  return null
}

/** Every string a class expression can produce, as far as it can be followed statically. */
function collectStrings(context, node, out, seen = new Set()) {
  if (!node || seen.has(node)) return
  seen.add(node)
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') out.push(node.value)
      return
    case 'TemplateLiteral':
      for (const q of node.quasis) out.push(q.value.cooked ?? '')
      for (const e of node.expressions) collectStrings(context, e, out, seen)
      return
    case 'JSXExpressionContainer':
      return collectStrings(context, node.expression, out, seen)
    case 'ConditionalExpression':
      collectStrings(context, node.consequent, out, seen)
      return collectStrings(context, node.alternate, out, seen)
    case 'LogicalExpression':
      collectStrings(context, node.left, out, seen)
      return collectStrings(context, node.right, out, seen)
    case 'CallExpression':
      for (const arg of node.arguments) collectStrings(context, arg, out, seen)
      return
    case 'ArrayExpression':
      for (const el of node.elements) collectStrings(context, el, out, seen)
      return
    case 'ArrowFunctionExpression':
      // `className={(state) => cx(…)}`: the body is what it returns.
      if (node.body.type !== 'BlockStatement') collectStrings(context, node.body, out, seen)
      return
    case 'Identifier': {
      const init = findConstInit(context, node)
      if (init) collectStrings(context, init, out, seen)
      return
    }
    default:
      return
  }
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'A text field keeps the registry fill; change the surface, not the field.' },
    schema: [],
    messages: {
      fieldFill:
        '`{{token}}` on <{{element}}>. Change the surface, not the field: the registry field is the tertiary well, and the only fill BoardUI ever gives one is `bg-background-secondary-default` (data-table / settings-storage, on the lighter surface). If the well vanishes, the surface under it is the wrong one — see surface-contrast.test.ts.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const element = elementName(node.name)
        if (!FIELDS.has(element)) return
        for (const attr of node.attributes) {
          if (attr.type !== 'JSXAttribute' || !CLASS_ATTRS.has(attr.name.name) || !attr.value) continue
          const strings = []
          collectStrings(context, attr.value, strings)
          for (const token of strings.join(' ').split(/\s+/)) {
            const utility = token.split(':').pop().replace(/^!/, '')
            if (!utility.startsWith('bg-background-')) continue
            if (token === ALLOWED) continue
            context.report({ node: attr, messageId: 'fieldFill', data: { token, element } })
          }
        }
      },
    }
  },
}
