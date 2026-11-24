import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import TodoBoard from '@/components/chat/todo-board'
import { useBoardStore } from '@/stores/board-store'
import { useConversationStore } from '@/stores/conversation-store'
import type { ProjectInfoResponse } from '@/types'
import { ComposerField } from './card-composer'
import { DraftCard } from './draft-card'
import { FoldedColumn } from './folded-column'
import { Masonry } from './masonry'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useBoardStore.setState({ composerText: {}, draftProjectId: {} })
  useConversationStore.setState({
    projects: [{ id: 'p-1', name: 'Meridian', source_type: 'local', path: '/tmp/meridian' } as ProjectInfoResponse],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useBoardStore.setState({ composerText: {}, draftProjectId: {} })
  useConversationStore.setState({ projects: [] })
})

describe('ComposerField', () => {
  it('submits on Enter and ignores Shift+Enter and IME composition', async () => {
    const onSend = vi.fn()
    render(
      <ComposerField
        value="  hello world  "
        setValue={vi.fn()}
        placeholder="Write..."
        running={false}
        maxLines={4}
        onSend={onSend}
      />,
    )
    const textarea = screen.getByRole('textbox')

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()

    const composingEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(composingEvent, 'isComposing', { value: true })
    textarea.dispatchEvent(composingEvent)
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('hello world')
  })

  it('shows Stop when running with empty input and Send when running with text', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onStop = vi.fn()
    const { rerender } = render(
      <ComposerField
        value=""
        setValue={vi.fn()}
        placeholder="Queued..."
        running={true}
        maxLines={4}
        onSend={onSend}
        onStop={onStop}
      />,
    )

    const stopBtn = screen.getByRole('button', { name: i18n.t('board.composer.stop') })
    await user.click(stopBtn)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()

    rerender(
      <ComposerField
        value="follow-up"
        setValue={vi.fn()}
        placeholder="Queued..."
        running={true}
        maxLines={4}
        onSend={onSend}
        onStop={onStop}
      />,
    )

    const sendBtn = screen.getByRole('button', { name: i18n.t('board.composer.send') })
    await user.click(sendBtn)
    expect(onSend).toHaveBeenCalledWith('follow-up')
  })

  it('calls onEscapeEmpty only when input is empty', () => {
    const onEscapeEmpty = vi.fn()
    const { rerender } = render(
      <ComposerField
        value="draft text"
        setValue={vi.fn()}
        placeholder="Task..."
        running={false}
        maxLines={6}
        onSend={vi.fn()}
        onEscapeEmpty={onEscapeEmpty}
      />,
    )
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onEscapeEmpty).not.toHaveBeenCalled()

    rerender(
      <ComposerField
        value=""
        setValue={vi.fn()}
        placeholder="Task..."
        running={false}
        maxLines={6}
        onSend={vi.fn()}
        onEscapeEmpty={onEscapeEmpty}
      />,
    )
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onEscapeEmpty).toHaveBeenCalledTimes(1)
  })
})

describe('DraftCard', () => {
  it('cancels on Escape when the draft box is empty', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    const { container } = render(<DraftCard stage="backlog" onDone={onDone} onError={vi.fn()} />)
    expect(container.querySelector('[data-draft]')).not.toBeNull()
    expect(screen.getByRole('textbox')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

describe('FoldedColumn', () => {
  it('renders folded attribute and opens on press', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const { container } = render(<FoldedColumn title="Review" cards={[]} side="end" onOpen={onOpen} />)
    expect(container.querySelector('[data-folded]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: i18n.t('board.column.open', { title: 'Review', count: 0 }) }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('Masonry', () => {
  it('deals items across lanes in index order', () => {
    const { container } = render(
      <Masonry
        items={['a', 'b', 'c']}
        minLaneWidth={304}
        label="Backlog"
        empty="Empty"
        render={(item) => <div key={item}>{item}</div>}
      />,
    )
    expect(container.querySelector('[data-slot="board-masonry"]')).not.toBeNull()
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.getByText('c')).toBeInTheDocument()
  })
})

describe('TodoBoard', () => {
  it('renders read-only columns, empty states, and status text hooks', () => {
    const { container } = render(
      <TodoBoard
        todos={[
          { content: 'Pending item', active_form: 'Pending', status: 'pending' },
          { content: 'Completed item', active_form: 'Done', status: 'completed' },
        ]}
      />,
    )
    expect(container.querySelector('[data-slot="todo-board-empty"]')).toHaveTextContent(i18n.t('chat.todo.emptyColumn'))
    const texts = [...container.querySelectorAll('[data-slot="todo-board-card-text"]')]
    expect(texts).toHaveLength(2)
    expect(texts[0]).toHaveAttribute('data-status', 'pending')
    expect(texts[0]).toHaveTextContent('Pending item')
    expect(texts[1]).toHaveAttribute('data-status', 'completed')
    expect(texts[1]).toHaveTextContent('Completed item')
  })
})
