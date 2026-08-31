import { render, screen } from '@testing-library/react'

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
  return render(<ComposerSuggestions items={items} activeIndex={0} onAction={vi.fn()} ariaLabel="Commands" />)
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

    rerender(<ComposerSuggestions items={[commands[0]]} activeIndex={0} onAction={vi.fn()} ariaLabel="Commands" />)

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
