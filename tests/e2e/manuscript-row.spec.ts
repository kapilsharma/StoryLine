import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchApp, openProject } from './launch-app'

/**
 * The Manuscript row (Issue #204) in the real app: it is drawn above the
 * characters with a cell per chapter, an empty cell opens a new chapter straight
 * into the fullscreen editor, and what is typed there lands in
 * `manuscript-<chapter>.md` and comes back to the board as a card spanning the
 * chapter's scenes.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

async function scaffold(dir: string): Promise<void> {
  const write = async (path: string, body: string): Promise<void> => {
    await fs.mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }
  await write(
    'project.json',
    JSON.stringify({
      schemaVersion: 4,
      name: 'Writing',
      timelineLabel: 'Scene',
      timelineLevelLabels: ['Chapter', 'Scene'],
      manuscriptLevel: 0,
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
      cards: [],
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
  await write('boards/main/colgroups/ch-1.md', `---\nid: ch-1\ntype: colgroup\nlabel: Chapter 1\norder: 1\n---\n`)
  await write('boards/main/colgroups/ch-2.md', `---\nid: ch-2\ntype: colgroup\nlabel: Chapter 2\norder: 2\n---\n`)
  await write('boards/main/timeline/s1.md', `---\nid: s1\nlabel: Arrival\norder: 1\nparent: ch-1\n---\n`)
  await write('boards/main/timeline/s2.md', `---\nid: s2\nlabel: The storm\norder: 2\nparent: ch-1\n---\n`)
  await write('boards/main/timeline/s3.md', `---\nid: s3\nlabel: Morning\norder: 1\nparent: ch-2\n---\n`)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-manuscript-e2e-')), 'writing')
  await scaffold(projectDir)
  app = await launchApp()
  window = await openProject(app, projectDir)
  await expect(window.locator('.project-title')).toHaveText('Writing')
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('draws the Manuscript row above the characters, one cell per chapter', async () => {
  const heads = window.locator('.row-head')
  await expect(heads.first()).toContainText('Manuscript')
  await expect(heads.nth(1)).toContainText('Ana')

  // Chapter 1's cell covers both its scenes' columns.
  const cell = (await window.locator('.manuscript-cell[data-cell="node:ch-1"]').boundingBox())!
  const arrival = (await window.locator('.col-head', { hasText: 'Arrival' }).boundingBox())!
  const storm = (await window.locator('.col-head', { hasText: 'The storm' }).boundingBox())!
  expect(Math.abs(cell.x - arrival.x)).toBeLessThan(2)
  expect(Math.abs(cell.x + cell.width - (storm.x + storm.width))).toBeLessThan(2)
})

test('an empty cell opens a new chapter in the fullscreen editor, saved as manuscript-…', async () => {
  await window.locator('.manuscript-cell[data-cell="node:ch-1"]').click()
  const textarea = window.locator('.editor-textarea')
  await expect(textarea).toBeVisible()
  await expect(window.locator('.editor-title-input')).toHaveValue('Chapter 1')

  await textarea.fill('The rain came in sideways off the harbour.')
  const file = join(projectDir, 'boards/main/notes/manuscript-chapter-1.md')
  await expect
    .poll(() => fs.readFile(file, 'utf8').catch(() => ''), { timeout: 5000 })
    .toContain('The rain came in sideways')

  // Back on the board the chapter is a card across its scenes, fixed in place.
  await window.getByRole('button', { name: '‹ Close' }).click()
  const card = window.locator('.board-card.manuscript-card', { hasText: 'Chapter 1' })
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('draggable', 'false')
  const box = (await card.boundingBox())!
  const storm = (await window.locator('.col-head', { hasText: 'The storm' }).boundingBox())!
  expect(box.x + box.width).toBeGreaterThan(storm.x)
  await expect(window.locator('.manuscript-cell[data-cell="node:ch-1"]')).toHaveCount(0)
})

test('📖 hides the row on this board and brings it back', async () => {
  await window.getByTitle('Hide the Manuscript row').click()
  await expect(window.locator('.manuscript-head')).toHaveCount(0)
  await expect.poll(async () => JSON.parse(await fs.readFile(join(projectDir, 'boards/main/board.json'), 'utf8')).hideManuscriptRow).toBe(true)
  await window.getByTitle('Show the Manuscript row').click()
  await expect(window.locator('.manuscript-head')).toHaveCount(1)
})
