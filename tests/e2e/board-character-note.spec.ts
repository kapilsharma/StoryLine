import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The character note on the board (Issue 41). Run `npm run build` first.
 *
 * Here rather than in jsdom because the thing worth proving is the round trip:
 * a note written on the Characters tab has to reach the board's row header as
 * the `hasNote` flag, through the file on disk and a snapshot reload.
 *
 * The fixture has no timeline units — and a board with no columns draws no rows
 * at all — so one chapter is seeded before the app opens.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

const NOTE = 'Keeps the ledger, and the grudge.'

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-board-note-e2e-')), 'ashvale-family')
  await fs.cp(join(__dirname, '../fixtures/ashvale-family'), projectDir, { recursive: true })
  await fs.writeFile(
    join(projectDir, 'boards', 'family', 'timeline', 'ch1.md'),
    '---\nid: ch1\nlabel: Chapter 1\norder: 1\n---\n\n'
  )

  const env: Record<string, string> = { ...process.env } as Record<string, string>
  // Clear or Electron starts as plain Node (a quirk of some dev shells).
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: [join(__dirname, '../../out/main/index.js')], env })

  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, projectDir)

  window = await app.firstWindow()
  await window.setViewportSize({ width: 1400, height: 900 })
  await window.getByText('Open project…').click()
  await expect(window.locator('.project-title')).toHaveText(/Ashvale Family/)
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('marks no row before a note is written', async () => {
  await expect(window.locator('.row-head').filter({ hasText: 'Tessa Ashvale' })).toBeVisible()
  // Every fixture character carries only the old skeleton, which is not a note.
  await expect(window.locator('.row-note')).toHaveCount(0)
})

test('marks the row once the character has a note', async () => {
  await window.getByRole('button', { name: 'Characters' }).click()
  await window.getByRole('button', { name: /Tessa Ashvale/ }).click()
  await window.getByRole('button', { name: 'Add note' }).click()
  await window.locator('.character-notes-textarea').fill(NOTE)
  await window.getByRole('button', { name: 'Done' }).click()

  await window.getByRole('button', { name: 'Boards' }).click()
  await expect(window.locator('.row-note')).toHaveCount(1)
  await expect(window.locator('.row-note')).toContainText('Tessa Ashvale')
})

test('shows the note in a read-only popup, and Edit goes to the character', async () => {
  await window.locator('.row-note').click()
  await expect(window.locator('.note-popup')).toContainText(NOTE)
  await expect(window.locator('.note-popup h2')).toContainText('Tessa Ashvale')
  await expect(window.locator('.character-notes-textarea')).toHaveCount(0)

  await window.locator('.note-popup').getByRole('button', { name: 'Edit' }).click()
  await expect(window.locator('.note-popup')).toHaveCount(0)
  await expect(window.locator('.tab.active')).toHaveText('Characters')
  await expect(window.locator('.character-notes-body')).toContainText(NOTE)
})
