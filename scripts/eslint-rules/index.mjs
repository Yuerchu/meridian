// Local ESLint plugin: the UI conventions from CLAUDE.md that need to look at
// more than one node. Everything expressible as a `no-restricted-syntax`
// selector stays in eslint.config.js; these are the ones that need ancestry
// or a look at how a value is used.
import iconOnlyNeedsTooltip from './icon-only-needs-tooltip.mjs'
import intrinsicNeedsDataSlot from './intrinsic-needs-data-slot.mjs'
import noSilentPropDrop from './no-silent-prop-drop.mjs'

export default {
  meta: { name: 'meridian-ui', version: '1.0.0' },
  rules: {
    'icon-only-needs-tooltip': iconOnlyNeedsTooltip,
    'intrinsic-needs-data-slot': intrinsicNeedsDataSlot,
    'no-silent-prop-drop': noSilentPropDrop,
  },
}
