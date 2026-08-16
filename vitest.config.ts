import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Vitest covers two layers (see Requirements/testing.md):
 *  - unit tests (node env) for the data/logic layer
 *  - component tests (jsdom env) for React components
 * E2E lives separately under Playwright (playwright.config.ts).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Default node env; component tests opt into jsdom via a per-file
    // `// @vitest-environment jsdom` docblock (environmentMatchGlobs was
    // removed in Vitest 4).
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/components/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      // Only our own source; count files with no tests as 0% so gaps show up.
      include: ['src/**/*.{ts,tsx}'],
      all: true,
      // Type-only and app-bootstrap glue that has nothing meaningful to unit-test.
      exclude: [
        'src/**/*.d.ts',
        'src/shared/types.ts',
        'src/shared/ipc.ts',
        'src/shared/assets.ts',
        'src/main/index.ts',
        'src/preload/**',
        'src/renderer/src/main.tsx',
        'src/web/main.tsx'
      ],
      /**
       * A ratchet, not a target.
       *
       * Set just under the numbers the suite actually reaches, so a change that
       * adds untested code fails `npm run test:coverage` instead of quietly
       * lowering the bar. Raise them when coverage rises; do not lower them
       * without saying why.
       *
       * The pure layers are held far higher than the UI: they are plain
       * functions with no excuse for being untested, and they are where a silent
       * regression does the most damage.
       */
      thresholds: {
        statements: 74,
        branches: 66,
        functions: 63,
        lines: 77,
        'src/shared/**': { statements: 95, branches: 90, functions: 100, lines: 95 },
        'src/main/data/**': { statements: 90, branches: 78, functions: 90, lines: 92 },
        'src/renderer/src/lib/**': { statements: 95, branches: 88, functions: 100, lines: 95 }
      }
    }
  }
})
