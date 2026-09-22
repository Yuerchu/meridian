import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Switch } from '@/components/base'
import { SettingsNavRow, SettingsRow, SettingsSelect } from './primitives'

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
  /**
   * The label is a `<p>`, so it names nothing on its own. A row whose control
   * does not take the ids — or carry its own `aria-label` — is a switch a
   * screen reader announces as "switch", with no indication of what it turns
   * on. The function child is the mechanism, so this pins that it is wired.
   */
  it('lends its label and description to a control that asks for them', () => {
    render(
      <SettingsRow label="Auto-connect" description="Reconnects on launch">
        {({ labelId, descriptionId }) => (
          <Switch aria-labelledby={labelId} aria-describedby={descriptionId} isSelected={false} onChange={() => {}} />
        )}
      </SettingsRow>,
    )
    const control = screen.getByRole('switch', { name: 'Auto-connect' })
    expect(control).toHaveAccessibleDescription('Reconnects on launch')
  })

  it('offers no description id when there is no description', () => {
    const seen: Array<string | undefined> = []
    render(
      <SettingsRow label="Shell">
        {({ descriptionId }) => {
          seen.push(descriptionId)
          return <span>bash</span>
        }}
      </SettingsRow>,
    )
    expect(seen).toEqual([undefined])
  })

  /** A field that cannot shrink drops under its label on a narrow pane. */
  it('stacks only when asked', () => {
    const { container, rerender } = render(<SettingsRow label="Base URL">field</SettingsRow>)
    expect(container.querySelector('[data-slot="settings-row"]')).not.toHaveClass('flex-col')

    rerender(
      <SettingsRow label="Base URL" stacked>
        field
      </SettingsRow>,
    )
    expect(container.querySelector('[data-slot="settings-row"]')).toHaveClass('flex-col')
  })
})

describe('SettingsSelect', () => {
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
