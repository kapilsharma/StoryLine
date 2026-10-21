import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchApp, openProject } from './launch-app'

/**
 * Board virtualization — columns (#150) and rows (#157) — on a board far larger
 * than the window, in the real app.
 *
 * jsdom never lays out, so the grid falls back to rendering everything there;
 * the window only runs against a real viewport and real scrolling. What can go
 * wrong is geometric: a card drawn under the wrong header once the board has
 * scrolled, or a scroll size that shrinks as cells drop out.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

const N = 60
const pad = (i: number): string => String(i).padStart(2, '0')

/** An N×N board with one card per row, on the diagonal. */
async function scaffold(dir: string): Promise<void> {
  const write = async (path: string, body: string): Promise<void> => {
    await fs.mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }
  const ids = Array.from({ length: N }, (_, i) => pad(i + 1))
  await write(
    'project.json',
    JSON.stringify({
      schemaVersion: 4,
      name: 'Big Board',
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
      cards: ids.map((n) => ({ id: `k${n}`, noteUid: `n_00${n}`, rowId: `r${n}`, colStart: `c${n}`, colEnd: `c${n}` })),
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      members: ids.map((n) => `r${n}`),
      rowOrder: ids.map((n) => `r${n}`),
      rowGroupOrder: ids.map((n) => `r${n}`),
      colOrder: [],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1,
      views: []
    })
  )
  for (const [i, n] of ids.entries()) {
    await write(`boards/main/characters/r${n}.md`, `---\nid: r${n}\ntype: character\nname: Row ${n}\ncolour: '#2E86C1'\n---\n`)
    await write(`boards/main/timeline/c${n}.md`, `---\nid: c${n}\nlabel: Col ${n}\norder: ${i + 1}\n---\n`)
    await write(`boards/main/notes/card-${n}.md`, `---\nuid: n_00${n}\ntitle: Card ${n}\nboards:\n  - main\n---\n`)
  }
}

const scroller = () => window.locator('.board-scroll')
const card = (n: number) => window.locator('.board-card', { hasText: `Card ${pad(n)}` })
const colHead = (n: number) => window.locator('.col-head', { hasText: `Col ${pad(n)}` })
const rowHead = (n: number) => window.locator('.row-head', { hasText: `Row ${pad(n)}` })

/** Wait for the window to settle after a scroll (recomputed on the next frame). */
const scrollTo = async (left: number, top: number): Promise<void> => {
  await scroller().evaluate((el, [l, t]) => el.scrollTo(l, t), [left, top])
  await window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** True when `card`'s centre lies inside the column header's x-range and the row header's y-range. */
async function sitsUnder(n: number): Promise<boolean> {
  const c = (await card(n).boundingBox())!
  const col = (await colHead(n).boundingBox())!
  const row = (await rowHead(n).boundingBox())!
  const cx = c.x + c.width / 2
  const cy = c.y + c.height / 2
  return cx > col.x && cx < col.x + col.width && cy > row.y && cy < row.y + row.height
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-virtual-e2e-')), 'big-board')
  await scaffold(projectDir)
  app = await launchApp()
  window = await openProject(app, projectDir)
  await expect(window.locator('.project-title')).toHaveText('Big Board')
  await expect(card(1)).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('renders only the corner of the board in view', async () => {
  const cards = await window.locator('.board-card').count()
  const cols = await window.locator('.col-head').count()
  const rows = await window.locator('.row-head').count()
  expect(cards).toBeGreaterThan(0)
  expect(cards).toBeLessThan(N / 2)
  expect(cols).toBeLessThan(N / 2)
  expect(rows).toBeLessThan(N / 2)
  await expect(card(N)).toHaveCount(0)
  expect(await sitsUnder(1)).toBe(true)
})

test('keeps the full scroll size, so the scrollbars reach every cell', async () => {
  const size = await scroller().evaluate((el) => ({ w: el.scrollWidth, h: el.scrollHeight }))
  // At least N columns of the 160px base width, and N rows of real height.
  expect(size.w).toBeGreaterThan(N * 160)
  expect(size.h).toBeGreaterThan(N * 40)

  await scrollTo(size.w, size.h)
  const after = await scroller().evaluate((el) => ({ w: el.scrollWidth, h: el.scrollHeight }))
  expect(after).toEqual(size)
})

test('scrolled to the far corner, the last card is drawn under its own headers', async () => {
  await expect(card(N)).toBeVisible()
  await expect(colHead(N)).toBeVisible()
  await expect(rowHead(N)).toBeVisible()
  await expect(card(1)).toHaveCount(0)
  expect(await sitsUnder(N)).toBe(true)
})

test('a card mid-board lines up after scrolling part way', async () => {
  // Bring column 30 / row 30 into view without either edge of the board.
  const pos = await scroller().evaluate((el) => ({ w: el.scrollWidth, h: el.scrollHeight }))
  await scrollTo(pos.w / 2 - 400, pos.h / 2 - 300)
  await expect(card(30)).toBeVisible()
  expect(await sitsUnder(30)).toBe(true)
  await expect(card(1)).toHaveCount(0)
  await expect(card(N)).toHaveCount(0)
})

test('the column and row headers stay pinned while the board scrolls', async () => {
  const board = (await scroller().boundingBox())!
  const col = (await colHead(30).boundingBox())!
  const row = (await rowHead(30).boundingBox())!
  // Sticky: column headers at the top edge, row headers at the left edge.
  expect(col.y - board.y).toBeLessThan(60)
  expect(row.x - board.x).toBeLessThan(5)
})
