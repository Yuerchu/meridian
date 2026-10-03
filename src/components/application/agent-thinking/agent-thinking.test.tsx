import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentThinking } from './agent-thinking'

describe('AgentThinking', () => {
  it('keeps its ticking timer out of the live region it announces through', () => {
    // role="status" is aria-atomic: a change anywhere inside re-reads all of it,
    // and the timer changes ten times a second.
    render(<AgentThinking variant="infinity" label="Thinking" />)
    const status = screen.getByRole('status')
    const timer = [...status.querySelectorAll('span')].find((el) => /^\d+\.\ds$/.test(el.textContent ?? ''))
    expect(timer).toBeDefined()
    expect(timer!.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(status).toHaveTextContent('Thinking')
  })
})
