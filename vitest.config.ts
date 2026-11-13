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
      // Half the cores, not all but one. Yuerchu UI's Button mounts its label and
      // icon animations up front (Yuerchu/ui#566), which made the heaviest settings
      // files 35% slower; with every core running jsdom they crossed the 5 s test
      // timeout under load while passing alone. Revisit when #566 lands.
      maxWorkers: '50%',
    },
  }),
)
