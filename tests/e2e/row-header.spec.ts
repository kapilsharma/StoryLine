import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ROW_HEADER_W_DEFAULT, ROW_HEADER_W_MIN } from '@shared/types'

/**
 * Board row headers (issue #80): two lines by default, expandable to the whole
 * name, and a resizable column. Run `npm run build` first.
 *
 * This lives here rather than in jsdom because every assertion is a real
 * measurement. Whether a name overflows two lines is a question about wrapped
 * text at a given column width, and jsdom answers 0×0 to all of it — the
 * component tests have to state the overflow instead of measuring it.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

const VIEWPORT_W = 1400

/** One board, three rows: a short name, one that wraps, one that overflows. */
async function scaffold(dir: string): Promise<void> {
  const write = async (path: string, body: string): Promise<void> => {
    await fs.mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }

  await write(
    'project.json',
    JSON.stringify(
      {
        schemaVersion: 3,
        name: 'Long Names',
        timelineLabel: 'Chapter',
        boards: ['main'],
        created: '2026-08-17',
        lastOpened: '2026-08-17',
        families: {}
      },
      null,
      2
    )
  )
  await write(
    'boards/main/board.json',
    JSON.stringify(
      {
        id: 'main',
        name: 'Main',
        cards: [{ id: 'c1', noteUid: 'n_0001', rowId: 'short', colStart: 'ch1', colEnd: 'ch1' }],
        hiddenRows: [],
        hiddenCols: [],
        presets: [],
        members: ['short', 'wraps', 'overflows'],
        rowOrder: ['short', 'wraps', 'overflows'],
        rowGroupOrder: ['short', 'wraps', 'overflows'],
        colOrder: ['ch1'],
        collapsedRowGroups: [],
        collapsedColGroups: [],
        zoom: 1,
        views: []
      },
      null,
      2
    )
  )
  const char = (id: string, name: string, colour: string): string =>
    `---\nid: ${id}\ntype: character\nname: ${name}\ncolour: '${colour}'\n---\n`
  await write('boards/main/characters/short.md', char('short', 'Ana', '#2E86C1'))
  await write('boards/main/characters/wraps.md', char('wraps', 'Beatrix Wolfensberger', '#E67E22'))
  await write(
    'boards/main/characters/overflows.md',
    char('overflows', 'Lady Margaret Ashworth-Fitzgerald of Blackmoor Hall', '#8E44AD')
  )
  await write('boards/main/timeline/ch1.md', `---\nid: ch1\nlabel: Chapter 1\norder: 1\n---\n`)
  await write(
    'boards/main/notes/opening.md',
    `---\nuid: n_0001\ntitle: Opening\nboards:\n  - main\n---\nShe arrives.\n`
  )
}

/** The header cell for a row, by the name in it. */
const head = (name: string): ReturnType<Page['locator']> =>
  window.locator('.row-head', { hasText: name })

/** The height of one line of header text, taken from a name that cannot wrap. */
async function lineHeight(): Promise<number> {
  const box = await head('Ana').locator('.row-name-text').boundingBox()
  return box!.height
}

/** The header column's width on screen. */
function cornerWidth(): Promise<number> {
  return window.locator('.grid-corner').evaluate((el) => el.getBoundingClientRect().width)
}

/**
 * Drag the corner handle by `dx` px. Like the card resize, letting go hands the
 * width to the store and drops the preview, so the settled width is polled for
 * rather than read straight back.
 */
async function dragHandle(dx: number): Promise<void> {
  const box = await window.locator('.header-resize').boundingBox()
  await window.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await window.mouse.down()
  await window.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2, { steps: 10 })
  await window.mouse.up()
}

/** What the board file on disk now says the width is. */
async function savedWidth(): Promise<number | undefined> {
  const raw = JSON.parse(await fs.readFile(join(projectDir, 'boards/main/board.json'), 'utf8'))
  return raw.rowHeaderWidth
}

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-rowhead-e2e-')), 'long-names')
  await scaffold(projectDir)

  const env: Record<string, string> = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: [join(__dirname, '../../out/main/index.js')], env })
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, projectDir)

  window = await app.firstWindow()
  await window.setViewportSize({ width: VIEWPORT_W, height: 900 })
  await window.getByText('Open project…').click()
  await expect(window.locator('.project-title')).toHaveText('Long Names')
  await expect(window.locator('.board-card').first()).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test.describe('two lines by default', () => {
  test('a name too wide for one line uses the second', async () => {
    const one = await lineHeight()
    const box = await head('Beatrix Wolfensberger').locator('.row-name-text').boundingBox()
    expect(box!.height).toBeGreaterThan(one * 1.5)
    expect(box!.height).toBeLessThan(one * 2.5)
  })

  test('a name too long even for two lines stops at two, whole text intact', async () => {
    const one = await lineHeight()
    const name = head('Lady Margaret').locator('.row-name-text')
    const box = await name.boundingBox()
    expect(box!.height).toBeLessThan(one * 2.5)
    // Clamped for reading, not truncated — the row still holds the whole name.
    expect(await name.textContent()).toBe('Lady Margaret Ashworth-Fitzgerald of Blackmoor Hall')
  })
})

test.describe('the expand button', () => {
  test('appears only on a name that is actually clipped', async () => {
    await expect(head('Lady Margaret').locator('.row-expand')).toHaveCount(1)
    await expect(head('Ana').locator('.row-expand')).toHaveCount(0)
    await expect(head('Beatrix Wolfensberger').locator('.row-expand')).toHaveCount(0)
  })

  test('opens the name out in full, growing the row, then collapses it', async () => {
    const one = await lineHeight()
    const row = head('Lady Margaret')
    const before = (await row.boundingBox())!.height

    await row.locator('.row-expand').click()
    await expect(row).toHaveClass(/expanded/)
    const name = await row.locator('.row-name-text').boundingBox()
    expect(name!.height).toBeGreaterThan(one * 2.5)
    expect((await row.boundingBox())!.height).toBeGreaterThan(before)

    await row.locator('.row-expand').click()
    await expect(row).not.toHaveClass(/expanded/)
    expect((await row.boundingBox())!.height).toBe(before)
  })
})

test.describe('resizing the header column', () => {
  test.afterEach(async () => {
    // Each test starts from the default, whatever the last one dragged it to.
    await window.locator('.header-resize').dblclick()
    await expect.poll(cornerWidth).toBe(ROW_HEADER_W_DEFAULT)
  })

  test('widens the column and saves the width to the board file', async () => {
    await dragHandle(120)
    await expect.poll(cornerWidth).toBe(ROW_HEADER_W_DEFAULT + 120)
    await expect.poll(savedWidth).toBe(ROW_HEADER_W_DEFAULT + 120)
  })

  test('the whole column edge is draggable, not just the corner', async () => {
    // The edge is as tall as the board; a strip only as tall as the corner cell
    // is a target you have to already know about. Drag from the last row's edge.
    const rail = await window.locator('.header-resize').boundingBox()
    const last = await head('Lady Margaret').boundingBox()
    const corner = await window.locator('.grid-corner').boundingBox()
    // Down to the last row, and far taller than the corner cell it used to be.
    expect(rail!.y + rail!.height).toBeGreaterThanOrEqual(last!.y + last!.height)
    expect(rail!.height).toBeGreaterThan(corner!.height * 2)

    const y = last!.y + last!.height / 2
    await window.mouse.move(rail!.x + rail!.width / 2, y)
    await window.mouse.down()
    await window.mouse.move(rail!.x + rail!.width / 2 + 100, y, { steps: 8 })
    await window.mouse.up()
    await expect.poll(cornerWidth).toBe(ROW_HEADER_W_DEFAULT + 100)
  })

  test('the rail does not swallow the row headers underneath it', async () => {
    // It floats above them, so it has to stay transparent to the pointer or the
    // right-click menu and the reorder drag would both stop working.
    await head('Ana').click({ button: 'right' })
    await expect(window.locator('.context-menu')).toBeVisible()
    await window.keyboard.press('Escape')
    await window.locator('.board-scroll').click({ position: { x: 5, y: 5 } })
    await expect(window.locator('.context-menu')).toHaveCount(0)
  })

  test('a wider column can un-clip a name, dropping its expand button', async () => {
    await dragHandle(200)
    await expect(head('Lady Margaret').locator('.row-expand')).toHaveCount(0)
  })

  test('stops at the minimum width', async () => {
    await dragHandle(-600)
    await expect.poll(cornerWidth).toBe(ROW_HEADER_W_MIN)
    await expect.poll(savedWidth).toBe(ROW_HEADER_W_MIN)
  })

  test('never takes more than half the visible board', async () => {
    await dragHandle(VIEWPORT_W)
    // It really did move — the cap is not just the starting width.
    await expect.poll(cornerWidth).toBeGreaterThan(ROW_HEADER_W_DEFAULT)
    const visible = await window.locator('.board-scroll').evaluate((el) => el.clientWidth)
    expect(await cornerWidth()).toBeLessThanOrEqual(visible / 2)
  })
})
