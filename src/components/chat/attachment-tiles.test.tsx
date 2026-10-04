import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
import { acceptsConversationDrop } from '@/components/layout/sidebar-dnd'
import { objectKey } from '@/lib/object-key'
import { ATTACHMENT_DRAG_TYPE, AttachmentTiles, attachmentDragItems, reorderAttachments } from './attachment-tiles'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

const a = { name: 'a.ts' }
const b = { name: 'b.md' }
const c = { name: 'c.pdf' }

describe('reorderAttachments', () => {
  it('puts the moved file before or after its target', () => {
    expect(reorderAttachments([a, b, c], new Set([objectKey(c)]), objectKey(a), 'before')).toEqual([c, a, b])
    expect(reorderAttachments([a, b, c], new Set([objectKey(a)]), objectKey(b), 'after')).toEqual([b, a, c])
    expect(reorderAttachments([a, b, c], new Set([objectKey(a)]), objectKey(c), 'after')).toEqual([b, c, a])
  })

  it('leaves the files alone when the target is not one of them', () => {
    const files = [a, b]
    expect(reorderAttachments(files, new Set([objectKey(a)]), 'nowhere', 'before')).toBe(files)
  })
})

describe('a dragged tile', () => {
  it('carries its own type and never plain text, which a drop on the field would paste', () => {
    const [item] = attachmentDragItems(new Set([objectKey(a)]))
    expect(Object.keys(item)).toEqual([ATTACHMENT_DRAG_TYPE])
    expect(item).not.toHaveProperty('text/plain')
  })

  it('is not something the window takes for a conversation', () => {
    expect(acceptsConversationDrop(new Set([ATTACHMENT_DRAG_TYPE]))).toBe(false)
  })
})

describe('AttachmentTiles', () => {
  it('numbers two or more files, and makes each number the handle for moving it', () => {
    render(<AttachmentTiles files={[a, b]} onReorder={() => {}} />)
    const tiles = screen.getAllByRole('row')
    expect(tiles).toHaveLength(2)
    expect(within(tiles[1]).getByRole('button', { name: 'Move b.md' })).toHaveTextContent('2')
    expect(tiles[0]).toHaveAccessibleName('1. a.ts')
  })

  it('does not number a single file, and has nothing to move', () => {
    const { container } = render(<AttachmentTiles files={[a]} onReorder={() => {}} />)
    expect(container.querySelector('[data-slot="attachment-tile-order"]')).toBeNull()
  })

  it('shows the numbers but offers no moving when the order cannot change', () => {
    render(<AttachmentTiles files={[a, b]} />)
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('removes the file whose tile was pressed', async () => {
    const onRemove = vi.fn()
    render(<AttachmentTiles files={[a, b, c]} onRemove={onRemove} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove b.md' }))
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('marks a file that has gone since the draft was saved', () => {
    render(<AttachmentTiles files={[{ name: 'gone.txt', missing: true }]} />)
    expect(screen.getByText('gone.txt').className).toContain('text-status-danger')
  })
})
