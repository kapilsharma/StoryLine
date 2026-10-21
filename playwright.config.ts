import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests drive the real Electron app (see Requirements/testing.md,
 * Layer 3). `npm run test:e2e` builds the app first; the specs launch the built
 * main bundle via `tests/e2e/launch-app.ts`. Calling `playwright test` directly
 * skips the build and runs against whatever is already in `out/`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list'
})
