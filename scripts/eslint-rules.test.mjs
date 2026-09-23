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

tester.run('icon-only-needs-name', plugin.rules['icon-only-needs-name'], {
  valid: [
    `<Button iconOnly aria-label="Close"><X /></Button>`,
    `<Button isIconOnly aria-labelledby="h"><Icon /></Button>`,
    // BoardUI names an icon button with aria-label alone; no tooltip is required.
    `<div><Button iconOnly aria-label="More"><MoreVertical /></Button></div>`,
    // A labelled button is not icon-only.
    `<Button><Check />Save</Button>`,
  ],
  invalid: [
    // A tooltip describes, it does not name: still anonymous.
    {
      code: `<Tooltip><Button iconOnly><Icon /></Button><Tooltip.Content>Close</Tooltip.Content></Tooltip>`,
      errors: [{ messageId: 'needsLabel' }],
    },
    { code: `<Button isIconOnly><Icon /></Button>`, errors: [{ messageId: 'needsLabel' }] },
  ],
})

tester.run('animation-needs-keyframes', plugin.rules['animation-needs-keyframes'], {
  valid: [
    `<span className="animate-spin" />`,
    `<span className="motion-safe:animate-skeleton" />`,
    `<span className="animate-[ai-chat-text-shimmer_2s_linear_infinite]" />`,
    `<span className="data-animate-x" />`,
    // Defined as a plain class in the registry globals.css.
    `<path className="animate-check-draw" />`,
  ],
  invalid: [
    // The shape that shipped: HeroUI's shimmer, whose keyframes left with HeroUI.
    {
      code: `<span className="bg-clip-text animate-[shimmer_2s_linear_infinite]" />`,
      errors: [{ messageId: 'noKeyframes' }],
    },
    { code: `<span className="animate-shimmer" />`, errors: [{ messageId: 'noUtility' }] },
    { code: 'const c = `x ${y} animate-[nope_1s]`', errors: [{ messageId: 'noKeyframes' }] },
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

tester.run('no-variant-as-state', plugin.rules['no-variant-as-state'], {
  valid: [
    // A different action, not a state: Send vs Stop, Register vs Re-register.
    `<Button variant={stopping ? 'neutral' : 'primary'} />`,
    `<Button variant={registered ? 'secondary' : 'primary'} />`,
    // A destructive kind of the same dialog.
    `<Button variant={status === 'danger' ? 'danger' : 'primary'} />`,
    `<Button variant={action.variant === 'destructive' ? 'danger' : undefined} />`,
    // Not a literal pair: nothing to judge.
    `<Button variant={action.variant ?? 'secondary'} />`,
    // Not a Button.
    `<Bubble variant={isError ? 'destructive' : 'muted'} />`,
  ],
  invalid: [
    // The shape the audit kept finding.
    { code: `<Button variant={selected ? 'secondary' : 'ghost'} />`, errors: [{ messageId: 'variantAsState' }] },
    {
      code: `<Button variant={changesOpen ? 'ghost' : 'neutral'} aria-pressed={changesOpen} />`,
      errors: [{ messageId: 'variantAsState' }],
    },
    // Emphasis used as "selected", betrayed by the state it announces.
    {
      code: `<Button variant={m.id === mode ? 'primary' : 'secondary'} aria-pressed={m.id === mode} />`,
      errors: [{ messageId: 'variantAsState' }],
    },
    { code: `<Foo.Button variant={on ? 'neutral' : undefined} />`, errors: [{ messageId: 'variantAsState' }] },
  ],
})

tester.run('field-fill-follows-surface', plugin.rules['field-fill-follows-surface'], {
  valid: [
    // The registry field as it is.
    `<Input value={v} />`,
    // BoardUI's one field fill (data-table.tsx / settings-storage.tsx).
    `<Input fieldClassName="w-[153px] rounded-full bg-background-secondary-default" />`,
    `<SearchField.Group className="bg-background-secondary-default" />`,
    `const FIELD_ON_CARD = 'bg-background-secondary-default'; <TextArea fieldClassName={FIELD_ON_CARD} />`,
    // Layout on a field is not a fill.
    `<Input fieldClassName="min-w-0 flex-1" />`,
    // Not a field.
    `<div className="bg-background-primary-default" />`,
  ],
  invalid: [
    // Painting the field to fight the surface: the shape both recurrences took.
    {
      code: `<Input fieldClassName="bg-background-primary-default" />`,
      errors: [{ messageId: 'fieldFill' }],
    },
    {
      code: `<TextArea fieldClassName={cx('min-h-0', dark && 'bg-background-tertiary-hover')} />`,
      errors: [{ messageId: 'fieldFill' }],
    },
    {
      code: `<SearchField.Group className="data-[hovered]:bg-background-secondary-default" />`,
      errors: [{ messageId: 'fieldFill' }],
    },
    {
      code: `const WELL = 'rounded-none bg-background-secondary-default/40'; <InputGroup className={WELL} />`,
      errors: [{ messageId: 'fieldFill' }],
    },
    {
      code: 'const x = 1; <Input className={`h-8 bg-background-quaternary-default`} />',
      errors: [{ messageId: 'fieldFill' }],
    },
  ],
})

tester.run('no-silent-prop-drop', plugin.rules['no-silent-prop-drop'], {
  valid: [
    // Forwarded.
    `function Field({ isInvalid, ...props }) { return <Input isInvalid={isInvalid} {...props} /> }`,
    // An underscore-named prop is the caller's name, not a drop.
    `function Row({ _internal }) { return <div>{_internal}</div> }`,
  ],
  invalid: [
    {
      code: `function Disclosure({ onExpandedChange: _onExpandedChange, ...props }) { return <div {...props} /> }`,
      errors: [{ messageId: 'dropped' }],
    },
    {
      code: `const Menu = ({ dragAndDropHooks: _dnd, selectedKeys: _sk, ...rest }) => <div {...rest} />`,
      errors: [{ messageId: 'dropped' }, { messageId: 'dropped' }],
    },
    {
      code: `function Trigger(props) { const { render: _render, ...dom } = props; return <div {...dom} /> }`,
      errors: [{ messageId: 'dropped' }],
    },
  ],
})

describe('ui selector restrictions', () => {
  const flagged = [
    ['text-white', `<p className="text-white" />`, /palette/],
    ['bg-black/50', `<p className="bg-black/50" />`, /palette/],
    ['bg-muted', `<i className="size-2 rounded-full bg-muted" />`, /no muted fill/],
    ['shadow-md', `<div className="focus:shadow-md" />`, /shadow-/],
    ['animate-pulse', `<div className="h-16 animate-pulse bg-background-secondary-default/30" />`, /animate-pulse/],
    ['animate-spin', `<Icon className="w-3.5 h-3.5 animate-spin" />`, /animate-spin/],
    [
      'bg-status-danger/10',
      `<div className="rounded-lg border border-status-danger/30 bg-status-danger/10" />`,
      /alpha/,
    ],
    ['legacy text-muted', `<p className="text-xs text-muted" />`, /HeroUI token/],
    ['legacy bg-default under a variant', `<div className="hover:bg-default/50" />`, /HeroUI token/],
    ['legacy status', `<span className="text-danger-soft-foreground" />`, /HeroUI token/],
    ['legacy shadow', `<div className="shadow-surface" />`, /HeroUI token/],
    ['tailwind type size', `<p className="text-sm text-text-secondary" />`, /composite scale/],
    ['bare font weight', `<span className="truncate font-medium" />`, /Bare font weight/],
    [
      'Button text-danger',
      `<Button variant="ghost" className="ml-auto text-status-danger hover:text-status-danger" />`,
      /variant="danger"/,
    ],
    ['Button text-danger in cx()', `<Button className={cx('text-status-danger', x)} />`, /variant="danger"/],
    ['Button h-auto', `<Button variant="ghost" className="h-auto w-full justify-start" />`, /h-auto/],
    [
      'state attr on Content',
      `<Checkbox.Content className="rounded-lg data-[selected=true]:bg-background-secondary-default/80" />`,
      /root/,
    ],
    ['Button onClick', `<Button onClick={go} />`, /onPress/],
    ['Button disabled', `<Button disabled={busy} />`, /isDisabled/],
    ['Spinner className size', `<Spinner className="w-3.5 h-3.5" />`, /size prop/],
    ['template className', '<div className={`${base} rounded-xl`} />', /cx\(/],
    ['t().replace', `const s = t('toolbar.noAssistant').replace(/^No /, 'Select ')`, /translation/],
    ['glyph icon', `<Button aria-label="Cancel">✕</Button>`, /icon/],
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
    [
      'token colours',
      `<p className="text-status-danger-foreground bg-status-danger-soft text-text-secondary bg-background-primary-default border-border-button-default" />`,
    ],
    ['gradient over a fill', `<div className="from-status-danger via-status-danger/80 to-transparent" />`],
    // BoardUI's own spellings, which the HeroUI-era gates used to refuse.
    ['cursor-pointer', `<span className="cursor-pointer" />`],
    ['uppercase', `<span className="uppercase" />`],
    ['bare rounded', `<span className="rounded px-1" />`],
    ['px max-width', `<div className="max-w-[360px]" />`],
    ['native title', `<span title="hint" />`],
    ['rounded-lg', `<span className="rounded-lg rounded-t-none" />`],
    ['shadow tokens', `<div className="shadow-xs shadow-card shadow-dropdown shadow-none" />`],
    ['danger variant', `<Button variant="danger" />`],
    // Danger on hover only, for an inline icon-only delete among neutral
    // icons; and the soft foreground, which is a different class.
    ['hover danger on a neutral icon', `<Button iconOnly variant="neutral" className="hover:text-status-danger" />`],
    [
      'soft foreground',
      `<Button className={cx(selected ? 'text-status-danger-soft-foreground' : 'text-text-secondary')} />`,
    ],
    ['state attr on root', `<Checkbox className="data-[selected=true]:bg-background-tertiary-default" />`],
    ['onPress', `<Button onPress={go} isDisabled={busy} />`],
    ['boardui text-white token', `<span className="bg-button-primary text-text-white" />`],
    ['Spinner size prop', `<Spinner size="sm" className="shrink-0" />`],
    ['cx()', `<div className={cx('a', b)} />`],
    ['plain replace', `const s = value.replace(/a/, 'b')`],
    ['ellipsis in text', `<p>Loading…</p>`],
    ['multiplication count', `<span>×{count}</span>`],
    ['Label component', `<Label>A</Label>`],
    ['composite type', `<p className="text-body-medium text-caption-1-semibold" />`],
    ['prefixed weight', `<p className="[&_strong]:font-medium prose-headings:font-semibold" />`],
  ]
  for (const [name, code] of clean) {
    it(`accepts ${name}`, () => {
      assert.deepEqual(lint(code), [])
    })
  }
})
