import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchApp, openProject } from './launch-app'

/**
 * Live reload through the in-memory project index (#184): files changed outside
 * the app reach the board through the native recursive watcher (#190), the index
 * and a patch reply (#188), and the app's own edits keep working alongside them.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

const notePath = (id: string): string => join(projectDir, 'boards', 'main', 'notes', `${id}.md`)
const note = (uid: string, title: string, body = 'What happens.'): string =>
  `---\nuid: ${uid}\ntitle: ${title}\nboards:\n  - main\n---\n${body}\n`
const card = (title: string) => window.locator('.board-card', { hasText: title })

async function scaffold(dir: string): Promise<void> {
  const write = async (path: string, body: string): Promise<void> => {
    await fs.mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }
  await write(
    'project.json',
    JSON.stringify({
      schemaVersion: 4,
      name: 'Live',
      timelineLabel: 'Chapter',
      boards: ['main'],
      created: '2026-10-20',
      lastOpened: '2026-10-20',
      families: {}
    })
  )
  const board = (id: string, name: string, cards: unknown[]) =>
    JSON.stringify({
      id,
      name,
      cards,
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      members: ['ana'],
      rowOrder: ['ana'],
      rowGroupOrder: [],
      colOrder: [],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1,
      views: []
    })
  await write('boards/main/board.json', board('main', 'Main', [{ id: 'k1', noteUid: 'n_0001', rowId: 'ana', colStart: 'ch1', colEnd: 'ch1' }]))
  await write('boards/main/characters/ana.md', `---\nid: ana\ntype: character\nname: Ana\ncolour: '#2E86C1'\n---\n`)
  await write('boards/main/timeline/ch1.md', `---\nid: ch1\nlabel: Chapter 1\norder: 1\n---\n`)
  await write('boards/main/notes/opening.md', note('n_0001', 'Opening'))
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-live-e2e-')), 'live')
  await scaffold(projectDir)
  app = await launchApp()
  window = await openProject(app, projectDir)
  await expect(card('Opening')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('a note retitled outside the app shows on its card', async () => {
  await fs.writeFile(notePath('opening'), note('n_0001', 'Dawn Arrival'))
  await expect(card('Dawn Arrival')).toBeVisible({ timeout: 10_000 })
})

test('an in-app edit then saves over it, and a later outside edit still lands', async () => {
  await window.getByRole('button', { name: 'Settings' }).click()
  await window.getByLabel('Note opened from a board').selectOption({ label: 'Panel beside the board' })
  await window.getByRole('button', { name: 'Boards' }).click()

  await card('Dawn Arrival').click()
  await window.locator('.live-md-block', { hasText: 'What happens.' }).click()
  const source = window.locator('.live-md-source')
  await source.press('End')
  await source.pressSequentially(' She is late.')
  await source.press('Escape')
  await expect.poll(() => fs.readFile(notePath('opening'), 'utf8'), { timeout: 10_000 }).toContain('She is late.')
  await window.keyboard.press('Escape') // close the panel

  await fs.writeFile(notePath('opening'), note('n_0001', 'Dawn, Revised', 'Rewritten elsewhere.'))
  await expect(card('Dawn, Revised')).toBeVisible({ timeout: 10_000 })
})

test('a board folder added outside the app appears as a board', async () => {
  const dir = join(projectDir, 'boards', 'second')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'board.json'),
    JSON.stringify({ id: 'second', name: 'Second', cards: [], hiddenRows: [], hiddenCols: [], presets: [], members: [], rowOrder: [], rowGroupOrder: [], colOrder: [], collapsedRowGroups: [], collapsedColGroups: [], zoom: 1, views: [] })
  )
  await expect(window.locator('.board-tab', { hasText: 'Second' })).toBeVisible({ timeout: 10_000 })
})
