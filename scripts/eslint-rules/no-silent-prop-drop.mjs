// A component may not accept a prop and then throw it away.
//
// The shape this catches is `function X({ onOpenChange: _onOpenChange, ...rest })`
// — a destructured member renamed to an underscore name so the unused-variable
// rule stays quiet, after which the prop is accepted by the type, passed by
// every caller, and does nothing. The 2026-09 review of `components/base`
// found twenty-four files doing this, and between them they were why tooltips,
// disclosures, the command palette, the search fields, the sidebar tree and the
// prompt queue had all stopped working while every type check stayed green.
//
// Scoped to `src/components/base/**` in eslint.config.js: that is the layer
// whose whole job is to honour its props. Elsewhere a `_x` rename is an
// ordinary way to exclude a prop from a spread.
//
// The escape hatch is a disable comment with a reason, which is the point —
// "this prop is accepted for call-site symmetry and has no effect here" is a
// sentence worth writing next to the line.

function isUnderscoreName(node) {
  return node && node.type === 'Identifier' && node.name.startsWith('_')
}

function report(context, property) {
  context.report({
    node: property,
    messageId: 'dropped',
    data: { prop: property.key.type === 'Identifier' ? property.key.name : String(property.key.value) },
  })
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'A component must not accept a prop and silently discard it.' },
    schema: [],
    messages: {
      dropped:
        'Prop `{{prop}}` is accepted and then dropped (`{{prop}}: _…`). Forward it, remove it from the props type, or disable this line with the reason it has no effect.',
    },
  },
  create(context) {
    function checkPattern(pattern) {
      if (!pattern || pattern.type !== 'ObjectPattern') return
      for (const property of pattern.properties) {
        if (property.type !== 'Property') continue
        // `{ a: _a }` — a rename to an underscore name, never `{ _a }` itself
        // (an underscore-named prop is the caller's naming, not a drop) and
        // never `{ a: _a = 1 }` shorthand with a default that is then read.
        const value = property.value.type === 'AssignmentPattern' ? property.value.left : property.value
        if (property.shorthand) continue
        if (isUnderscoreName(value)) report(context, property)
      }
    }
    return {
      // function Component({ a: _a }) {}
      'FunctionDeclaration, FunctionExpression, ArrowFunctionExpression'(node) {
        for (const param of node.params) {
          checkPattern(param.type === 'AssignmentPattern' ? param.left : param)
        }
      },
      // const { a: _a, ...rest } = props
      VariableDeclarator(node) {
        checkPattern(node.id)
      },
    }
  },
}
