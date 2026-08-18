import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The character note on the board (Issue 41), now shown in the side panel and
 * editable in place (Issue #83). Run `npm run build` first.
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

/**
 * Pick a view for notes opened from the board (#83) and come back to the board.
 * Set explicitly rather than trusting the default, because this config is the
 * real one in userData and an earlier run may have left the other value in it.
 */
async function setNoteView(label: 'Popup over the board' | 'Panel beside the board'): Promise<void> {
  await window.getByRole('button', { name: 'Settings' }).click()
  await window.getByLabel('Note opened from a board').selectOption({ label })
  await window.getByRole('button', { name: 'Boards' }).click()
}

test('in popup mode, shows a read-only preview whose Edit goes to the character', async () => {
  await setNoteView('Popup over the board')
  await window.locator('.row-note').click()
  await expect(window.locator('.note-popup')).toContainText(NOTE)
  await expect(window.locator('.note-popup h2')).toContainText('Tessa Ashvale')
  await expect(window.locator('.character-notes-textarea')).toHaveCount(0)

  await window.locator('.note-popup').getByRole('button', { name: 'Edit' }).click()
  await expect(window.locator('.note-popup')).toHaveCount(0)
  await expect(window.locator('.tab.active')).toHaveText('Characters')
  await expect(window.locator('.character-notes-body')).toContainText(NOTE)
})

test('in panel mode, shows the note beside a board that stays visible', async () => {
  await setNoteView('Panel beside the board')
  await window.locator('.row-note').click()
  await expect(window.locator('.note-panel')).toContainText(NOTE)
  await expect(window.locator('.note-panel-title')).toContainText('Tessa Ashvale')
  // A panel, not a modal: the plot is still there next to it (#83).
  await expect(window.locator('.board-grid')).toBeVisible()
  await expect(window.locator('.modal-overlay')).toHaveCount(0)
})

test('edits the note in place and writes it to the character file', async () => {
  // Real geometry, real caret: clicking rendered prose has to open *that* block
  // as source, which is the one thing jsdom cannot prove.
  await window.locator('.live-md-block', { hasText: NOTE }).click()
  const source = window.locator('.live-md-source')
  await expect(source).toHaveValue(NOTE)

  await source.press('End')
  await source.pressSequentially(' Twice over.')
  await source.press('Escape')
  // Rendered again, with the new text in it.
  await expect(window.locator('.live-md-source')).toHaveCount(0)
  await expect(window.locator('.note-panel')).toContainText(`${NOTE} Twice over.`)

  await expect
    .poll(() => fs.readFile(join(projectDir, 'boards', 'family', 'characters', 'tessa-ashvale.md'), 'utf8'))
    .toContain(`${NOTE} Twice over.`)
})

test('the divider resizes the panel, and a double-click resets the split', async () => {
  const panel = window.locator('.note-panel')
  const rail = window.locator('.note-panel-rail')
  const widthOf = async (): Promise<number> => (await panel.boundingBox())!.width
  const half = await widthOf()

  const box = (await rail.boundingBox())!
  await window.mouse.move(box.x + box.width / 2, box.y + 100)
  await window.mouse.down()
  await window.mouse.move(box.x - 200, box.y + 100, { steps: 10 })
  await window.mouse.up()
  await expect.poll(widthOf).toBeGreaterThan(half + 150)

  await rail.dblclick()
  await expect.poll(widthOf).toBeLessThan(half + 10)
})

test('the panel closes on Escape once nothing is being edited', async () => {
  await window.keyboard.press('Escape')
  await expect(window.locator('.note-panel')).toHaveCount(0)
})
