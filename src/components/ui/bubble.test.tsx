import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  Bubble,
  BubbleBlockButton,
  BubbleContent,
  BUBBLE_BLOCK,
} from '@/components/yuerchu-ui/components/chat-bubble/chat-bubble'
import {
  ChatTool,
  ChatToolPresentationProvider,
  ChatToolTrigger,
} from '@/components/yuerchu-ui/components/chat-tool/chat-tool'

const bubbleCss = readFileSync(resolve(__dirname, '../yuerchu-ui/components/chat-bubble/chat-bubble.css'), 'utf8')

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
      expect(block).toHaveClass(BUBBLE_BLOCK)
    }
    expect(bubbleCss).toMatch(/\.ui-chat-bubble__block\s*\{[^}]*border-radius:\s*var\(--ui-bubble-radius/)
    expect(bubbleCss).toMatch(/\.ui-chat-bubble__block\s*\{[^}]*overflow:\s*hidden/)
    expect(bubbleCss).toMatch(
      /\.ui-chat-bubble__block\s*\{[^}]*background-color:\s*var\(--ui-bubble-fill,\s*var\(--surface-muted\)\)/,
    )
  })

  it('takes its colour by inheritance, not by being a direct child', () => {
    expect(bubbleCss).not.toMatch(/\.ui-chat-bubble\s*>\s*\.ui-chat-bubble__block/)
    const { container } = render(
      <Bubble variant="user" align="end" position="first">
        <BubbleContent>asked</BubbleContent>
      </Bubble>,
    )
    const bubble = container.querySelector('[data-slot="bubble"]')!
    expect(bubble).toHaveAttribute('data-variant', 'user')
    expect(bubbleCss).toMatch(
      /\.ui-chat-bubble\[data-variant="user"\]\s*\{[^}]*--ui-bubble-fill:\s*var\(--ui-bubble-user\)/,
    )
    expect(blocks(container)[0]).toHaveClass(BUBBLE_BLOCK)
  })

  it('tightens a corner for a neighbour above and one below, on the speaker’s side only', () => {
    const { container } = render(
      <Bubble variant="assistant" align="start" position="middle">
        <BubbleContent>said</BubbleContent>
      </Bubble>,
    )
    const bubble = container.querySelector('[data-slot="bubble"]')!
    expect(bubble).toHaveAttribute('data-align', 'start')
    expect(bubble).toHaveAttribute('data-position', 'middle')
    expect(bubbleCss).toContain('.ui-chat-bubble[data-align="start"] > [data-bubble-block] ~ [data-bubble-block]')
    expect(bubbleCss).toContain('.ui-chat-bubble[data-align="start"] > [data-bubble-block]:has(~ [data-bubble-block])')
    expect(bubbleCss).toContain(
      '.ui-chat-bubble[data-align="start"]:is([data-position="middle"], [data-position="last"]) > [data-bubble-block]',
    )
    expect(bubbleCss).toContain(
      '.ui-chat-bubble[data-align="start"]:is([data-position="first"], [data-position="middle"]) > [data-bubble-block]',
    )
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
