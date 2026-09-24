import { defineConfig, devices } from '@playwright/test'

/**
 * Visual regression over the dev demo backend (`src/dev/demo/`).
 *
 * What this guards is what tsc, eslint and vitest cannot see: a button that
 * turned the accent colour, a field that vanished into its card, spacing that
 * drifted. Every screenshot is taken against fixtures, with the clock, timezone,
 * locale, pixel ratio and motion pinned, so a diff means the pixels moved.
 *
 * Baselines are per platform (`e2e/__screenshots__/<platform>/`): font
 * rasterisation differs between Windows and Linux far beyond any sane
 * tolerance, so each platform is compared only against itself. CI runs Linux.
 */
const PORT = 5179
const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  // One file per platform directory rather than Playwright's default
  // `<spec>-snapshots/<name>-<project>-<platform>.png`, so a platform's
  // baselines can be regenerated (or deleted) as one directory.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
  outputDir: './test-results',
  fullyParallel: true,
  // A cold Vite compiles the app on the first request of each worker.
  timeout: 60_000,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 4,
  reporter: isCI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  expect: {
    toHaveScreenshot: {
      // Anti-aliasing noise on text edges stays well under this; a colour or
      // spacing change on any real component is far above it.
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      stylePath: './e2e/screenshot.css',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
    {
      // A phone-width layout only for the scenes tagged @narrow: the shell,
      // the transcript and settings are where width changes what is rendered.
      name: 'narrow',
      grep: /@narrow/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    },
  ],
  webServer: {
    // The font script is a no-op when `public/fonts/` is already hash-checked
    // (~0.2s), and fetches from the publishers otherwise; without it the page
    // would render in fallback fonts and every screenshot would be wrong.
    command: `node scripts/fetch-fonts.mjs && pnpm exec vite --config e2e/vite.config.ts --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
})
