import { expect, test } from '@playwright/test'
import { openApp, openSettings, settle } from './fixtures'

/**
 * Every settings page sits at the one settings width (`max-w-settings`,
 * 532px — the registry settings-modal's content pane).
 *
 * The page shells carry it (`primitives.test.tsx` checks those), but a page
 * that does not go through a shell carries nothing, and a unit test cannot
 * see that: the memory page stayed full-width when every other page moved.
 * So this walks the settings nav in the running app and measures the first
 * element under the scroller that has a max-width at all.
 */
test('every settings page is at the settings width', async ({ page }) => {
  await openApp(page, { theme: 'light' })
  await openSettings(page)

  const labels = (await page.locator('[role="treegrid"] [role="row"]').allInnerTexts())
    .map((text) => text.trim().split('\n')[0])
    .filter((label) => label && label !== '返回应用')
  expect(labels.length).toBeGreaterThan(10)

  const widths: Record<string, string> = {}
  for (const label of new Set(labels)) {
    const row = page.getByRole('row', { name: label, exact: true })
    if ((await row.count()) !== 1) continue
    // Every section swaps the one scroller's contents, so measure only once the
    // page's own heading has replaced the previous one — otherwise the first
    // (lazily loaded) page reads as no scroller, and any page could be measured
    // as the one before it.
    const heading = page.getByRole('heading', { level: 2 }).first()
    const before = (await heading.count()) ? await heading.textContent() : null
    await row.click()
    await expect.poll(async () => ((await heading.count()) ? await heading.textContent() : null)).not.toBe(before)
    await settle(page)
    widths[label] = await page.evaluate(() => {
      const scroller = document.querySelector('[data-slot="settings-scroller"]')
      if (!scroller) return 'no settings scroller'
      for (const el of scroller.querySelectorAll('*')) {
        if (getComputedStyle(el).maxWidth === 'none') continue
        if (el.getBoundingClientRect().width < 300) continue
        return `${Math.round(el.getBoundingClientRect().width)}px`
      }
      return 'uncapped'
    })
  }

  const off = Object.entries(widths).filter(([, width]) => width !== '532px')
  expect(off, JSON.stringify(widths, null, 2)).toEqual([])
})
