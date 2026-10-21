import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchApp, openProject } from './launch-app'

/**
 * Export board to Markdown / PDF (#125), in the real app.
 *
 * The parts a unit test can't reach: the native save dialog (stubbed here, as
 * the folder picker is), the main process writing the file, and the PDF being
 * rendered by Electron's own `printToPDF` in a hidden window.
 */

let app: ElectronApplication
let window: Page
let projectDir: string
let outDir: string

async function scaffold(dir: string): Promise<void> {
  const write = async (path: string, body: string): Promise<void> => {
    await fs.mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }
  await write(
    'project.json',
    JSON.stringify({
      schemaVersion: 4,
      name: 'Exporting',
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
      name: 'The Long Night',
      cards: [
        { id: 'k1', noteUid: 'n_0001', rowId: 'ana', colStart: 'ch1', colEnd: 'ch1' },
        { id: 'k2', noteUid: 'n_0002', rowId: 'arc', colStart: 'ch2', colEnd: 'ch2' }
      ],
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      members: ['ana', 'arc'],
      rowOrder: ['ana', 'arc'],
      rowGroupOrder: ['ana', 'arc'],
      colOrder: [],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1,
      views: []
    })
  )
  await write('boards/main/characters/ana.md', `---\nid: ana\ntype: character\nname: Ana\ncolour: '#2E86C1'\n---\n`)
  await write(
    'boards/main/characters/arc.md',
    `---\nid: arc\ntype: character\nname: The Storm Arc\ncolour: '#8E44AD'\nrowKind: plot\n---\n`
  )
  await write('boards/main/timeline/ch1.md', `---\nid: ch1\nlabel: Chapter 1\norder: 1\n---\nThe lamps go out.\n`)
  await write('boards/main/timeline/ch2.md', `---\nid: ch2\nlabel: Chapter 2\norder: 2\n---\n`)
  await write('boards/main/notes/opening.md', `---\nuid: n_0001\ntitle: Opening\nboards:\n  - main\n---\nAna wakes.\n`)
  await write('boards/main/notes/storm.md', `---\nuid: n_0002\ntitle: Storm hits\nboards:\n  - main\n---\nThe sea wall fails.\n`)
}

/** Point the native save dialog at `file` (or cancel it when null). */
async function saveTo(file: string | null): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () =>
      path ? { canceled: false, filePath: path } : { canceled: true, filePath: '' }) as typeof dialog.showSaveDialog
  }, file)
}

const exportDialog = () => window.locator('.modal', { hasText: 'Export board' })
const openExport = async (): Promise<void> => {
  await window.getByTitle('Export board to a file…').click()
  await expect(exportDialog()).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'zn-export-e2e-'))
  projectDir = join(root, 'exporting')
  outDir = join(root, 'out')
  await fs.mkdir(outDir)
  await scaffold(projectDir)
  app = await launchApp()
  window = await openProject(app, projectDir)
  await expect(window.locator('.project-title')).toHaveText('Exporting')
  await expect(window.locator('.board-card').first()).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('a cancelled save dialog keeps the export dialog open and writes nothing', async () => {
  await saveTo(null)
  await openExport()
  await exportDialog().getByRole('button', { name: 'Export', exact: true }).click()
  await expect(exportDialog()).toBeVisible()
  expect(await fs.readdir(outDir)).toEqual([])
  await exportDialog().getByRole('button', { name: 'Cancel' }).click()
  await expect(exportDialog()).toHaveCount(0)
})

test('exports scenes and plot rows to Markdown on disk', async () => {
  const file = join(outDir, 'night.md')
  await saveTo(file)
  await openExport()
  await exportDialog().getByLabel('Plot rows').check()
  await exportDialog().getByRole('button', { name: 'Export', exact: true }).click()
  await expect(exportDialog()).toHaveCount(0)

  const md = await fs.readFile(file, 'utf8')
  expect(md).toMatch(/^# The Long Night/)
  expect(md).toContain('## Scenes')
  expect(md).toContain('### Chapter 1')
  expect(md).toContain('The lamps go out.')
  expect(md).toContain('## Plot rows')
  expect(md).toContain('### The Storm Arc')
  expect(md).toContain('#### Storm hits — Chapter 2')
  expect(md).toContain('The sea wall fails.')
})

test('outline only leaves the note bodies out', async () => {
  const file = join(outDir, 'outline.md')
  await saveTo(file)
  await openExport()
  await exportDialog().getByLabel('Plot rows').check()
  await exportDialog().getByLabel(/Note bodies/).uncheck()
  await exportDialog().getByRole('button', { name: 'Export', exact: true }).click()
  await expect(exportDialog()).toHaveCount(0)

  const md = await fs.readFile(file, 'utf8')
  expect(md).toContain('### Chapter 1')
  expect(md).toContain('#### Storm hits — Chapter 2')
  expect(md).not.toContain('The lamps go out.')
  expect(md).not.toContain('The sea wall fails.')
})

test('exports a real PDF', async () => {
  const file = join(outDir, 'night.pdf')
  await saveTo(file)
  await openExport()
  await exportDialog().getByLabel('PDF (.pdf)').check()
  await exportDialog().getByRole('button', { name: 'Export', exact: true }).click()
  await expect(exportDialog()).toHaveCount(0, { timeout: 15_000 })

  const pdf = await fs.readFile(file)
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(pdf.length).toBeGreaterThan(1000)
})
