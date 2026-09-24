// An unparseable number is not the default number.
//
// `parseInt(contextWindow) || 128000` on the model page turned a field the
// user had cleared, or typed garbage into, into a context window nobody chose,
// and saved it. `||` makes it worse than it looks: `0` is falsy, so an explicit
// zero is silently replaced as well. Same family as
// `no-default-on-load-failure` — an input that could not be read becomes a
// plausible value, and the save path cannot tell the difference.
//
// Refused: `parseInt(…) || <number>`, `parseFloat(…) || <number>`,
// `Number(…) || <number>` and the `Number.parseInt`/`Number.parseFloat`
// spellings. Parse, check `Number.isFinite` (or the field's own range), and
// either refuse to save with a field error or send `null` where the contract
// has an "unset" state.
//
// Not covered: `x ?? <number>`. `??` only fires on null/undefined, so it does
// not eat a `0` or a `NaN`, and "an absent optional field means N" is an
// ordinary, correct reading of a response — the shape is far too common to
// refuse wholesale, and nothing about its syntax says whether it is on a save
// path.

const PARSERS = new Set(['parseInt', 'parseFloat', 'Number'])

function parserName(node) {
  if (node.type !== 'CallExpression') return null
  const callee = node.callee
  if (callee.type === 'Identifier' && PARSERS.has(callee.name)) return callee.name
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Number' &&
    callee.property.type === 'Identifier' &&
    (callee.property.name === 'parseInt' || callee.property.name === 'parseFloat')
  ) {
    return `Number.${callee.property.name}`
  }
  return null
}

function isNumberLiteral(node) {
  if (node.type === 'Literal' && typeof node.value === 'number') return true
  return node.type === 'UnaryExpression' && node.operator === '-' && isNumberLiteral(node.argument)
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'No `parseInt(x) || N` / `Number(x) || N`: an unparseable input is not the default.' },
    schema: [],
    messages: {
      parseOrDefault:
        '`{{parser}}(…) || {{fallback}}` turns an unparseable (or explicit 0) input into a value nobody chose, ' +
        'and the save path writes it back. Validate with Number.isFinite and refuse to save (field error), or ' +
        'send null where the contract has an unset state.',
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (node.operator !== '||' || !isNumberLiteral(node.right)) return
        const parser = parserName(node.left)
        if (!parser) return
        context.report({
          node,
          messageId: 'parseOrDefault',
          data: { parser, fallback: context.sourceCode.getText(node.right) },
        })
      },
    }
  },
}
