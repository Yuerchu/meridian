import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DisclosureGroup } from 'react-aria-components'
import { MemoryRow } from './memory-row'
import { api } from '@/api'
import { buildMemories } from '@/dev/demo/settings'

vi.mock('@/api', () => ({ api: { updateMemory: vi.fn(), deleteMemories: vi.fn() } }))
const mocked = vi.mocked(api)
const memory = { ...buildMemories(1_700_000_000_000)[0], visibility: 'owner_only' as const }

beforeEach(() => {
  vi.clearAllMocks()
  mocked.updateMemory.mockResolvedValue(memory)
  mocked.deleteMemories.mockResolvedValue(1)
})

it('keeps selection separate from expansion and saves the edited draft', async () => {
  const user = userEvent.setup()
  const onToggleCheck = vi.fn()
  const onChanged = vi.fn()
  render(
    <DisclosureGroup>
      <MemoryRow memory={memory} checked={false} onToggleCheck={onToggleCheck} onChanged={onChanged} />
    </DisclosureGroup>,
  )

  await user.click(screen.getByRole('checkbox', { name: memory.key }))
  expect(onToggleCheck).toHaveBeenCalledOnce()
  expect(screen.queryByRole('textbox', { name: /content|内容/i })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: memory.key }))
  const editor = await screen.findByRole('textbox', { name: /content|内容/i })
  await user.clear(editor)
  await user.type(editor, 'Use pnpm only.')
  await user.click(screen.getByRole('button', { name: /save|保存/i }))

  expect(mocked.updateMemory).toHaveBeenCalledWith({ id: memory.id, content: 'Use pnpm only.' })
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
})
