// Every intrinsic element carries `data-slot`.
//
// CLAUDE.md has said so under "Component style" for as long as the UI
// conventions have existed, and the 2026-09 audit measured the actual rate at
// about a third. The attribute is what makes a node addressable from a test,
// a devtools query or a parent's descendant selector without leaning on a
// class name that Tailwind will rewrite; it costs nothing at runtime.
//
// Intrinsic means a lowercase JSX name, or HeroUI's `dom.*` (which renders the
// same element with React Aria's props threaded through). Excluded: the
// innards of an inline SVG, which are drawing instructions rather than nodes
// anyone addresses, and the void inline elements `br` / `wbr`.
//
// A spread does not satisfy the rule. `{...props}` may carry a slot from the
// caller, but the rule cannot see that, and the fix — an explicit attribute
// before the spread, which the caller may then override — is the shape every
// `components/ui` wrapper already uses.

const SVG_INTERNALS = new Set([
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'g',
  'defs',
  'use',
  'symbol',
  'marker',
  'pattern',
  'mask',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'text',
  'tspan',
  'textPath',
  'foreignObject',
  'animate',
  'animateTransform',
  'animateMotion',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feBlend',
  'feColorMatrix',
  'feMerge',
  'feMergeNode',
  'feFlood',
  'feComposite',
  'title',
  'desc',
])

const VOID_INLINE = new Set(['br', 'wbr'])

function intrinsicName(node) {
  const n = node.name
  if (n.type === 'JSXIdentifier') {
    return /^[a-z]/.test(n.name) ? n.name : null
  }
  if (
    n.type === 'JSXMemberExpression' &&
    n.object.type === 'JSXIdentifier' &&
    n.object.name === 'dom' &&
    n.property.type === 'JSXIdentifier'
  ) {
    return n.property.name
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Every intrinsic JSX element (and dom.*) carries an explicit data-slot attribute.' },
    schema: [],
    messages: {
      needsSlot:
        '<{{name}}> has no data-slot. Name what this node is for (data-slot="composer-footer"), per the component-style convention in CLAUDE.md.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = intrinsicName(node)
        if (!name || SVG_INTERNALS.has(name) || VOID_INLINE.has(name)) return
        const has = node.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === 'data-slot')
        if (has) return
        context.report({ node, messageId: 'needsSlot', data: { name } })
      },
    }
  },
}
