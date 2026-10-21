import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchApp, openProject } from './launch-app'

/**
 * The fullscreen note editor (Feature 12) with its formatting toolbar (#72),
 * hover text (#111, #116) and word count (#194), in the real app.
 *
 * jsdom can click the toolbar, but not prove what matters to a writer: that the
 * toolbar and the preview are actually laid out on screen, that an edit
 * round-trips through the debounced save to the file on disk, and that hover
 * text written here reaches the card's tip on the board.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

const BODY = 'She arrives at dawn.'

async function scaffold(dir: string): Promise<void> {
  const write = async (path: string, body: string): Promise<void> => {
    await fs.mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }
  await write(
    'project.json',
    JSON.stringify({
      schemaVersion: 4,
      name: 'Editing',
      timelineLabel: 'Chapter',
      boards: ['main'],
      created: '2026-10-21',
      lastOpened: '2026-10-21',
      families: {}
    })
  )
  await write(
    'boards/main/board.json',
    JSON.stringify({
      id: 'main',
      name: 'Main',
      cards: [{ id: 'k1', noteUid: 'n_0001', rowId: 'ana', colStart: 'ch1', colEnd: 'ch1' }],
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      members: ['ana'],
      rowOrder: ['ana'],
      rowGroupOrder: ['ana'],
      colOrder: [],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1,
      views: []
    })
  )
  await write('boards/main/characters/ana.md', `---\nid: ana\ntype: character\nname: Ana\ncolour: '#2E86C1'\n---\n`)
  await write('boards/main/timeline/ch1.md', `---\nid: ch1\nlabel: Chapter 1\norder: 1\n---\n`)
  await write('boards/main/notes/opening.md', `---\nuid: n_0001\ntitle: Opening\nboards:\n  - main\n---\n${BODY}\n`)
}

const noteFile = (): Promise<string> => fs.readFile(join(projectDir, 'boards/main/notes/opening.md'), 'utf8')
const textarea = () => window.locator('.editor-textarea')
const wordCount = () => window.locator('.editor-foot .word-count')
const card = () => window.locator('.board-card', { hasText: 'Opening' })

/** Select `text` inside the editor's textarea, as a mouse drag would. */
async function select(text: string): Promise<void> {
  await textarea().evaluate((el, t) => {
    const ta = el as HTMLTextAreaElement
    const at = ta.value.indexOf(t)
    ta.focus()
    ta.setSelectionRange(at, at + t.length)
  }, text)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-editor-e2e-')), 'editing')
  await scaffold(projectDir)
  app = await launchApp()
  window = await openProject(app, projectDir)
  await expect(window.locator('.project-title')).toHaveText('Editing')

  await card().click()
  await window.locator('.note-popup').getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(textarea()).toHaveValue(/^She arrives at dawn\.\s*$/)
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('lays out the toolbar above the text, beside a live preview', async () => {
  const tools = window.locator('.editor-tools')
  await expect(tools.getByLabel('Heading level')).toBeVisible()
  for (const name of ['Bold', 'Italic', 'Strikethrough', 'Highlight', '+ Image'])
    await expect(tools.getByRole('button', { name, exact: true })).toBeVisible()

  const bar = (await tools.boundingBox())!
  const text = (await textarea().boundingBox())!
  const preview = (await window.locator('.editor-preview').boundingBox())!
  expect(bar.y + bar.height).toBeLessThanOrEqual(text.y + 1)
  // Preview on the left by default, both panes a real size.
  expect(preview.x + preview.width).toBeLessThanOrEqual(text.x + 1)
  expect(text.height).toBeGreaterThan(200)
  expect(preview.width).toBeGreaterThan(200)
  await expect(window.locator('.editor-preview')).toContainText(BODY)
})

test('shows the word count in the footer, and follows typing', async () => {
  await expect(wordCount()).toHaveText('4 words')
  // Pin the trailing newline down, so the typed line starts a line of its own.
  await textarea().fill(`${BODY}\n`)
  await window.keyboard.press('ControlOrMeta+End')
  await window.keyboard.type('Rain follows.')
  await expect(wordCount()).toHaveText('6 words')
})

test('Bold wraps the selection and the debounced save writes it to disk', async () => {
  await select('dawn')
  await window.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(textarea()).toHaveValue(`She arrives at **dawn**.\nRain follows.`)
  await expect(window.locator('.editor-preview strong')).toHaveText('dawn')
  // Toolbar edits keep the caret in the text, so typing carries on in place.
  await expect(textarea()).toBeFocused()

  await expect.poll(noteFile, { timeout: 5000 }).toContain('She arrives at **dawn**.')
  // Frontmatter survives the body write.
  expect(await noteFile()).toContain('title: Opening')
})

test('the heading dropdown turns the caret’s line into a heading', async () => {
  await select('Rain')
  await window.getByLabel('Heading level').selectOption('2')
  await expect(textarea()).toHaveValue(`She arrives at **dawn**.\n## Rain follows.`)
  await expect(window.locator('.editor-preview h2')).toHaveText('Rain follows.')
  await expect.poll(noteFile, { timeout: 5000 }).toContain('## Rain follows.')
})

test('hover text written here reaches the card on the board', async () => {
  await window.getByLabel('Hover text').fill('Remember the rain')
  await expect.poll(noteFile, { timeout: 5000 }).toMatch(/hover: Remember the rain/)

  // Close returns to where the editor was opened from: the note's popup.
  await window.getByRole('button', { name: '‹ Close' }).click()
  await expect(window.locator('.note-popup')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(window.locator('.note-popup')).toHaveCount(0)
  await expect(card().locator('.card-hover-icon')).toHaveCount(1)
  await window.mouse.move(5, 5)
  await card().hover()
  const tip = window.locator('.card-hover-tip')
  await expect(tip).toContainText('Remember the rain')
  // The tip is drawn on screen near its card, not at the origin.
  const tipBox = (await tip.boundingBox())!
  const cardBox = (await card().boundingBox())!
  expect(Math.abs(tipBox.y - (cardBox.y + cardBox.height))).toBeLessThan(cardBox.height + tipBox.height)
})
