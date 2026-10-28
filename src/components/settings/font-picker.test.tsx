import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import { FontPicker } from './font-picker'

describe('FontPicker', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the system placeholder when nothing is chosen', () => {
    render(<FontPicker label="Interface font" value={null} onChange={() => {}} families={['Segoe UI']} />)
    const input = screen.getByRole('combobox', { name: 'Interface font' })
    expect(input).toHaveAttribute('placeholder', 'System')
    expect(input).toHaveValue('')
  })

  it('commits a listed family and previews it in that face', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <FontPicker
        label="Interface font"
        value={null}
        onChange={onChange}
        families={['Segoe UI', 'Microsoft YaHei UI']}
      />,
    )
    await user.click(screen.getByRole('combobox', { name: 'Interface font' }))
    const option = await screen.findByRole('option', { name: 'Segoe UI' })
    expect(option.style.fontFamily).toMatch(/Segoe UI/)
    await user.click(option)
    expect(onChange).toHaveBeenCalledWith('Segoe UI')
  })

  it('commits system as null', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<FontPicker label="Interface font" value="Segoe UI" onChange={onChange} families={['Segoe UI']} />)
    await user.click(screen.getByRole('combobox', { name: 'Interface font' }))
    await user.click(await screen.findByRole('option', { name: 'System' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('does not preview the system option in a face', async () => {
    const user = userEvent.setup()
    render(<FontPicker label="Interface font" value={null} onChange={() => {}} families={['Segoe UI']} />)
    await user.click(screen.getByRole('combobox', { name: 'Interface font' }))
    const option = await screen.findByRole('option', { name: 'System' })
    expect(option.getAttribute('style') ?? '').not.toMatch(/font-family/)
  })

  it('commits a typed custom name on blur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <div>
        <FontPicker label="Interface font" value={null} onChange={onChange} families={['Segoe UI']} />
        <button type="button">away</button>
      </div>,
    )
    const input = screen.getByRole('combobox', { name: 'Interface font' })
    await user.click(input)
    // Paste, not key-by-key: the open listbox eats the first keystroke, and
    // RAC's focus scope aria-hides the sibling "away" button so a click there
    // is not an accessible target while the menu is open.
    await user.paste('Cascadia Code')
    expect(input).toHaveValue('Cascadia Code')
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith('Cascadia Code')
  })

  it('reverts an unsafe typed name instead of committing it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <div>
        <FontPicker label="Interface font" value={null} onChange={onChange} families={['Segoe UI']} />
        <button type="button">away</button>
      </div>,
    )
    const input = screen.getByRole('combobox', { name: 'Interface font' })
    await user.click(input)
    await user.paste('foo"; color: red')
    expect(input).toHaveValue('foo"; color: red')
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
  })
})
