// The token reader bound to the app's own stylesheets, imported as text so the
// foundations page reads the very files the build compiles. The parsing lives
// in `token-reader.ts`, which the test feeds from disk instead.
import themeCss from '@/styles/theme.css?raw'
import typographyCss from '@/styles/typography.css?raw'
import meridianCss from '@/styles/meridian.css?raw'
import globalsCss from '@/styles/globals.css?raw'
import { createTokenReader } from './token-reader'

export { shortName, type Theme } from './token-reader'

/** Cascade order: the registry's theme, its type ramp, ours, then the global rules. */
export const STYLE_SOURCES: [string, string][] = [
  ['theme.css', themeCss],
  ['typography.css', typographyCss],
  ['meridian.css', meridianCss],
  ['globals.css', globalsCss],
]

export const { tokenNames, declared, overriddenInDark, resolve } = createTokenReader(STYLE_SOURCES)
