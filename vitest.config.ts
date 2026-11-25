import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      // Limit concurrent jsdom environments on shared development machines.
      // Button's eager animation mounting is fixed upstream (#566); its separate
      // mount regression test guards that mechanism without timing assertions.
      maxWorkers: '50%',
    },
  }),
)
