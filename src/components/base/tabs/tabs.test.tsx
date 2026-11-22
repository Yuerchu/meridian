import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setContainerWidth } from '@/test/resize'
import { Tab, TabList, Tabs } from './tabs'

/** jsdom does no layout: give an element the box a browser would have. */
function setBox(el: HTMLElement, left: number, width: number) {
  Object.defineProperty(el, 'offsetLeft', { configurable: true, value: left })
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width })
}

/**
 * The selection indicator follows its tab when only the tab changes width — a
 * count that gains a digit, a font that finishes loading. Watching the strip
 * alone missed both: a full-width strip does not resize when one label grows.
 */
describe('selection indicators re-measure when one item changes width', () => {
  it('TabList underline', async () => {
    const { container } = render(
      <Tabs>
        <TabList aria-label="Inbox">
          <Tab id="all" count={9}>
            All
          </Tab>
          <Tab id="system">System</Tab>
        </TabList>
      </Tabs>,
    )
    // The strip's MutationObserver attaches to tabs a collection renders late.
    await act(async () => {})
    const tab = screen.getByRole('tab', { name: /All/ })
    setBox(tab, 0, 48)
    act(() => setContainerWidth(tab, 48))
    const underline = container.querySelector<HTMLElement>('span[aria-hidden].absolute')
    expect(underline).toHaveStyle({ width: '48px' })

    setBox(tab, 0, 56)
    act(() => setContainerWidth(tab, 56))
    expect(underline).toHaveStyle({ width: '56px' })
  })
})
