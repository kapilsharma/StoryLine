import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests drive the real Electron app (see Requirements/testing.md,
 * Layer 3). Build the app first (`npm run build`); the specs launch the built
 * main bundle via Playwright's `_electron`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list'
})
