import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Resizable } from '@/components/base'
import { CHANGES_PANEL_SIZE, CHAT_PANEL_SIZE } from './changes-split'

/**
 * The split rendered through the real react-resizable-panels, which measures
 * the group as the sum of its panels' `offsetWidth` when it registers. jsdom
 * does no layout, so each panel is told it is half of `paneWidth`; the library
 * then resolves every constraint against that group size exactly as it does in
 * the WebView, and writes the layout as each panel's `flex-grow` percentage.
 *
 * This is the regression the numeric sizes produced: under v4 a bare `30` is
 * thirty pixels, and the changes panel opened a few percent wide.
 */
let paneWidth = 1000
const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-panel') ? paneWidth / 2 : 0
    },
  })
})

afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original)
})

function changesWidth(width: number): number {
  paneWidth = width
  const { container, unmount } = render(
    <Resizable orientation="horizontal">
      <Resizable.Panel id="chat" {...CHAT_PANEL_SIZE}>
        chat
      </Resizable.Panel>
      <Resizable.Handle aria-label="changes" />
      <Resizable.Panel id="changes" {...CHANGES_PANEL_SIZE}>
        changes
      </Resizable.Panel>
    </Resizable>,
  )
  const panel = container.querySelector<HTMLElement>('#changes')
  const percent = Number(panel?.style.flexGrow)
  unmount()
  return (percent / 100) * width
}

describe('chat / changes split', () => {
  it('opens the changes panel at 30% of a wide pane', () => {
    expect(changesWidth(1200)).toBeCloseTo(360, 0)
  })

  it('never opens narrower than one file-tree row, however narrow the pane', () => {
    // 30% of 520 is 156px; the 240px floor wins.
    expect(changesWidth(520)).toBeGreaterThanOrEqual(240 - 0.5)
  })

  it('keeps the separator reachable from the keyboard', () => {
    paneWidth = 1000
    const { getByRole } = render(
      <Resizable orientation="horizontal">
        <Resizable.Panel id="chat" {...CHAT_PANEL_SIZE}>
          chat
        </Resizable.Panel>
        <Resizable.Handle aria-label="changes" />
        <Resizable.Panel id="changes" {...CHANGES_PANEL_SIZE}>
          changes
        </Resizable.Panel>
      </Resizable>,
    )
    const handle = getByRole('separator', { name: 'changes' })
    expect(handle.tabIndex).toBe(0)
    expect(handle.className).toContain('focus-visible:ring-2')
  })
})
