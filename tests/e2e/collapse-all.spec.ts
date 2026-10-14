import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Collapse / expand all groups from the toolbar (issue #164), in the real app.
 * Run `npm run build` first.
 *
 * A three-level project — Novel › Chapter › Scene — so the column items are
 * named from the project's levels ("Collapse Novel", "Collapse Chapter") and
 * the leaf level never gets one. Rows: a Crew group (Ana, Ben) and a loose Cat.
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
      name: 'Levels',
      timelineLabel: 'Scene',
      timelineLevelLabels: ['Novel', 'Chapter', 'Scene'],
      boards: ['main'],
      created: '2026-10-14',
      lastOpened: '2026-10-14',
      families: {}
    })
  )
  await write(
    'boards/main/board.json',
    JSON.stringify({
      id: 'main',
      name: 'Main',
      cards: [{ id: 'k1', noteUid: 'n_0001', rowId: 'ana', colStart: 's1', colEnd: 's1' }],
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      members: ['ana', 'ben', 'cat'],
      rowOrder: ['ana', 'ben', 'cat'],
      rowGroupOrder: ['Crew', 'cat'],
      colOrder: [],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1,
      views: []
    })
  )
  const char = (id: string, name: string, group?: string): string =>
    `---\nid: ${id}\ntype: character\nname: ${name}\ncolour: '#2E86C1'\n${group ? `group: ${group}\n` : ''}---\n`
  await write('boards/main/characters/ana.md', char('ana', 'Ana', 'Crew'))
  await write('boards/main/characters/ben.md', char('ben', 'Ben', 'Crew'))
  await write('boards/main/characters/cat.md', char('cat', 'Cat'))
  const group = (id: string, label: string, order: number, parent?: string): string =>
    `---\nid: ${id}\ntype: colgroup\nlabel: ${label}\n${parent ? `parent: ${parent}\n` : ''}order: ${order}\n---\n`
  await write('boards/main/colgroups/book.md', group('book', 'Book One', 1))
  await write('boards/main/colgroups/ch1.md', group('ch1', 'Chapter 1', 1, 'book'))
  await write('boards/main/colgroups/ch2.md', group('ch2', 'Chapter 2', 2, 'book'))
  const scene = (id: string, label: string, order: number, parent: string): string =>
    `---\nid: ${id}\nlabel: ${label}\norder: ${order}\nparent: ${parent}\n---\n`
  await write('boards/main/timeline/s1.md', scene('s1', 'Scene 1', 1, 'ch1'))
  await write('boards/main/timeline/s2.md', scene('s2', 'Scene 2', 2, 'ch1'))
  await write('boards/main/timeline/s3.md', scene('s3', 'Scene 3', 1, 'ch2'))
  await write('boards/main/notes/opening.md', `---\nuid: n_0001\ntitle: Opening\nboards:\n  - main\n---\n`)
}

const menuBtn = () => window.getByTitle('Collapse or expand all row and column groups')
const item = (name: string) => window.getByRole('menuitem', { name })
const pick = async (name: string): Promise<void> => {
  await menuBtn().click()
  await item(name).click()
  await expect(window.getByRole('menu')).toHaveCount(0)
}
const board = async (): Promise<{ collapsedRowGroups: string[]; collapsedColGroups: string[] }> =>
  JSON.parse(await fs.readFile(join(projectDir, 'boards/main/board.json'), 'utf8'))
const collapsedCols = () => window.locator('.col-head.collapsed')

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-collapse-all-e2e-')), 'levels')
  await scaffold(projectDir)

  const env: Record<string, string> = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: [join(__dirname, '../../out/main/index.js')], env })
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, projectDir)

  window = await app.firstWindow()
  await window.setViewportSize({ width: 1400, height: 900 })
  await window.getByText('Open project…').click()
  await expect(window.locator('.project-title')).toHaveText('Levels')
  await expect(window.locator('.board-card').first()).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('sits just before the expand-all-cards button', async () => {
  const next = menuBtn().locator('xpath=ancestor::div[contains(@class,"toolbar-menu")]/following-sibling::button[1]')
  await expect(next).toHaveAttribute('title', /all cards/)
})

test('names a column item per group level, never the scene level', async () => {
  await menuBtn().click()
  const labels = await window.getByRole('menuitem').allTextContents()
  expect(labels.map((l) => l.trim())).toEqual([
    '⊟ Collapse all rows',
    '⊞ Expand all rows',
    '⊟ Collapse Novel',
    '⊟ Collapse Chapter',
    '⊞ Expand all columns'
  ])
  await window.keyboard.press('Escape')
  await expect(window.getByRole('menu')).toHaveCount(0)
  // An outside click closes it too.
  await menuBtn().click()
  await window.locator('.project-title').click()
  await expect(window.getByRole('menu')).toHaveCount(0)
})

test('collapses and expands every row group, leaving columns alone', async () => {
  await pick('⊟ Collapse all rows')
  await expect(window.locator('.row-head.collapsed')).toHaveCount(1)
  await expect(collapsedCols()).toHaveCount(0)
  await expect.poll(async () => (await board()).collapsedRowGroups).toEqual(['Crew'])
  await pick('⊞ Expand all rows')
  await expect(window.locator('.row-head.collapsed')).toHaveCount(0)
})

test('Collapse Novel folds the board to one column per novel', async () => {
  await pick('⊟ Collapse Novel')
  await expect(collapsedCols()).toHaveCount(1)
  await expect.poll(async () => (await board()).collapsedColGroups).toEqual(['book'])
})

test('Collapse Chapter opens the novel and folds each chapter', async () => {
  await pick('⊟ Collapse Chapter')
  await expect(collapsedCols()).toHaveCount(2)
  await expect(window.locator('.col-group-head', { hasText: 'Book One' })).toBeVisible()
  await expect.poll(async () => (await board()).collapsedColGroups.sort()).toEqual(['ch1', 'ch2'])
  await expect(window.locator('.row-head.collapsed')).toHaveCount(0)
})

test('Expand all columns opens every level', async () => {
  await pick('⊞ Expand all columns')
  await expect(collapsedCols()).toHaveCount(0)
  await expect(window.locator('.col-head', { hasText: 'Scene 3' })).toBeVisible()
})
