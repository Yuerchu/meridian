import { expect, test } from '@playwright/test'
import { settle } from './fixtures'

/**
 * Multi-card approval notifications stack into a collapsible deck, float each
 * card with its own shadow (never an outer box connecting separate cards), and
 * never flash a scrollbar when a card is dismissed on a normal viewport.
 */
test('approval notifications stack into a deck, expand without connecting lines, and dismiss without scrollbars', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => window.localStorage.setItem('meridian-theme', 'dark'))
  await page.goto('/')
  await expect(page.getByText('演示数据')).toBeVisible()
  await settle(page)

  const region = page.getByRole('region', { name: '通知' })
  await expect(region).toBeVisible()
  await expect(region).toHaveAttribute('data-collapsed', 'true')
  await expect(region.getByRole('article')).toHaveCount(1)

  const expand = region.getByRole('button', { name: /^展开其余 \d+ 条$/ })
  await expect(expand).toBeVisible()

  await expand.click()
  await expect(region.getByRole('button', { name: '折叠通知' })).toBeVisible()
  await expect(region).not.toHaveAttribute('data-collapsed')

  const countBefore = await region.getByRole('article').count()
  expect(countBefore).toBeGreaterThanOrEqual(2)

  // Outer container has no box-shadow (no border/lines bridging the gap between cards),
  // and does not enable internal scrolling when cards fit in the viewport.
  const expandedState = await region.evaluate((el) => ({
    containerShadow: getComputedStyle(el).boxShadow,
    overflowY: getComputedStyle(el).overflowY,
    scrollable: el.hasAttribute('data-scrollable'),
  }))
  expect(expandedState.containerShadow).toBe('none')
  expect(expandedState.overflowY).toBe('visible')
  expect(expandedState.scrollable).toBe(false)

  // Dismissing the first card does not spawn a spurious scrollbar.
  const firstCard = region.getByRole('article').first()
  await firstCard.getByRole('button', { name: '忽略' }).click()
  await expect(region.getByRole('article')).toHaveCount(countBefore - 1)

  const afterDismiss = await region.evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    scrollable: el.hasAttribute('data-scrollable'),
  }))
  expect(afterDismiss.overflowY).toBe('visible')
  expect(afterDismiss.scrollable).toBe(false)
})
