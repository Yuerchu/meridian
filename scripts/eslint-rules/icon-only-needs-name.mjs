// An icon-only pressable needs an accessible name.
//
// A React Aria tooltip contributes `aria-describedby` only: it describes the
// control and never names it, so a wrapped button with no label is still
// anonymous to a screen reader. There is no jsx-a11y rule configured here, so
// nothing else catches it. BoardUI does not require a tooltip beside the label
// (its own icon buttons carry `aria-label` alone), and neither does this.
//
// What counts as icon-only is what the component is told: `iconOnly` (the
// boardui Button prop) or `isIconOnly`.

function hasAttr(node, name) {
  return node.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === name)
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'An icon-only pressable must carry an accessible name.' },
    schema: [],
    messages: {
      needsLabel:
        'Icon-only control with no accessible name. Add aria-label (or aria-labelledby) to the control itself — a Tooltip only contributes aria-describedby, so it describes the control without naming it. A wrapper whose caller supplies the name disables this line with a reason.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (!hasAttr(node, 'iconOnly') && !hasAttr(node, 'isIconOnly')) return
        // `aria-labelledby` names just as well, and is what a control labelled
        // by a heading elsewhere on the page uses.
        if (hasAttr(node, 'aria-label') || hasAttr(node, 'aria-labelledby')) return
        // Visible text inside names it regardless of the flag.
        const text = node.parent.children?.some((c) => c.type === 'JSXText' && c.value.trim() !== '')
        if (text) return
        context.report({ node, messageId: 'needsLabel' })
      },
    }
  },
}
