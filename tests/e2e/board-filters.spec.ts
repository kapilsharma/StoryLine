import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchApp, openProject } from './launch-app'

/**
 * The board filter bar (#140) with its card filters (#182), in the real app.
 *
 * The unit tests prove which cards `withCardFilters` keeps; this proves the
 * values come through from the notes' frontmatter and that a filtered-out card
 * leaves the grid while its row and column stay.
 */

let app: ElectronApplication
let window: Page

const NOTES = [
  { uid: 'n_0001', title: 'Idea only', extra: 'status: idea\n', col: 'ch1' },
  { uid: 'n_0002', title: 'Half drafted', extra: 'status: draft\nprogress: 50\n', col: 'ch2' },
  { uid: 'n_0003', title: 'Finished', extra: 'status: done\nprogress: 100\n', col: 'ch3' }
]

async function scaffold(dir: string): Promise<void> {
  const write = async (path: string, body: string): Promise<void> => {
    await fs.mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }
  await write(
    'project.json',
    JSON.stringify({
      schemaVersion: 4,
      name: 'Filtering',
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
      cards: NOTES.map((n, i) => ({ id: `k${i}`, noteUid: n.uid, rowId: 'ana', colStart: n.col, colEnd: n.col })),
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
  for (const [i, col] of ['ch1', 'ch2', 'ch3'].entries()) {
    await write(`boards/main/timeline/${col}.md`, `---\nid: ${col}\nlabel: Chapter ${i + 1}\norder: ${i + 1}\n---\n`)
  }
  for (const n of NOTES) {
    await write(
      `boards/main/notes/${n.uid}.md`,
      `---\nuid: ${n.uid}\ntitle: ${n.title}\n${n.extra}boards:\n  - main\n---\n`
    )
  }
}

const card = (title: string) => window.locator('.board-card', { hasText: title })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const dir = join(await fs.mkdtemp(join(tmpdir(), 'zn-filters-e2e-')), 'filtering')
  await scaffold(dir)
  app = await launchApp()
  window = await openProject(app, dir)
  await expect(window.locator('.project-title')).toHaveText('Filtering')
  for (const n of NOTES) await expect(card(n.title)).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
})

test('the toolbar button is called "Filters" and opens the bar', async () => {
  await window.getByTitle('Filters', { exact: true }).click()
  await expect(window.locator('.board-filter-bar')).toBeVisible()
  await expect(window.getByRole('button', { name: /Status/ })).toBeVisible()
  await expect(window.getByRole('button', { name: /% complete/ })).toBeVisible()
})

test('a Status filter hides only the cards with that status', async () => {
  await window.getByRole('button', { name: /Status/ }).click()
  await window.getByLabel('✅ Draft done').uncheck()
  await expect(card('Finished')).toHaveCount(0)
  await expect(card('Idea only')).toBeVisible()
  await expect(card('Half drafted')).toBeVisible()
  // The column keeps its place: the card goes, not the chapter.
  await expect(window.getByText('Chapter 3', { exact: true })).toBeVisible()
})

test('a % complete filter combines with it, and "Not set" covers untracked cards', async () => {
  // An outside click closes the open Status dropdown.
  await window.locator('.board-filter-bar').getByText('Show:').click()
  await window.getByRole('button', { name: /% complete/ }).click()
  await window.getByLabel('Not set').uncheck()
  await expect(card('Idea only')).toHaveCount(0)
  await expect(card('Half drafted')).toBeVisible()
})

test('"Clear filters" brings every card back', async () => {
  await window.getByRole('button', { name: /Clear filters/ }).click()
  for (const n of NOTES) await expect(card(n.title)).toBeVisible()
})
