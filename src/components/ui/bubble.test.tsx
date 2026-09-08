import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Bubble, BubbleContent, BUBBLE_BLOCK } from './bubble'
import { BubbleBlockButton } from './bubble-block'
import { ChatTool, ChatToolPresentationProvider, ChatToolTrigger } from './chat-tool'

/**
 * What a block is, as one rule rather than five copies of it.
 *
 * These assert on class names, which is usually a way of testing the
 * implementation rather than the behaviour — but here the class *is* the
 * contract. jsdom does no cascade, so the only way to catch a block that has
 * drifted away from the shared source is to look at what it was given.
 */

/** Every block declares its own fill, so it survives being wrapped. */
const FILL = 'bg-[var(--bubble-fill,var(--bubble-assistant))]'

function blocks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-bubble-block]'))
}

describe('a bubble block', () => {
  it('is the same object wherever it is built', () => {
    const { container } = render(
      <ChatToolPresentationProvider value="bubble">
        <Bubble variant="assistant" align="start">
          <BubbleContent>said</BubbleContent>
          <ChatTool state="output-available">
            <ChatToolTrigger>Read file</ChatToolTrigger>
          </ChatTool>
          <BubbleBlockButton>Go</BubbleBlockButton>
        </Bubble>
      </ChatToolPresentationProvider>,
    )
    const found = blocks(container)
    expect(found).toHaveLength(3)
    for (const block of found) {
      // The radius, the clip and the fill come from one place; drifting from it
      // is what left a tool card invisible in the dark theme before.
      expect(block.className).toContain('rounded-2xl')
      expect(block.className).toContain('overflow-hidden')
      expect(block.className).toContain(FILL)
    }
  })

  it('takes its colour by inheritance, not by being a direct child', () => {
    // The fill is declared on the block and resolved from a custom property the
    // bubble sets, so nothing about it depends on where the block sits. The
    // corner rules are the only part that does — see the next test.
    for (const rule of BUBBLE_BLOCK) {
      expect(rule).not.toContain('&>')
    }
    const { container } = render(
      <Bubble variant="user" align="end" position="first">
        <BubbleContent>asked</BubbleContent>
      </Bubble>,
    )
    expect(container.querySelector('[data-slot="bubble"]')!.className).toContain('[--bubble-fill:var(--bubble-user)]')
    expect(blocks(container)[0].className).toContain(FILL)
  })

  it('tightens a corner for a neighbour above and one below, on the speaker’s side only', () => {
    const { container } = render(
      <Bubble variant="assistant" align="start" position="middle">
        <BubbleContent>said</BubbleContent>
      </Bubble>,
    )
    const bubble = container.querySelector('[data-slot="bubble"]')!
    // Two triggers per corner: another block in this bubble, or another bubble
    // in this run. `position` carries the second, which is why it selects
    // nothing on its own.
    expect(bubble.className).toContain('[&>[data-bubble-block]~[data-bubble-block]]:rounded-tl-md')
    expect(bubble.className).toContain('[&>[data-bubble-block]:has(~[data-bubble-block])]:rounded-bl-md')
    expect(bubble.className).toContain(
      '[&:is([data-position=middle],[data-position=last])>[data-bubble-block]]:rounded-tl-md',
    )
    expect(bubble).toHaveAttribute('data-position', 'middle')
    // The far side is never touched.
    expect(bubble.className).not.toContain('rounded-tr-md')
    expect(bubble.className).not.toContain('rounded-br-md')
  })

  it('says so when a block has been buried under a wrapper', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <Bubble variant="assistant">
        <BubbleContent>said</BubbleContent>
        <div data-slot="a-wrapper">
          <div data-slot="buried-block" data-bubble-block="" />
        </div>
      </Bubble>,
    )
    // It keeps its fill — that inherits — and loses only its corners, which is
    // exactly the kind of failure that reads as a design choice on screen.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('buried-block'))
    warn.mockRestore()
  })

  it('leaves a nested bubble’s blocks to that bubble', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <Bubble variant="assistant">
        <BubbleContent>said</BubbleContent>
        <div>
          <Bubble variant="muted">
            <BubbleContent data-slot="inner-content">quoted</BubbleContent>
          </Bubble>
        </div>
      </Bubble>,
    )
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
