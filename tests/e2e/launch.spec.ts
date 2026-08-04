import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'path'

/**
 * Layer 3 smoke test: launch the built Electron app and confirm the dashboard
 * renders. Run `npm run build` first.
 *
 * Note: ELECTRON_RUN_AS_NODE must be cleared or Electron starts as plain Node
 * (a quirk of some dev shells). Deeper flows (create/open project) need the
 * native folder dialog stubbed, so they're intentionally left out for now.
 */
let app: ElectronApplication

test.beforeAll(async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    args: [join(__dirname, '../../out/main/index.js')],
    env
  })
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
