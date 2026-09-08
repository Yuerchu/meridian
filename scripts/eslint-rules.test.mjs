// Focused fixtures for the two local rules and for the selector-based
// restrictions in eslint.config.js added by the 2026-09 design audit. Run with:
//
//   pnpm lint:rules
//
// Each `invalid` case is the shape the audit actually found; each `valid` case
// is the shape the fix produced. A rule that stays green when one of the
// invalid cases is pasted back in is not a gate.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Linter, RuleTester } from 'eslint'
import plugin from './eslint-rules/index.mjs'
import { uiRestrictions } from '../eslint.config.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const languageOptions = {
  ecmaVersion: 2024,
  sourceType: 'module',
  parserOptions: { ecmaFeatures: { jsx: true } },
}

const tester = new RuleTester({ languageOptions })

tester.run('icon-only-needs-tooltip', plugin.rules['icon-only-needs-tooltip'], {
  valid: [
    // The pattern the project already uses.
    `<Tooltip delay={0}><Button isIconOnly aria-label="Close"><Xmark /></Button><Tooltip.Content>Close</Tooltip.Content></Tooltip>`,
    // Through a render prop.
    `<Tooltip><Tooltip.Trigger render={<Button isIconOnly aria-label="x"><Icon /></Button>} /><Tooltip.Content>x</Tooltip.Content></Tooltip>`,
    // Aliased in the dev lab.
    `<HTooltip><HButton isIconOnly aria-label="x"><Icon /></HButton></HTooltip>`,
    // Text beside the icon is a labelled button, not an icon-only one.
    `<Button aria-label="Save"><Check />Save</Button>`,
    `<Dropdown.Trigger aria-label="More">{label}</Dropdown.Trigger>`,
    // An intrinsic child carries text; only a component child is read as an icon.
    `<Button aria-label="Edit name: x"><span data-slot="cell-value">{name}</span></Button>`,
    // Not a pressable: a menu with an aria-label and element children.
    `<Sidebar.Menu aria-label="Conversations"><Sidebar.MenuItem /></Sidebar.Menu>`,
    // A pressable with no aria-label is somebody else's problem (a11y lint).
    `<Button isDisabled><Icon /></Button>`,
  ],
  invalid: [
    { code: `<Button isIconOnly aria-label="Close"><Xmark /></Button>`, errors: [{ messageId: 'needsTooltip' }] },
    {
      code: `<Dropdown><Dropdown.Trigger aria-label="More"><EllipsisVertical /></Dropdown.Trigger></Dropdown>`,
      errors: [{ messageId: 'needsTooltip' }],
    },
    {
      code: `<Sidebar.MenuAction aria-label="More"><Ellipsis /></Sidebar.MenuAction>`,
      errors: [{ messageId: 'needsTooltip' }],
    },
    {
      code: `<Segment.Item id="list" aria-label="List"><LayoutList /></Segment.Item>`,
      errors: [{ messageId: 'needsTooltip' }],
    },
    // A wrapper that draws its own icon, at the call site.
    { code: `<MessageScrollerButton aria-label="Scroll to bottom" />`, errors: [{ messageId: 'needsTooltip' }] },
    // A sibling tooltip is not a wrapping one.
    {
      code: `<div><Tooltip><span>hint</span></Tooltip><Button isIconOnly aria-label="x"><Icon /></Button></div>`,
      errors: [{ messageId: 'needsTooltip' }],
    },
  ],
})

tester.run('intrinsic-needs-data-slot', plugin.rules['intrinsic-needs-data-slot'], {
  valid: [
    `<div data-slot="composer-footer" />`,
    `<dom.span data-slot="hint" {...props} />`,
    // Components are not intrinsic.
    `<Button><Icon /></Button>`,
    `<Card.Header>x</Card.Header>`,
    // SVG innards and void inline elements.
    `<svg data-slot="logo"><path d="M0 0" /><circle r="1" /></svg>`,
    `<p data-slot="note">a<br />b</p>`,
  ],
  invalid: [
    { code: `<div className="flex" />`, errors: [{ messageId: 'needsSlot', data: { name: 'div' } }] },
    { code: `<span>{x}</span>`, errors: [{ messageId: 'needsSlot', data: { name: 'span' } }] },
    { code: `<dom.button {...props} />`, errors: [{ messageId: 'needsSlot', data: { name: 'button' } }] },
    // The spread might carry one; the rule cannot see it and does not guess.
    { code: `<div {...props} />`, errors: [{ messageId: 'needsSlot', data: { name: 'div' } }] },
    { code: `<svg><path d="" /></svg>`, errors: [{ messageId: 'needsSlot', data: { name: 'svg' } }] },
  ],
})

// The selector restrictions are one core rule with many messages, which
// RuleTester cannot drive with our options; the Linter can. Assert on the
// message text so a selector that stops matching is caught by name.
function lint(code) {
  const linter = new Linter({ configType: 'flat' })
  const config = [
    {
      files: ['**/*.js'],
      languageOptions,
      rules: {
        'no-restricted-syntax': ['error', ...uiRestrictions.style, ...uiRestrictions.nativeElements],
      },
    },
  ]
  return linter.verify(code, config, { filename: 'case.js' }).map((m) => m.message)
}

describe('ui selector restrictions', () => {
  const flagged = [
    ['text-white', `<p className="text-white" />`, /palette/],
    ['bg-black/50', `<p className="bg-black/50" />`, /palette/],
    ['cursor-pointer', `<label className="text-sm cursor-pointer" />`, /cursor-pointer/],
    ['bg-muted', `<i className="size-2 rounded-full bg-muted" />`, /--muted is secondary/],
    ['uppercase', `<h3 className="text-xs uppercase" />`, /ALL CAPS/],
    ['bare rounded', `<span className="px-1 rounded shrink-0" />`, /Bare `rounded`/],
    ['shadow-md', `<div className="focus:shadow-md" />`, /shadow-/],
    ['animate-pulse', `<div className="h-16 animate-pulse bg-default/30" />`, /animate-pulse/],
    ['animate-spin', `<Icon className="w-3.5 h-3.5 animate-spin" />`, /animate-spin/],
    ['bg-danger/10', `<div className="rounded-lg border border-danger/30 bg-danger/10" />`, /alpha/],
    [
      'Button text-danger',
      `<Button variant="ghost" className="ml-auto text-danger hover:text-danger" />`,
      /danger-soft/,
    ],
    ['Button text-danger in cn()', `<Button className={cn('text-danger', x)} />`, /danger-soft/],
    ['Button h-auto', `<Button variant="ghost" className="h-auto w-full justify-start" />`, /h-auto/],
    ['state attr on Content', `<Checkbox.Content className="rounded-lg data-[selected=true]:bg-default/80" />`, /root/],
    ['Button onClick', `<Button onClick={go} />`, /onPress/],
    ['Spinner className size', `<Spinner className="w-3.5 h-3.5" />`, /size prop/],
    ['template className', '<div className={`${base} rounded-xl`} />', /cn\(/],
    ['t().replace', `const s = t('toolbar.noAssistant').replace(/^No /, 'Select ')`, /translation/],
    ['glyph icon', `<Button aria-label="Cancel">✕</Button>`, /icon/],
    ['max-w px', `<Modal.Dialog className="sm:max-w-[360px]" />`, /size/],
    ['native label', `<label htmlFor="a">A</label>`, /<Label>/],
    ['native kbd', `<kbd>Ctrl</kbd>`, /<Kbd>/],
  ]
  for (const [name, code, pattern] of flagged) {
    it(`flags ${name}`, () => {
      const messages = lint(code)
      assert.ok(
        messages.some((m) => pattern.test(m)),
        `expected ${pattern} in ${JSON.stringify(messages)}`,
      )
    })
  }

  const clean = [
    ['token colours', `<p className="text-danger-foreground bg-danger-soft" />`],
    ['gradient over a fill', `<div className="from-danger via-danger/80 to-transparent" />`],
    ['interactive cursor', `<span className="cursor-[var(--cursor-interactive)]" />`],
    ['rounded-lg', `<span className="rounded-lg rounded-t-none" />`],
    ['shadow tokens', `<div className="shadow-surface shadow-overlay shadow-none" />`],
    ['danger-soft variant', `<Button variant="danger-soft" />`],
    // Danger on hover only, for an icon in a row of ghost icons; and the soft
    // foreground, which is a different class.
    ['hover danger on a ghost icon', `<Button isIconOnly variant="ghost" className="text-muted hover:text-danger" />`],
    ['soft foreground', `<Button className={cn(selected ? 'text-danger-soft-foreground' : 'text-muted')} />`],
    ['state attr on root', `<Checkbox className="data-[selected=true]:bg-default" />`],
    ['onPress', `<Button onPress={go} />`],
    ['Spinner size prop', `<Spinner size="sm" className="shrink-0" />`],
    ['cn()', `<div className={cn('a', b)} />`],
    ['plain replace', `const s = value.replace(/a/, 'b')`],
    ['ellipsis in text', `<p>Loading…</p>`],
    ['multiplication count', `<span>×{count}</span>`],
    ['Label component', `<Label>A</Label>`],
  ]
  for (const [name, code] of clean) {
    it(`accepts ${name}`, () => {
      assert.deepEqual(lint(code), [])
    })
  }
})
