import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Shared launch for every e2e spec (Issue #169). `npm run test:e2e` builds the
 * app first, so the window under test is always the current UI.
 *
 * Each launch gets its own throwaway userData dir. Without one, every spec read
 * and wrote the developer's real app config: temp projects piled up in their
 * recents, and their own settings (note panel vs popup, preview side, word
 * count) silently changed what the specs saw.
 */
export async function launchApp(): Promise<ElectronApplication> {
  const userData = await fs.mkdtemp(join(tmpdir(), 'zn-e2e-userdata-'))
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  // Clear or Electron starts as plain Node (a quirk of some dev shells).
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    args: [join(__dirname, '../../out/main/index.js'), `--user-data-dir=${userData}`],
    env
  })
  // Removed once the process has exited — on the 'close' event Chromium is
  // still writing its profile and the removal loses the race.
  const close = app.close.bind(app)
  app.close = async () => {
    await close()
    await fs.rm(userData, { recursive: true, force: true }).catch(() => {})
  }
  return app
}

/**
 * Open `projectDir` from the dashboard. The native folder picker can't be driven
 * from Playwright, so it is stubbed to answer with the project.
 */
export async function openProject(
  app: ElectronApplication,
  projectDir: string,
  viewport = { width: 1400, height: 900 }
): Promise<Page> {
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, projectDir)
  const window = await app.firstWindow()
  await window.setViewportSize(viewport)
  await window.getByText('Open project…').click()
  return window
}
