import manifest from '../../boardui.json'

/**
 * No accessible name is written in English in the source.
 *
 * A literal `aria-label="Close"` renders, type-checks and passes every test
 * written in English — and a Chinese screen reader then announces "Close". The
 * base layer had seven of these (Modal and Sheet's close button, the spinner,
 * the sidebar drawer, the link popover, the prompt queue), each a default the
 * caller could override and some callers never did.
 *
 * What is refused, in app code outside tests and the dev playground:
 *
 * - a JSX `aria-label` whose value is a string literal containing a Latin
 *   letter (`aria-label="Close"`, `aria-label={'Close'}`);
 * - a string-literal English fallback for one (`aria-label={x ?? 'Queued'}`);
 * - an English default for an `aria-label` prop (`'aria-label': a = 'Close'`).
 *
 * What is allowed: `t(…)`, variables, props, and non-Latin literals. The one
 * exemption is the third form in vendored registry files (`boardui.json`):
 * their English defaults are the registry's own and stay byte-identical to it,
 * so the rule there is that every caller passes the prop — which this test
 * cannot see, and the review checklist has to.
 *
 * Comments are stripped first: a doc comment showing `aria-label="…"` usage is
 * not a label.
 */
const sources = import.meta.glob<string>('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true })

const vendored = new Set(
  Object.values((manifest as { items: Record<string, { files: string[] }> }).items).flatMap((item) =>
    item.files.map((file) => `/${file}`),
  ),
)

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

// A string literal; a template's `${…}` holes are code, not text, and are
// removed before asking whether the literal has a Latin letter in it.
const STRING = String.raw`(?:"[^"]*"|'[^']*'|${'`'}(?:[^${'`'}\\]|\\.)*${'`'})`
const JSX_LITERAL = new RegExp(String.raw`aria-label=(?:"[^"]*"|\{\s*${STRING}\s*\})`, 'g')
const JSX_FALLBACK = new RegExp(String.raw`aria-label=\{[^}]*(?:\?\?|\|\|)\s*${STRING}\s*\}`, 'g')
const PROP_DEFAULT = new RegExp(String.raw`'aria-label':\s*\w+\s*=\s*${STRING}`, 'g')
const TRAILING_LITERAL = new RegExp(String.raw`${STRING}\s*\}?$`)

function hasLatinText(match: string): boolean {
  const literal = match.match(TRAILING_LITERAL)?.[0] ?? match
  return /[A-Za-z]/.test(literal.replace(/\$\{[^}]*\}/g, ''))
}

function findEnglishLabels(path: string, text: string): string[] {
  const code = stripComments(text)
  const shapes = [JSX_LITERAL, JSX_FALLBACK, ...(vendored.has(path) ? [] : [PROP_DEFAULT])]
  return shapes.flatMap((shape) => [...code.matchAll(shape)].map((m) => m[0]).filter(hasLatinText))
}

const inScope = (path: string) =>
  !/\.test\.tsx$/.test(path) && !path.startsWith('/src/dev/') && !path.includes('/test/')

describe('accessible names are translated', () => {
  it('finds no English aria-label literal, fallback or default in app code', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    const offenders = Object.entries(sources)
      .filter(([path]) => inScope(path))
      .flatMap(([path, text]) => findEnglishLabels(path, text).map((hit) => `${path}: ${hit}`))
    expect(offenders).toEqual([])
  })

  it('recognises each of the three shapes, and leaves translated ones alone', () => {
    expect(findEnglishLabels('/src/x.tsx', `<X aria-label="Close" />`)).toHaveLength(1)
    expect(findEnglishLabels('/src/x.tsx', `<X aria-label={'Close'} />`)).toHaveLength(1)
    expect(findEnglishLabels('/src/x.tsx', `<X aria-label={props['aria-label'] ?? 'Queued prompts'} />`)).toHaveLength(
      1,
    )
    expect(findEnglishLabels('/src/x.tsx', `function A({ 'aria-label': a = 'Close' }) {}`)).toHaveLength(1)

    expect(findEnglishLabels('/src/x.tsx', `<X aria-label={t('common.close')} />`)).toEqual([])
    expect(findEnglishLabels('/src/x.tsx', `<X aria-label={label ?? t('common.close')} />`)).toEqual([])
    expect(findEnglishLabels('/src/x.tsx', `<X aria-label="关闭" />`)).toEqual([])
    expect(findEnglishLabels('/src/x.tsx', '<X aria-label={`${row.name}: ${cost}`} />')).toEqual([])
    expect(findEnglishLabels('/src/x.tsx', '<X aria-label={`Close ${name}`} />')).toHaveLength(1)
    expect(findEnglishLabels('/src/x.tsx', `/** <X aria-label="Close" /> */`)).toEqual([])
    expect(findEnglishLabels('/src/x.tsx', `// <X aria-label="Close" />`)).toEqual([])
    // A vendored registry default is the registry's string; its callers are
    // what has to pass the prop.
    const [registryFile] = vendored
    expect(findEnglishLabels(registryFile, `function A({ 'aria-label': a = 'Pagination' }) {}`)).toEqual([])
  })
})
