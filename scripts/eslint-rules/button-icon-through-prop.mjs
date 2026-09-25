// A Button's icon goes in through `leadingIcon` / `trailingIcon`, never as a child.
//
// The base Button wraps its children in the label span (`px-1` / `px-0.5`) and
// puts the icon beside that span, so the space between icon and label is the
// span's padding plus the button's `gap`. An icon written as a child lands
// *inside* the span, flush against the text: "←返回", "+添加模型", "保存密钥"
// with no gap at all (the provider page, 2026-09). It also escapes the size
// tier (a hand-written `w-3.5 h-3.5` beside a 20px tier) and `isPending`, which
// can only swap the icon it was given for a spinner.
//
// What counts as an icon is anything imported from `@keyline-icons/react/*` —
// the one icon set this app uses (CLAUDE.md, "Icons"). A child that is some
// other element (a Spinner, an avatar, a Kbd) is content and left alone.

const BUTTONS = new Set(['Button', 'ButtonLink'])

export default {
  meta: {
    type: 'problem',
    docs: { description: 'A Button takes its icon through leadingIcon/trailingIcon, not as a child.' },
    schema: [],
    messages: {
      iconChild:
        'Icon <{{icon}}> passed as a child of <{{button}}>: it lands inside the label span with no gap and outside the size tier. Pass it as leadingIcon={ {{icon}} } (or trailingIcon), with iconOnly when there is no label.',
    },
  },
  create(context) {
    const icons = new Set()
    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== 'string' || !node.source.value.startsWith('@keyline-icons/')) return
        for (const spec of node.specifiers) icons.add(spec.local.name)
      },
      JSXElement(node) {
        const name = node.openingElement.name
        if (name.type !== 'JSXIdentifier' || !BUTTONS.has(name.name)) return
        for (const child of node.children) {
          if (child.type !== 'JSXElement') continue
          const childName = child.openingElement.name
          if (childName.type !== 'JSXIdentifier' || !icons.has(childName.name)) continue
          context.report({ node: child, messageId: 'iconChild', data: { icon: childName.name, button: name.name } })
        }
      },
    }
  },
}
