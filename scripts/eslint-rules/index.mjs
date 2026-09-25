// Local ESLint plugin: the UI rules that need to look at more than one node,
// or at the stylesheets. Everything expressible as a `no-restricted-syntax`
// selector stays in eslint.config.js.
import animationNeedsKeyframes from './animation-needs-keyframes.mjs'
import buttonIconThroughProp from './button-icon-through-prop.mjs'
import fieldFillFollowsSurface from './field-fill-follows-surface.mjs'
import iconOnlyNeedsName from './icon-only-needs-name.mjs'
import noDefaultOnLoadFailure from './no-default-on-load-failure.mjs'
import noInventedDomainDefault from './no-invented-domain-default.mjs'
import noJsonToolDisplay from './no-json-tool-display.mjs'
import noModifierOnStaticUtility from './no-modifier-on-static-utility.mjs'
import noParseOrDefault from './no-parse-or-default.mjs'
import noSilentPropDrop from './no-silent-prop-drop.mjs'
import noVariantAsState from './no-variant-as-state.mjs'
import translatedAriaLabel from './translated-aria-label.mjs'

export default {
  meta: { name: 'meridian-ui', version: '2.0.0' },
  rules: {
    'animation-needs-keyframes': animationNeedsKeyframes,
    'button-icon-through-prop': buttonIconThroughProp,
    'field-fill-follows-surface': fieldFillFollowsSurface,
    'icon-only-needs-name': iconOnlyNeedsName,
    'no-default-on-load-failure': noDefaultOnLoadFailure,
    'no-invented-domain-default': noInventedDomainDefault,
    'no-json-tool-display': noJsonToolDisplay,
    'no-modifier-on-static-utility': noModifierOnStaticUtility,
    'no-parse-or-default': noParseOrDefault,
    'no-silent-prop-drop': noSilentPropDrop,
    'no-variant-as-state': noVariantAsState,
    'translated-aria-label': translatedAriaLabel,
  },
}
