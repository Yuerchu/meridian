import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SettingsSelect } from './primitives'

type Level = 'all' | 'warn' | 'error'

const OPTIONS = [
  { value: 'all', label: 'All levels' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
] as const satisfies readonly { value: Level; label: string }[]

describe('SettingsSelect', () => {
  it('hands the caller its own value type back, never a key or null', async () => {
    const user = userEvent.setup()
    // Typed as the union rather than `string`: if the component widened what it
    // passes back, this would stop compiling. That is the whole point of it —
    // the twenty call sites it replaced each narrowed `Key | null` by hand, in
    // five different ways.
    const onChange = vi.fn<(value: Level) => void>()
    render(
      <SettingsSelect
        ariaLabel="Level"
        value="all"
        options={OPTIONS}
        onChange={onChange}
      />,
    )

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
    render(
      <SettingsSelect ariaLabel="Level" value="all" options={OPTIONS} onChange={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /Level/ })).toBeInTheDocument()
  })

  it('names the trigger from a visible label', () => {
    render(
      <SettingsSelect label="Level" value="all" options={OPTIONS} onChange={vi.fn()} />,
    )
    // The label is a real one, so it names the control rather than sitting
    // beside it — two of the dropdowns this replaced had neither and were
    // announced by their current value alone.
    expect(screen.getByRole('button', { name: /Level/ })).toBeInTheDocument()
  })

  it('shows the option matching the current value', () => {
    render(
      <SettingsSelect ariaLabel="Level" value="error" options={OPTIONS} onChange={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /Level/ })).toHaveTextContent('Errors')
  })
})
