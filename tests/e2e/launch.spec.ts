import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp } from './launch-app'

/**
 * Layer 3 smoke test: launch the built Electron app and confirm the dashboard
 * renders. Deeper flows live in the other specs.
 */
let app: ElectronApplication

test.beforeAll(async () => {
  app = await launchApp()
})

test.afterAll(async () => {
  await app?.close()
})

test('app boots to the dashboard', async () => {
  const window = await app.firstWindow()
  await expect(window.locator('h1')).toHaveText('ZN Story Line')
  await expect(window.getByText('New project')).toBeVisible()
  await expect(window.getByText('Open project…')).toBeVisible()
})

test('shows the recent-projects section', async () => {
  const window = await app.firstWindow()
  await expect(window.getByText('Recent projects')).toBeVisible()
})
