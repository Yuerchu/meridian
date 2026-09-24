import { defineConfig, mergeConfig } from 'vite'
import baseConfig from '../vite.config.ts'

/**
 * The app's own Vite config, with the dependency optimiser told about every
 * source file up front.
 *
 * By default it crawls from index.html and discovers the rest — the lazily
 * loaded settings chunk, charts, the plan editor — on first request, then
 * *reloads the page* to swap in the re-optimised bundle. For a person that is a
 * blink; for a screenshot test it is a navigation in the middle of the test.
 * Crawling everything before the first request makes the reload not happen.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    // Its own optimiser cache: a different `entries` is a different hash, and
    // sharing `node_modules/.vite` would have this server and a `pnpm dev`
    // running beside it re-optimise over each other.
    cacheDir: 'node_modules/.vite-e2e',
    optimizeDeps: {
      entries: ['index.html', 'src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/test/**'],
    },
    // No live reload either: an edit saved while the suite runs would reload
    // whichever page was being arranged. The run photographs the tree as it
    // was when each page loaded.
    server: { hmr: false },
  }),
)
