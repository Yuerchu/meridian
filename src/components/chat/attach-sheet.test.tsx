import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachSheet, type AttachSheetProps } from './attach-sheet'
import i18n from '@/i18n'

function props(over: Partial<AttachSheetProps> = {}): AttachSheetProps {
  return {
    onTakePhoto: vi.fn(),
    onPickGallery: vi.fn(),
    supportsImages: true,
    ...over,
  }
}

describe('AttachSheet', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('lists what can be added, and nothing about the turn', async () => {
    const user = userEvent.setup()
    render(<AttachSheet {...props({ onPickFile: vi.fn(), onOpenStickers: vi.fn() })} />)
    await user.click(screen.getByRole('button', { name: 'Options and attachments' }))

    const menu = await screen.findByRole('menu', { name: 'Options and attachments' })
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    expect(names).toEqual(['Take Photo', 'Choose from Gallery', 'Attach File', 'Emoji'])
  })

  it('runs the chosen action and closes', async () => {
    const user = userEvent.setup()
    const onOpenStickers = vi.fn()
    render(<AttachSheet {...props({ onOpenStickers })} />)
    await user.click(screen.getByRole('button', { name: 'Options and attachments' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Emoji' }))
    expect(onOpenStickers).toHaveBeenCalled()
  })

  it('is not drawn with nothing to add', () => {
    const { container } = render(<AttachSheet {...props({ supportsImages: false })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
