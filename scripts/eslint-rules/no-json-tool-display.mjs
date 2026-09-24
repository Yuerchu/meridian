// A tool call is drawn, not dumped.
//
// The transcript used to fill up with JSON: a result the renderer did not
// recognise was `JSON.stringify(JSON.parse(result), null, 2)` in a code box,
// an argument that was an object became its source text, and a call whose
// arguments were still streaming showed the raw fragment. Every one of those
// was a `JSON.stringify` somewhere on the path from a `ToolCallDisplay` to the
// screen. This rule refuses the call itself in the files on that path; the
// replacement is `components/ui/tool-value.tsx` (`ToolValue`, `ToolFields`,
// `ToolTextResult`), which is the one generic renderer and is not linted by
// this rule. A `JSON.stringify` that builds a payload rather than a display —
// the answer to an `ask_user` form — says so with a disable comment and a
// reason.

export default {
  meta: {
    type: 'problem',
    docs: { description: 'No JSON.stringify in the tool-call rendering path; draw values with ToolValue.' },
    schema: [],
    messages: {
      noJson:
        'Tool calls are drawn, not dumped: render arguments/results with ToolValue / ToolFields / ToolTextResult ' +
        "from '@/components/ui/tool-value' and register the tool in src/lib/tool-renderers.ts, instead of " +
        'JSON.stringify.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'JSON' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'stringify'
        ) {
          context.report({ node, messageId: 'noJson' })
        }
      },
    }
  },
}
