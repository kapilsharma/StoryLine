import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The Characters tab's notes column (Issue 33). Run `npm run build` first.
 *
 * Here rather than in jsdom because the two things worth proving are layout and
 * the round-trip to disk: jsdom reports every box as 0×0, so a 15/33/50 split
 * asserted there would pass however the columns actually land.
 *
 * The fixture's characters carry the old empty `## Notes` / `## Research`
 * skeleton, which is exactly the case that must read as "no note yet".
 */

let app: ElectronApplication
let window: Page
let projectDir: string

const charFile = (id: string): string =>
  join(projectDir, 'boards', 'family', 'characters', `${id}.md`)

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-characters-e2e-')), 'ashvale-family')
  await fs.cp(join(__dirname, '../fixtures/ashvale-family'), projectDir, { recursive: true })

  const env = { ...process.env }
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
  await window.getByRole('button', { name: 'Characters' }).click()
  await window.getByRole('button', { name: /Tessa Ashvale/ }).click()
  await expect(window.locator('.character-notes')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('splits the tab into list / properties / notes', async () => {
  const layout = (await window.locator('.editor-layout').boundingBox())!
  const list = (await window.locator('.entity-list').boundingBox())!
  const form = (await window.locator('.entity-form').boundingBox())!
  const notes = (await window.locator('.character-notes').boundingBox())!

  expect(list.width / layout.width).toBeCloseTo(0.15, 2)
  expect(form.width / layout.width).toBeCloseTo(0.33, 2)
  expect(notes.width / layout.width).toBeCloseTo(0.52, 2)
  // Full-height column, not a collapsed strip.
  expect(notes.height).toBeGreaterThan(400)
})

test('offers "Add note" for a character carrying only the old skeleton', async () => {
  await expect(window.getByRole('button', { name: 'Add note' })).toBeVisible()
  await expect(window.getByText('No note for this character yet.')).toBeVisible()
})

test('writes a note from the notes column and takes the skeleton off disk', async () => {
  await window.getByRole('button', { name: 'Add note' }).click()

  const textarea = window.locator('.character-notes-textarea')
  await expect(textarea).toHaveValue('')
  await textarea.fill('Keeps the ledger, and the grudge.')
  await window.getByRole('button', { name: 'Done' }).click()

  // Back to the preview.
  await expect(window.locator('.character-notes-body')).toContainText('Keeps the ledger')
  await expect(window.getByRole('button', { name: 'Edit note' })).toBeVisible()

  await expect
    .poll(async () => await fs.readFile(charFile('tessa-ashvale'), 'utf8'), { timeout: 5000 })
    .toContain('Keeps the ledger, and the grudge.')

  const raw = await fs.readFile(charFile('tessa-ashvale'), 'utf8')
  expect(raw).not.toContain('## Research')
  // Frontmatter survives the body write.
  expect(raw).toContain('name: Tessa Ashvale')
})

test('reopens the saved note as a preview, not an empty column', async () => {
  await window.getByRole('button', { name: /Juno Ashvale/ }).click()
  await expect(window.getByRole('button', { name: 'Add note' })).toBeVisible()

  await window.getByRole('button', { name: /Tessa Ashvale/ }).click()
  await expect(window.locator('.character-notes-body')).toContainText('Keeps the ledger')
})
