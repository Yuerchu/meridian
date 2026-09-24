import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { suggestionOptionId } from '@/hooks/use-composer-typeahead'
import { ComposerSuggestions, type ComposerSuggestion } from './composer-suggestions'

const commands: ComposerSuggestion[] = [
  {
    id: 'command:model',
    kind: 'command',
    label: '/model',
    detail: '[model] Select the model',
  },
  {
    id: 'command:thinking',
    kind: 'command',
    label: '/thinking',
    detail: '[level] Select the reasoning effort',
  },
]

function renderSuggestions(items: ComposerSuggestion[]) {
  return render(<ComposerSuggestions id="s" items={items} activeIndex={0} onAction={vi.fn()} ariaLabel="Commands" />)
}

describe('ComposerSuggestions layout', () => {
  it('uses one stable command-name column for every command and after filtering', () => {
    const { rerender } = renderSuggestions(commands)
    const modelRow = screen.getByText('/model').closest('[data-slot="composer-suggestion-row"]') as HTMLElement
    const thinkingRow = screen.getByText('/thinking').closest('[data-slot="composer-suggestion-row"]') as HTMLElement

    expect(modelRow).toHaveClass('grid', 'w-full', 'text-left')
    expect(thinkingRow).toHaveClass('grid', 'w-full', 'text-left')
    expect(modelRow.style.gridTemplateColumns).toBe('1rem 9ch minmax(0, 1fr)')
    expect(thinkingRow.style.gridTemplateColumns).toBe(modelRow.style.gridTemplateColumns)

    rerender(
      <ComposerSuggestions id="s" items={[commands[0]]} activeIndex={0} onAction={vi.fn()} ariaLabel="Commands" />,
    )

    const filteredRow = screen.getByText('/model').closest('[data-slot="composer-suggestion-row"]') as HTMLElement
    expect(filteredRow.style.gridTemplateColumns).toBe(modelRow.style.gridTemplateColumns)
  })

  it('keeps file suggestions on the full-width flexible layout', () => {
    renderSuggestions([
      {
        id: 'reference:src/index.ts',
        kind: 'file',
        label: 'index.ts',
        detail: 'src/index.ts',
        path: 'src/index.ts',
      },
    ])

    const row = screen.getByText('index.ts').closest('[data-slot="composer-suggestion-row"]') as HTMLElement
    expect(row).toHaveClass('flex', 'w-full', 'text-left')
    expect(row).not.toHaveClass('grid')
    expect(row.style.gridTemplateColumns).toBe('')
  })
})

describe('ComposerSuggestions as the popup of a combobox', () => {
  it('runs the action when a row is pressed', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<ComposerSuggestions id="s" items={commands} activeIndex={0} onAction={onAction} ariaLabel="Commands" />)

    await user.click(screen.getByRole('option', { name: /\/thinking/ }))
    expect(onAction).toHaveBeenCalledWith(commands[1])
  })

  it('marks the highlighted row for aria-activedescendant, and scrolls it into view', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { rerender } = render(
      <ComposerSuggestions id="s" items={commands} activeIndex={0} onAction={vi.fn()} ariaLabel="Commands" />,
    )
    const listbox = screen.getByRole('listbox', { name: 'Commands' })
    expect(listbox).toHaveAttribute('id', 's')
    const [first, second] = screen.getAllByRole('option')
    expect(first).toHaveAttribute('id', suggestionOptionId('s', 0))
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(second).toHaveAttribute('aria-selected', 'false')

    scroll.mockClear()
    rerender(<ComposerSuggestions id="s" items={commands} activeIndex={1} onAction={vi.fn()} ariaLabel="Commands" />)
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scroll.mock.contexts[0]).toBe(second)
  })
})
