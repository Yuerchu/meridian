import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import bridge from './mermaid-bridge.js?raw'

/**
 * The bridge as it runs in the sandbox, against a stand-in Mermaid. In jsdom
 * the top window is its own parent, so what the bridge posts to `parent`
 * arrives here.
 */
describe('the sandbox bridge', () => {
  const mermaid = { initialize: vi.fn(), render: vi.fn() }
  let answers: unknown[]
  const listen = (event: MessageEvent) => answers.push(event.data)

  beforeEach(() => {
    answers = []
    mermaid.initialize.mockReset()
    mermaid.render.mockReset()
    ;(globalThis as { mermaid?: unknown }).mermaid = mermaid
    window.addEventListener('message', listen)
    new Function(bridge)()
  })

  afterEach(() => {
    window.removeEventListener('message', listen)
    delete (globalThis as { mermaid?: unknown }).mermaid
  })

  function ask(data: unknown, source: MessageEventSource | null = window) {
    window.dispatchEvent(new MessageEvent('message', { data, source }))
  }

  it('says it is ready, then draws in strict mode with the system font', async () => {
    await vi.waitFor(() => expect(answers).toContainEqual({ ready: true }))
    mermaid.render.mockResolvedValue({ svg: '<svg/>' })

    ask({ id: 7, code: 'flowchart LR\n  A --> B', theme: 'dark' })

    await vi.waitFor(() => expect(answers).toContainEqual({ id: 7, svg: '<svg/>' }))
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        theme: 'dark',
        startOnLoad: false,
        fontFamily: 'system-ui, sans-serif',
      }),
    )
  })

  it('answers a failure with its reason and clears what the render left behind', async () => {
    mermaid.render.mockImplementation(async () => {
      document.body.append(document.createElement('div'))
      throw new Error('Parse error on line 2')
    })

    ask({ id: 8, code: 'flowchart LR\n  A -->', theme: 'light' })

    await vi.waitFor(() => expect(answers).toContainEqual({ id: 8, error: 'Parse error on line 2' }))
    await vi.waitFor(() => expect(document.body.childElementCount).toBe(0))
  })

  it('ignores a request in any other shape, or from anywhere but its parent', async () => {
    for (const data of [
      { id: '9', code: 'x', theme: 'light' },
      { id: 9, code: 1, theme: 'light' },
      { id: 9, code: 'x', theme: 'blue' },
    ]) {
      ask(data)
    }
    ask({ id: 9, code: 'x', theme: 'light' }, null)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mermaid.render).not.toHaveBeenCalled()
  })
})
