import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

export type Theme = 'light' | 'dark'
export const THEMES: readonly Theme[] = ['light', 'dark']

/**
 * The instant every scene is photographed at. The demo fixtures are built
 * relative to `Date.now()` ("2 minutes ago", "yesterday"), so freezing the
 * clock is what makes the sidebar's times, the transcript's timestamps and the
 * date separators the same on every run — no change to the fixtures needed.
 */
export const FROZEN_NOW = new Date('2026-09-24T10:30:00+08:00')

// Applied from the first paint, not only while the screenshot is taken
// (`stylePath` does that part), so a transition never leaves a state half-way.
const FREEZE_CSS = readFileSync(new URL('./screenshot.css', import.meta.url), 'utf8')

interface OpenOptions {
  theme: Theme
  /** `?demo=quiet`: nothing waiting on an answer, so no approval toasts. */
  quiet?: boolean
}

export async function openApp(page: Page, { theme, quiet = true }: OpenOptions): Promise<void> {
  await page.clock.setFixedTime(FROZEN_NOW)
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.addInitScript(
    ([t, css]) => {
      // The key `lib/theme.tsx` and the pre-paint script in index.html read.
      window.localStorage.setItem('meridian-theme', t)
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.dataset.visualFreeze = ''
        style.textContent = css
        document.head.append(style)
      })
    },
    [theme, FREEZE_CSS] as const,
  )
  await page.goto(quiet ? '/?demo=quiet' : '/')
  await expect(page.getByText('演示数据')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
  await settle(page)
}

/** Fonts loaded and no pending frame — the page is what it is going to be. */
export async function settle(page: Page): Promise<void> {
  // A skeleton is `aria-busy` until its data lands (UI Conventions).
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  // Vendor and model logos are `React.lazy` over @lobehub/icons and draw an
  // empty placeholder until the chunk arrives. Photographed before it did,
  // the same scene came out with logos on one run and blanks on the next —
  // Windows and Linux disagreed on settings-providers for exactly that.
  await expect(
    page.locator('[data-slot="provider-icon-placeholder"], [data-slot="model-icon-placeholder"]'),
  ).toHaveCount(0)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

function isNarrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 768
}

/** Below 768px the sidebar is a sheet behind the toggle. */
async function revealSidebar(page: Page): Promise<void> {
  if (!isNarrow(page)) return
  await page.getByRole('button', { name: '切换侧边栏' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

export async function openConversation(page: Page, title: string): Promise<void> {
  await revealSidebar(page)
  await page.getByRole('row', { name: title, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('log')).toBeVisible()
  await settle(page)
}

export async function openSettings(page: Page, section?: string, heading = section): Promise<void> {
  await revealSidebar(page)
  await page.getByRole('row', { name: '设置', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
  if (section) {
    await revealSidebar(page)
    await page.getByRole('row', { name: section, exact: true }).click()
    // The settings pages are a lazily loaded chunk behind a Suspense with no
    // placeholder, so an empty pane is a stable frame too: wait for the page.
    await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible()
  }
  await settle(page)
}

/**
 * The transcript opens at its live edge. Earlier turns are boxes until they
 * come near (`LazyTurn`), so after jumping to the top this waits for them to
 * be drawn and for the scroller to stop compensating.
 */
export async function scrollTranscriptToTop(page: Page): Promise<void> {
  const viewport = page.locator('main [data-slot="message-scroller-viewport"]')
  for (let i = 0; i < 5; i++) {
    await viewport.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }))
    await settle(page)
    if ((await viewport.evaluate((el) => el.scrollTop)) === 0) break
  }
  await settle(page)
}

/** A click leaves the pointer over whatever was clicked, and its hover state
 *  would be photographed. The top-right gutter is outside every panel. */
export async function parkPointer(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1280
  await page.mouse.move(width - 1, 0)
}
