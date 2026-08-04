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
        'src/main/index.ts',
        'src/preload/**',
        'src/renderer/src/main.tsx'
      ]
    }
  }
})
