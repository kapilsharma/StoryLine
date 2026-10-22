import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchApp, openProject } from './launch-app'

/**
 * The app menu (Issue #168) in the real app. Playwright can't click a native
 * menu, so items are clicked through Electron's own `MenuItem.click()` — the
 * same path a mouse click takes once the menu is open. What matters here, and
 * can't be shown in jsdom, is that the menu really is ours, that it follows the
 * window's state, and that a click reaches the window and acts.
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
      name: 'Menus',
      timelineLabel: 'Chapter',
      boards: ['main'],
      created: '2026-10-22',
      lastOpened: '2026-10-22',
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
  await write('boards/main/notes/opening.md', `---\nuid: n_0001\ntitle: Opening\nboards:\n  - main\n---\nShe arrives.\n`)
}

/** The live state of one menu item, read from Electron. */
const menuItem = (id: string): Promise<{ label: string; enabled: boolean; checked: boolean } | null> =>
  app.evaluate(({ Menu }, itemId) => {
    const it = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    return it ? { label: it.label, enabled: it.enabled, checked: it.checked } : null
  }, id)

const clickMenu = (id: string): Promise<void> =>
  app.evaluate(({ Menu, BrowserWindow }, itemId) => {
    const it = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!it) throw new Error(`no menu item ${itemId}`)
    it.click(undefined, BrowserWindow.getAllWindows()[0], undefined)
  }, id)

/** The saved board — null while the app is part-way through writing it, so a poll retries. */
const boardFile = async (): Promise<{ zoom: number } | null> => {
  try {
    return JSON.parse(await fs.readFile(join(projectDir, 'boards/main/board.json'), 'utf8'))
  } catch {
    return null
  }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-menu-e2e-')), 'menus')
  await scaffold(projectDir)
  app = await launchApp()
  window = await openProject(app, projectDir)
  await expect(window.locator('.project-title')).toHaveText('Menus')
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('replaces the default menu with the app’s own', async () => {
  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((i) => i.label))
  expect(labels).toEqual(expect.arrayContaining(['File', 'View', 'Board', 'Go', 'Help']))
  expect(await menuItem('help.issues')).toMatchObject({ label: 'Report an Issue', enabled: true })
})

test('follows the window: project items come alive once a project is open', async () => {
  await expect.poll(async () => (await menuItem('file.close'))?.enabled).toBe(true)
  await expect.poll(async () => (await menuItem('view.toggleCards'))?.enabled).toBe(true)
  // This board has no plot rows and the project no Manuscript row.
  expect((await menuItem('view.plotRows'))?.enabled).toBe(false)
  expect((await menuItem('view.manuscript'))?.enabled).toBe(false)
})

test('View › Filters opens the filter bar and is checked while it is open', async () => {
  await clickMenu('view.filters')
  await expect(window.locator('.board-filter-bar')).toBeVisible()
  await expect.poll(async () => (await menuItem('view.filters'))?.checked).toBe(true)
  await clickMenu('view.filters')
  await expect(window.locator('.board-filter-bar')).toHaveCount(0)
})

test('View › Zoom In zooms the board and saves it', async () => {
  await clickMenu('view.zoomIn')
  await expect.poll(async () => (await boardFile())?.zoom).toBe(1.1)
  await clickMenu('view.zoomReset')
  await expect.poll(async () => (await boardFile())?.zoom).toBe(1)
})

test('Board › Revision Mode masks the cards', async () => {
  await clickMenu('board.revision')
  await expect(window.locator('.card-masked')).toHaveCount(1)
  await expect.poll(async () => (await menuItem('board.revealAll'))?.enabled).toBe(true)
  await clickMenu('board.revision')
  await expect(window.locator('.card-masked')).toHaveCount(0)
})

test('Go switches tabs, and the board items grey out off the Boards tab', async () => {
  await clickMenu('go.notes')
  await expect(window.locator('.tab.active')).toHaveText('Notes')
  await expect.poll(async () => (await menuItem('board.rename'))?.enabled).toBe(false)
  await clickMenu('go.boards')
  await expect(window.locator('.tab.active')).toHaveText('Boards')
  await expect.poll(async () => (await menuItem('board.rename'))?.enabled).toBe(true)
})
