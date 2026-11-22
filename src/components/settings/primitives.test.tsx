import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { SettingsNavRow, SettingsPane, SettingsSelect, SettingsSkeleton } from './primitives'
import { SettingsPage } from './settings-page'

type Level = 'all' | 'warn' | 'error'

const OPTIONS = [
  { value: 'all', label: 'All levels' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
] as const satisfies readonly { value: Level; label: string }[]

describe('SettingsNavRow', () => {
  it('uses the default chevron only when trailing content is omitted', () => {
    const { container, rerender } = render(<SettingsNavRow label="Provider" />)
    expect(container.querySelector('[data-slot="settings-nav-row"] svg')).toBeInTheDocument()

    // `null` is intentional absence, not a missing value. Provider and MCP peer
    // rows used it to opt out of navigation chrome, but nullish coalescing put
    // the chevron straight back.
    rerender(<SettingsNavRow label="Provider" trailing={null} />)
    expect(container.querySelector('[data-slot="settings-nav-row"] svg')).not.toBeInTheDocument()
  })
})

describe('SettingsRow', () => {
  it('names and describes its control through React Aria context', () => {
    render(
      <SettingsRow label="Auto-connect" description="Reconnects on launch">
        <Switch isSelected={false} onChange={() => {}} />
      </SettingsRow>,
    )
    const control = screen.getByRole('switch', { name: 'Auto-connect' })
    expect(control).toHaveAccessibleDescription('Reconnects on launch')
  })

  it('leaves the control without a description when the row has none', () => {
    render(
      <SettingsRow label="Shell">
        <Switch isSelected={false} onChange={() => {}} />
      </SettingsRow>,
    )
    expect(screen.getByRole('switch', { name: 'Shell' })).not.toHaveAttribute('aria-describedby')
  })
})

describe('SettingsSelect', () => {
  it('preserves descriptions, external names and disabled settings', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <span id="level-label">Log level</span>
        <SettingsSelect
          ariaLabelledBy="level-label"
          description="Only affects displayed logs"
          value="all"
          options={OPTIONS}
          onChange={onChange}
          disabled
        />
      </>,
    )
    const trigger = screen.getByRole('button', { name: /Log level/ })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAccessibleDescription('Only affects displayed logs')
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('dismisses with Escape and outside press without changing the selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SettingsSelect ariaLabel="Level" value="all" options={OPTIONS} onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: /Level/ })
    await user.click(trigger)
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.click(trigger)
    await user.click(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the none sentinel selectable and cannot clear with Delete', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SettingsSelect
        ariaLabel="Provider"
        value="provider"
        options={[
          { value: '_none', label: 'None' },
          { value: 'provider', label: 'Provider A' },
        ]}
        onChange={onChange}
      />,
    )
    const trigger = screen.getByRole('button', { name: /Provider/ })
    trigger.focus()
    await user.keyboard('{Delete}')
    expect(onChange).not.toHaveBeenCalled()
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'None' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('_none')
  })

  it('hands the caller its own value type back, never a key or null', async () => {
    const user = userEvent.setup()
    // Typed as the union rather than `string`: if the component widened what it
    // passes back, this would stop compiling. That is the whole point of it —
    // the twenty call sites it replaced each narrowed `Key | null` by hand, in
    // five different ways.
    const onChange = vi.fn<(value: Level) => void>()
    render(<SettingsSelect ariaLabel="Level" value="all" options={OPTIONS} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /Level/ }))
    await user.click(await screen.findByRole('option', { name: 'Warnings' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('warn')
  })

  /**
   * The name is "Level All levels", not "Level": React Aria points the
   * trigger's `aria-labelledby` at itself plus the value, so the control's own
   * name and its current setting are announced together. Both halves matter —
   * two of the dropdowns this replaced had only the second.
   */
  it('names the trigger from ariaLabel', () => {
    render(<SettingsSelect ariaLabel="Level" value="all" options={OPTIONS} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Level/ })).toBeInTheDocument()
  })

  it('names the trigger from a visible label', () => {
    render(<SettingsSelect label="Level" value="all" options={OPTIONS} onChange={vi.fn()} />)
    // The label is a real one, so it names the control rather than sitting
    // beside it — two of the dropdowns this replaced had neither and were
    // announced by their current value alone.
    expect(screen.getByRole('button', { name: /Level/ })).toBeInTheDocument()
  })

  it('shows the option matching the current value', () => {
    render(<SettingsSelect ariaLabel="Level" value="error" options={OPTIONS} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Level/ })).toHaveTextContent('Errors')
  })
})

// One width for every page, the registry settings-modal's content pane. The
// pages used to pick from three (lg, 3xl, 4xl), so moving between sections
// moved the column under the reader.
describe('the settings width', () => {
  it('names the loading region once and hides its placeholder shapes', () => {
    const { container } = render(<SettingsSkeleton rows={3} />)
    const status = screen.getByRole('status')
    expect(status).toHaveAccessibleName()
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    const shapes = container.querySelectorAll('.ui-skeleton')
    expect(shapes).toHaveLength(5)
    for (const shape of shapes) expect(shape).toHaveAttribute('aria-hidden', 'true')
  })

  it('is the registry settings-modal content pane, 532px', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/meridian.css'), 'utf8')
    expect(css).toMatch(/--content-settings:\s*33\.25rem;/)
  })

  it('is the width of every page shell, and of the skeleton that stands in for one', () => {
    const { container } = render(
      <>
        <SettingsPane />
        <SettingsSkeleton />
        <SettingsPage title="Page" />
      </>,
    )
    const shells = [
      { slot: 'settings-pane', className: 'm-settings-pane', stylesheet: 'primitives.css' },
      { slot: 'settings-skeleton', className: 'm-settings-skeleton', stylesheet: 'primitives.css' },
      { slot: 'settings-page', className: 'm-settings-page', stylesheet: 'settings-page.css' },
    ]
    for (const { slot, className, stylesheet } of shells) {
      const el = container.querySelector(`[data-slot="${slot}"]`)
      expect(el, slot).toHaveClass(className)
      const css = readFileSync(resolve(__dirname, stylesheet), 'utf8')
      expect(css, slot).toMatch(/max-width:\s*var\(--content-settings\)/)
    }
  })
})
