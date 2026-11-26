import { expect, test } from '@playwright/test'
import { openApp, openSettings, settle } from './fixtures'

/**
 * Every settings page declares one of the two settings widths:
 * `--content-settings` (780px) for form/toggle sections or
 * `--content-settings-wide` (1400px) for dashboards, tables and split-pane
 * workspaces. Nothing under the scroller should escape uncapped.
 */
test('every settings page uses a declared settings width', async ({ page }) => {
  await openApp(page, { theme: 'light' })
  await openSettings(page)

  const nav = page.getByRole('navigation', { name: '设置' })
  const labels = (await nav.locator('.ui-nav-item').allInnerTexts())
    .map((text) => text.trim().split('\n')[0])
    .filter((label) => label && label !== '返回应用')
  expect(labels.length).toBeGreaterThan(10)

  // Settings opens on the first section. Clicking the page already shown changes
  // nothing, so the wait below — for the heading to change — would never end;
  // start from the last section so every click in the walk is a real move.
  const unique = [...new Set(labels)]
  const heading = page.getByRole('heading', { level: 2 }).first()
  const start = (await heading.count()) ? await heading.textContent() : null
  await nav.getByRole('button', { name: unique[unique.length - 1], exact: true }).click()
  await expect
    .poll(async () => ((await heading.count()) ? await heading.textContent() : null), { timeout: 30_000 })
    .not.toBe(start)

  const widths: Record<string, string> = {}
  for (const label of unique) {
    const row = nav.getByRole('button', { name: label, exact: true })
    if ((await row.count()) !== 1) continue
    // Every section swaps the one scroller's contents, so measure only once the
    // page's own heading has replaced the previous one — otherwise the first
    // (lazily loaded) page reads as no scroller, and any page could be measured
    // as the one before it.
    const before = (await heading.count()) ? await heading.textContent() : null
    await row.click()
    await expect
      .poll(async () => ((await heading.count()) ? await heading.textContent() : null), { timeout: 30_000 })
      .not.toBe(before)
    await settle(page)
    widths[label] = await page.evaluate(() => {
      const scroller = document.querySelector('[data-slot="settings-scroller"]')
      if (!scroller) return 'no settings scroller'
      for (const el of scroller.querySelectorAll('*')) {
        const maxWidth = getComputedStyle(el).maxWidth
        if (maxWidth === 'none') continue
        if (el.getBoundingClientRect().width < 300) continue
        return maxWidth
      }
      return 'uncapped'
    })
  }

  const allowed = new Set(['780px', '1400px'])
  const off = Object.entries(widths).filter(([, maxWidth]) => !allowed.has(maxWidth))
  expect(off, JSON.stringify(widths, null, 2)).toEqual([])
})
