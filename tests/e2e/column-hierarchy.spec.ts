import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The column hierarchy (issue #104), in the real app. Run `npm run build` first.
 *
 * It starts from a **schema-v3 project** — columns grouped by a `group` string —
 * so opening it is also the migration running for real. After that it is the
 * things jsdom cannot judge: header rows that actually stack, a note written in
 * the real editor surviving a rename on disk, and an HTML5 drag between rows.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true).catch(() => false)
const read = (rel: string): Promise<string> => fs.readFile(join(projectDir, rel), 'utf8')

async function scaffold(dir: string): Promise<void> {
  const write = async (path: string, body: string): Promise<void> => {
    await fs.mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }
  await write(
    'project.json',
    JSON.stringify({
      schemaVersion: 3,
      name: 'Grouped',
      timelineLabel: 'Chapter',
      boards: ['main'],
      created: '2026-08-17',
      lastOpened: '2026-08-17',
      families: {}
    })
  )
  await write(
    'boards/main/board.json',
    JSON.stringify({
      id: 'main',
      name: 'Main',
      cards: [{ id: 'c1', noteUid: 'n_0001', rowId: 'ana', colStart: 'ch1', colEnd: 'ch3' }],
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
  const unit = (id: string, label: string, order: number, group?: string): string =>
    `---\nid: ${id}\nlabel: ${label}\norder: ${order}\n${group ? `group: ${group}\n` : ''}---\n`
  await write('boards/main/timeline/ch1.md', unit('ch1', 'Chapter 1', 1, 'Act 1'))
  await write('boards/main/timeline/ch2.md', unit('ch2', 'Chapter 2', 2, 'Act 1'))
  await write('boards/main/timeline/ch3.md', unit('ch3', 'Chapter 3', 3, 'Act 2'))
  await write('boards/main/timeline/ch4.md', unit('ch4', 'Chapter 4', 4))
  await write('boards/main/notes/opening.md', `---\nuid: n_0001\ntitle: Opening\nboards:\n  - main\n---\nShe arrives.\n`)
}

/**
 * A note opens as a popup or in the side panel depending on the reader's setting
 * (#83), which the app reads from the real user config — so the spec accepts either.
 */
const openNote = () => window.locator('.note-popup, .note-panel')

const groupHead = (label: string) => window.locator('.col-group-head', { hasText: label })
const treeRow = (label: string) => window.locator('.tl-row', { hasText: label })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-columns-e2e-')), 'grouped')
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
  await expect(window.locator('.project-title')).toHaveText('Grouped')
  await expect(window.locator('.board-card').first()).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test.describe('opening a v3 project', () => {
  test('migrates it: groups become files, the project is stamped v4, a backup is kept', async () => {
    expect(await exists(join(projectDir, 'boards/main/colgroups/act-1.md'))).toBe(true)
    expect(await exists(join(projectDir, 'boards/main/colgroups/act-2.md'))).toBe(true)
    expect(await exists(join(projectDir, '.zn-story-line-backup-v3'))).toBe(true)
    expect(JSON.parse(await read('project.json')).schemaVersion).toBe(4)
    expect(await read('boards/main/timeline/ch1.md')).toMatch(/^parent: act-1$/m)
    expect(await read('boards/main/timeline/ch1.md')).not.toMatch(/^group:/m)
  })

  test('draws the same board: a header over each group’s columns, in the old order', async () => {
    await expect(window.locator('.col-group-head')).toHaveCount(2)
    const labels = await window.locator('.col-head:not(.collapsed)').allTextContents()
    expect(labels.map((l) => l.trim())).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4'])
  })

  test('a group header spans exactly its columns', async () => {
    const act1 = (await groupHead('Act 1').boundingBox())!
    const ch1 = (await window.locator('.col-head', { hasText: 'Chapter 1' }).boundingBox())!
    const ch2 = (await window.locator('.col-head', { hasText: 'Chapter 2' }).boundingBox())!
    expect(Math.abs(act1.x - ch1.x)).toBeLessThan(2)
    expect(Math.abs(act1.x + act1.width - (ch2.x + ch2.width))).toBeLessThan(2)
  })

  test('the group row sits above the column labels without overlapping them', async () => {
    const group = (await groupHead('Act 1').boundingBox())!
    const col = (await window.locator('.col-head', { hasText: 'Chapter 1' }).boundingBox())!
    expect(group.y + group.height).toBeLessThanOrEqual(col.y + 1)
  })

  test('a card spanning columns in different groups still spans them', async () => {
    const card = (await window.locator('.board-card').first().boundingBox())!
    const ch1 = (await window.locator('.col-head', { hasText: 'Chapter 1' }).boundingBox())!
    const ch3 = (await window.locator('.col-head', { hasText: 'Chapter 3' }).boundingBox())!
    expect(card.width).toBeGreaterThan(ch3.x + ch3.width - ch1.x - 20)
  })
})

test.describe('a group’s note', () => {
  test('is written from the board and saved against the group', async () => {
    await groupHead('Act 1').locator('.col-group-label').click()
    // "Edit" in the popup, "⤢ Editor" in the panel — both lead to the fullscreen editor.
    await openNote().getByRole('button', { name: /Edit/ }).click()
    await window.locator('.editor-textarea').fill('Act one: the fault appears.')
    // Autosave is debounced; wait for the file rather than sleeping.
    await expect.poll(() => read('boards/main/colgroups/act-1.md'), { timeout: 5000 }).toContain(
      'Act one: the fault appears.'
    )
    await window.getByRole('button', { name: '‹ Close' }).click()
  })

  test('then shows a 📝 on its header and reads back from it', async () => {
    await expect(groupHead('Act 1')).toContainText('📝')
    await expect(groupHead('Act 2')).not.toContainText('📝')

    await groupHead('Act 1').locator('.col-group-label').click()
    await expect(openNote()).toContainText('Act one: the fault appears.')
    await window.keyboard.press('Escape')
  })

  test('survives renaming the group — the point of making it an entity', async () => {
    await window.getByRole('button', { name: 'Chapters' }).click()
    await treeRow('Act 1').locator('.entity-row').click()
    await window.getByLabel('Name').fill('The Gathering')
    await window.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => read('boards/main/colgroups/act-1.md')).toContain('label: The Gathering')
    // Same file, same note, no stray copy.
    expect(await fs.readdir(join(projectDir, 'boards/main/colgroups'))).toEqual(['act-1.md', 'act-2.md'])
    expect(await read('boards/main/colgroups/act-1.md')).toContain('Act one: the fault appears.')

    await window.getByRole('button', { name: 'Boards' }).click()
    await expect(groupHead('The Gathering')).toContainText('📝')
  })
})

test.describe('the Timeline tab', () => {
  test.beforeEach(async () => {
    await window.getByRole('button', { name: 'Chapters' }).click()
  })

  test('lists the tree: groups with their columns beneath, loose columns after', async () => {
    const labels = await window.locator('.tl-row .tl-label').allTextContents()
    expect(labels).toEqual(['The Gathering', 'Chapter 1', 'Chapter 2', 'Act 2', 'Chapter 3', 'Chapter 4'])
  })

  test('dragging a column onto a group moves it inside', async () => {
    await treeRow('Chapter 4').dragTo(treeRow('Act 2'))
    await expect.poll(() => read('boards/main/timeline/ch4.md')).toMatch(/^parent: act-2$/m)
    // And it is drawn there: Act 2 now spans two columns.
    await window.getByRole('button', { name: 'Boards' }).click()
    const act2 = (await groupHead('Act 2').boundingBox())!
    const ch3 = (await window.locator('.col-head', { hasText: 'Chapter 3' }).boundingBox())!
    expect(act2.width).toBeGreaterThan(ch3.width * 1.8)
  })

  test('deleting a group warns, lists what goes, and only deletes once confirmed', async () => {
    await treeRow('The Gathering').locator('.entity-row').click()
    await window.getByRole('button', { name: 'Delete' }).click()

    const list = window.getByRole('list', { name: 'Everything that will be deleted' })
    await expect(list.getByRole('listitem')).toHaveText([/The Gathering/, /Chapter 1/, /Chapter 2/])
    await expect(window.locator('.modal')).toContainText('2 columns')
    await expect(window.locator('.modal')).toContainText('note')

    // Cancelling changes nothing.
    await window.getByRole('button', { name: 'Cancel' }).click()
    expect(await exists(join(projectDir, 'boards/main/colgroups/act-1.md'))).toBe(true)

    await window.getByRole('button', { name: 'Delete' }).click()
    await window.getByRole('button', { name: 'Delete everything' }).click()
    await expect.poll(() => exists(join(projectDir, 'boards/main/colgroups/act-1.md'))).toBe(false)
    // The handler removes files one after another, so wait for each rather than racing it.
    await expect.poll(() => exists(join(projectDir, 'boards/main/timeline/ch1.md'))).toBe(false)
    await expect.poll(() => exists(join(projectDir, 'boards/main/timeline/ch2.md'))).toBe(false)
    expect(await exists(join(projectDir, 'boards/main/timeline/ch3.md'))).toBe(true)
    // The card that spanned ch1–ch3 pointed at a deleted column, so it went with it.
    // (The board file is rewritten after the files go, so wait for it.)
    await expect
      .poll(async () => JSON.parse(await read('boards/main/board.json')).cards)
      .toEqual([])
  })
})
