import { render } from '@testing-library/react'

import { ChatAttachment } from './chat-attachment'

it('draws the type icon for a spreadsheet', () => {
  const { container } = render(<ChatAttachment name="会飞的羊-10-28调用.xlsx" />)
  const img = container.querySelector('[data-slot="chat-attachment-preview"] img')
  expect(img).not.toBeNull()
  expect(img).toHaveAttribute('aria-hidden')
  expect(img?.getAttribute('src') ?? '').toMatch(/\.svg(?:\?|$)/)
  expect(container.querySelector('[data-slot="chat-attachment-preview"] svg')).toBeNull()
})

it('draws the picture when given an image src', () => {
  const { container } = render(<ChatAttachment mediaType="image" name="截图" src="data:image/png;base64,AA" />)
  const img = container.querySelector('[data-slot="chat-attachment-preview"] img')
  expect(img).toHaveAttribute('src', 'data:image/png;base64,AA')
  expect(img).toHaveAttribute('alt', '截图')
  expect(img).toHaveClass('size-full')
})
