// A Button's variant is what the action is, not whether something is on.
//
// `variant={open ? 'ghost' : 'neutral'}` draws a toggle out of two unrelated
// looks: the "on" look is whichever variant happened to be nearby, nothing
// announces the state unless `aria-pressed` is remembered by hand, and each
// call site picks a different pair — the accent's soft fill on one, the
// secondary grey on the next. BoardUI has components whose job this is:
// `ToggleButton` for one switchable button, `SegmentedControl` / `Tabs` for one
// of a few, `ListBox` / a `Menu` with `selectionMode` for one of many. Their
// selected look is the registry's and their state is announced for free.
//
// What is flagged is a `variant` chosen by a condition where the branches say
// nothing about the action: both are quiet variants (neither `primary` nor
// `danger`), or the element also carries a pressed/selected/checked state.
// Switching to `primary` for the one action that matters now (Send vs Stop,
// Register vs Re-register) or to `danger` for a destructive kind is a
// different action, not a state, and is left alone.

const EMPHATIC = new Set(['primary', 'danger'])
const STATE_ATTRS = new Set(['aria-pressed', 'aria-selected', 'aria-checked', 'aria-current'])

function elementName(name) {
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') return `${elementName(name.object)}.${name.property.name}`
  return ''
}

/** The string a branch resolves to, `undefined` for the default, or null for "not a literal". */
function branchValue(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'Identifier' && node.name === 'undefined') return undefined
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'A Button variant chosen by a condition must not stand in for a selected/on state.' },
    schema: [],
    messages: {
      variantAsState:
        "Button variant switched by a condition to show a selected/on state ({{pair}}). Use the component whose job that is: ToggleButton for one switchable button, SegmentedControl or Tabs for one of a few, ListBox or a Menu with selectionMode for one of many — their selected look is the registry's and the state is announced. A deliberate exception disables this line with a reason.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name !== 'variant') return
        const opening = node.parent
        if (!/(^|\.)Button$/.test(elementName(opening.name))) return
        const expr = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : null
        if (!expr || expr.type !== 'ConditionalExpression') return
        const a = branchValue(expr.consequent)
        const b = branchValue(expr.alternate)
        if (a === null || b === null) return
        const hasState = opening.attributes.some(
          (attr) => attr.type === 'JSXAttribute' && STATE_ATTRS.has(attr.name.name),
        )
        const quiet = !EMPHATIC.has(a) && !EMPHATIC.has(b)
        if (!hasState && !quiet) return
        context.report({
          node,
          messageId: 'variantAsState',
          data: { pair: `${a ?? 'default'} / ${b ?? 'default'}` },
        })
      },
    }
  },
}
