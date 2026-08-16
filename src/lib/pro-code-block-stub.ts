/**
 * Stands in for `@heroui-pro/react/code-block` at build time.
 *
 * Pro's `Markdown` imports `CodeBlock` statically, for the default `code`
 * component it would render if nobody overrode it. We always override it —
 * `chat/markdown-content.tsx` renders Pro's classes around our own `ShikiCode`
 * — so nothing here is ever called. What the import costs, though, is Shiki's
 * full entry point: every grammar it ships as a chunk apiece (emacs-lisp alone
 * is 764 kB), a second copy of the grammars we load ourselves, and the
 * oniguruma WASM. Around 8 MB of code that cannot run.
 *
 * `meridian:stub-pro-code-block` in the Vite config redirects Pro's internal
 * import here. Should we ever want Pro's own code block, delete the plugin —
 * and expect the chunk count to go back up.
 */
const unreachable = () => {
  throw new Error(
    'Pro CodeBlock is stubbed out at build time — see src/lib/pro-code-block-stub.ts',
  )
}

export const CodeBlock = Object.assign(unreachable, {
  Header: unreachable,
  Code: unreachable,
  CopyButton: unreachable,
})
