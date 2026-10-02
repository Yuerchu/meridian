import type { Mermaid } from 'mermaid'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRenderer } from './mermaid-render'

const mermaid = { initialize: vi.fn(), render: vi.fn() }
const render = createRenderer(mermaid as unknown as Mermaid)

describe('the renderer inside mermaid-frame.html', () => {
  beforeEach(() => {
    mermaid.initialize.mockReset()
    mermaid.render.mockReset()
    document.body.replaceChildren()
  })

  // The diagram is model output; strict is Mermaid's own sanitising.
  it('draws in strict mode, in the theme asked for, with the system font', async () => {
    mermaid.render.mockResolvedValue({ svg: '<svg/>' })
    await expect(render('flowchart LR\n  A --> B', 'dark')).resolves.toBe('<svg/>')

    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        theme: 'dark',
        startOnLoad: false,
        fontFamily: 'system-ui, sans-serif',
      }),
    )
  })

  it('passes a parse error on, and clears what the failed render left behind', async () => {
    mermaid.render.mockImplementation(async () => {
      document.body.append(document.createElement('div'))
      throw new Error('Parse error on line 2')
    })

    await expect(render('flowchart LR\n  A -->', 'light')).rejects.toThrow('Parse error on line 2')
    expect(document.body.childElementCount).toBe(0)
  })
})
