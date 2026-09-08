// An icon-only pressable needs a <Tooltip> around it *and* an accessible name.
//
// Two obligations, checked independently, because HeroUI's Tooltip contributes
// `aria-describedby` only: it describes the control and never names it. The
// first version of this rule accepted a tooltip ancestor as the whole answer
// and returned before it ever looked for a name, so
// `<Tooltip><Button isIconOnly><Icon/></Button>…</Tooltip>` passed the gate
// while remaining anonymous to a screen reader — the exact substitution the
// rule's own message warns against. Nothing else was going to catch it: there
// is no jsx-a11y rule configured here.
//
// The 2026-09 audit found 43 `isIconOnly` buttons and four tooltips; a rule is
// the only thing that keeps that ratio from drifting back.
//
// What counts as icon-only: `isIconOnly` on anything, or an `aria-label` on a
// pressable whose children are all elements (icons) with no text. The
// pressables are Button-suffixed identifiers and the `*.Trigger` /
// `*.MenuAction` / `*.Item` members, which is where the audit found them.
//
// What counts as wrapped: any ancestor JSX element named `Tooltip` (or
// `*Tooltip`, for the dev lab's aliases) or `Tooltip.Trigger`, including
// through a `render={<Button/>}` prop. A wrapper component that expects its
// caller to supply the tooltip disables the rule with a reason.

const PRESSABLE_MEMBER = new Set(['Trigger', 'MenuAction', 'Item'])

function elementName(node) {
  const n = node.name
  if (n.type === 'JSXIdentifier') return { kind: 'ident', name: n.name }
  if (n.type === 'JSXMemberExpression' && n.property.type === 'JSXIdentifier') {
    return { kind: 'member', name: n.property.name }
  }
  return null
}

function isPressable(named) {
  if (!named) return false
  if (named.kind === 'ident') return /Button$/.test(named.name)
  return PRESSABLE_MEMBER.has(named.name)
}

function hasAttr(node, name) {
  return node.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === name)
}

// No text child and no expression child: what is left is icons, or nothing at
// all (a wrapper such as `<MessageScrollerButton aria-label=… />` draws its
// icon inside). `{icon}` might be text, so an expression counts as visible;
// so does an intrinsic child (`<span>{name}</span>` is a label, not an icon),
// while a component child (`<Xmark />`) is taken to be one.
function hasNoVisibleText(element) {
  for (const child of element.children) {
    if (child.type === 'JSXText') {
      if (child.value.trim() !== '') return false
      continue
    }
    if (child.type === 'JSXExpressionContainer') {
      if (child.expression.type === 'JSXEmptyExpression') continue
      return false
    }
    if (child.type === 'JSXFragment') {
      if (!hasNoVisibleText(child)) return false
      continue
    }
    if (child.type === 'JSXElement') {
      const n = child.openingElement.name
      if (n.type === 'JSXIdentifier' && /^[a-z]/.test(n.name)) return false
      continue
    }
    return false
  }
  return true
}

function isTooltipElement(node) {
  if (node.type !== 'JSXElement') return false
  const n = node.openingElement.name
  if (n.type === 'JSXIdentifier') return /Tooltip$/.test(n.name)
  if (n.type === 'JSXMemberExpression') {
    return n.object.type === 'JSXIdentifier' && /Tooltip$/.test(n.object.name)
  }
  return false
}

function insideTooltip(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (isTooltipElement(p)) return true
  }
  return false
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'An icon-only pressable must be wrapped in <Tooltip> and carry an accessible name.' },
    schema: [],
    messages: {
      needsTooltip:
        'Icon-only control without a <Tooltip>. Wrap it: <Tooltip delay={0}>…<Tooltip.Content>label</Tooltip.Content></Tooltip>, keeping aria-label on the control (a tooltip describes, it does not name). A wrapper that expects its caller to supply the tooltip disables this line with a reason.',
      needsLabel:
        'Icon-only control with no accessible name. Add aria-label (or aria-labelledby) to the control itself — a Tooltip only contributes aria-describedby, so it describes the control without naming it, and a wrapped button is still anonymous to a screen reader. A wrapper whose caller supplies the name disables this line with a reason.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const named = elementName(node)
        const explicit = hasAttr(node, 'isIconOnly')
        // `aria-labelledby` names just as well, and is what a control labelled
        // by a heading elsewhere on the page uses.
        const labelled = hasAttr(node, 'aria-label') || hasAttr(node, 'aria-labelledby')
        // The implicit half is *recognised* by its name, so it always has one;
        // only `isIconOnly` can reach the second report below.
        const implicit = isPressable(named) && labelled && hasNoVisibleText(node.parent)
        if (!explicit && !implicit) return
        // Two reports, never one instead of the other: the visible affordance
        // and the accessible name are separate obligations, and letting either
        // stand in for the other is what made this rule pass an unnamed button.
        if (!insideTooltip(node.parent)) context.report({ node, messageId: 'needsTooltip' })
        if (!labelled) context.report({ node, messageId: 'needsLabel' })
      },
    }
  },
}
