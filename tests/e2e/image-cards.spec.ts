import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchApp, openProject } from './launch-app'

/**
 * Image cards (issue #218) in the real app.
 *
 * What jsdom cannot judge: the picture actually loading over the `zn-asset://`
 * scheme, the row really growing to the computed height (and only that row),
 * and a wide picture keeping its shape inside the card.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

const svg = (w: number, h: number, fill: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`

async function scaffold(dir: string): Promise<void> {
  const write = async (path: string, body: string): Promise<void> => {
    await fs.mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
    await fs.writeFile(join(dir, path), body)
  }
  await write(
    'project.json',
    JSON.stringify({
      schemaVersion: 4,
      name: 'Pictures',
      timelineLabel: 'Chapter',
      boards: ['main'],
      created: '2026-10-28',
      lastOpened: '2026-10-28',
      families: {}
    })
  )
  const card = (id: string, noteUid: string, rowId: string, col: string) => ({
    id,
    noteUid,
    rowId,
    colStart: col,
    colEnd: col
  })
  await write(
    'boards/main/board.json',
    JSON.stringify({
      id: 'main',
      name: 'Main',
      cards: [
        card('k1', 'n_0001', 'ana', 'ch1'),
        card('k2', 'n_0002', 'ana', 'ch2'),
        card('k3', 'n_0003', 'ben', 'ch1')
      ],
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      members: ['ana', 'ben'],
      rowOrder: ['ana', 'ben'],
      rowGroupOrder: ['ana', 'ben'],
      colOrder: [],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1,
      views: []
    })
  )
  const char = (id: string, name: string, colour: string): string =>
    `---\nid: ${id}\ntype: character\nname: ${name}\ncolour: '${colour}'\n---\n`
  await write('boards/main/characters/ana.md', char('ana', 'Ana', '#2E86C1'))
  await write('boards/main/characters/ben.md', char('ben', 'Ben', '#C0392B'))
  const unit = (id: string, label: string, order: number): string =>
    `---\nid: ${id}\nlabel: ${label}\norder: ${order}\n---\n`
  await write('boards/main/timeline/ch1.md', unit('ch1', 'Chapter 1', 1))
  await write('boards/main/timeline/ch2.md', unit('ch2', 'Chapter 2', 2))
  await write('boards/main/assets/square.svg', svg(100, 100, '#8e44ad'))
  await write('boards/main/assets/wide.svg', svg(400, 100, '#16a085'))
  const note = (uid: string, title: string, extra = ''): string =>
    `---\nuid: ${uid}\ntitle: ${title}\n${extra}boards:\n  - main\n---\n`
  await write('boards/main/notes/the-map.md', note('n_0001', 'The Map', 'image: assets/square.svg\n'))
  await write('boards/main/notes/the-coast.md', note('n_0002', 'The Coast', 'image: assets/wide.svg\n'))
  await write('boards/main/notes/ben-waits.md', note('n_0003', 'Ben Waits'))
}

const card = (title: string) => window.locator('.board-card', { hasText: title })
const rowHead = (name: string) => window.locator('.row-head', { hasText: name })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-image-e2e-')), 'pictures')
  await scaffold(projectDir)
  app = await launchApp()
  window = await openProject(app, projectDir)
  await expect(window.locator('.project-title')).toHaveText('Pictures')
  await expect(card('The Map')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('loads the picture over the asset scheme', async () => {
  const img = card('The Map').locator('img.card-image')
  await expect(img).toHaveAttribute('src', 'zn-asset://main/square.svg')
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0)
})

test('grows only the row with an image card, to the computed height', async () => {
  // Defaults: 120px picture + 10px frame = 130px card, + 16px = 146px row.
  expect(Math.round((await card('The Map').boundingBox())!.height)).toBe(130)
  expect(Math.round((await rowHead('Ana').boundingBox())!.height)).toBe(146)
  expect(Math.round((await rowHead('Ben').boundingBox())!.height)).toBe(66)
  // A text card on a text row is unchanged.
  expect(Math.round((await card('Ben Waits').boundingBox())!.height)).toBe(50)
})

test('keeps a picture inside its card, its shape intact, no taller than the setting', async () => {
  for (const [title, ratio] of [
    ['The Map', 1],
    ['The Coast', 4]
  ] as const) {
    const c = (await card(title).boundingBox())!
    const i = (await card(title).locator('img.card-image').boundingBox())!
    expect(i.height).toBeLessThanOrEqual(120.5)
    expect(i.width / i.height).toBeCloseTo(ratio, 1)
    expect(i.x).toBeGreaterThanOrEqual(c.x)
    expect(i.x + i.width).toBeLessThanOrEqual(c.x + c.width + 0.5)
    expect(i.y).toBeGreaterThanOrEqual(c.y)
    expect(i.y + i.height).toBeLessThanOrEqual(c.y + c.height + 0.5)
  }
  // The title sits to the right of the picture by default.
  const title = (await card('The Map').locator('.card-title').boundingBox())!
  const img = (await card('The Map').locator('img.card-image').boundingBox())!
  expect(title.x).toBeGreaterThanOrEqual(img.x + img.width)
  await window.screenshot({ path: join('test-results', 'image-cards.png') })
})

test('puts the title below the picture when set to', async () => {
  await window.locator('.tab', { hasText: 'Settings' }).first().click()
  await window.getByLabel('Image card title').selectOption('below')
  await window.locator('.tab', { hasText: 'Boards' }).first().click()
  const map = card('The Map')
  await expect(map.locator('.card-image-body')).toHaveClass(/title-below/)
  // 120px picture + one caption line + its gap + the frame.
  const h = (await map.boundingBox())!.height
  expect(h).toBeGreaterThan(130)
  const title = (await map.locator('.card-title').boundingBox())!
  const img = (await map.locator('img.card-image').boundingBox())!
  expect(title.y).toBeGreaterThanOrEqual(img.y + img.height - 0.5)
  expect(title.y + title.height).toBeLessThanOrEqual((await map.boundingBox())!.y + h + 0.5)
  await window.screenshot({ path: join('test-results', 'image-cards-below.png') })
})

test('side panel: Image is chosen and the picture sits left of tags and hover text', async () => {
  await window.locator('.tab', { hasText: 'Settings' }).first().click()
  await window.getByLabel('Note opened from a board').selectOption('panel')
  await window.locator('.tab', { hasText: 'Boards' }).first().click()
  await card('The Map').click()
  await expect(window.getByRole('radio', { name: 'Image' })).toHaveAttribute('aria-checked', 'true')
  const box = (await window.getByRole('button', { name: 'Change image' }).boundingBox())!
  const tags = (await window.getByLabel('Tags').boundingBox())!
  const hover = (await window.getByLabel('Hover text').boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(tags.x)
  expect(box.x + box.width).toBeLessThanOrEqual(hover.x)
  await window.screenshot({ path: join('test-results', 'image-cards-panel.png') })
})

test('side panel: reuses a picture already on the board without copying it again', async () => {
  // The Map is still open in the panel from the test above.
  const assets = join(projectDir, 'boards', 'main', 'assets')
  const before = (await fs.readdir(assets)).sort()
  await window.getByRole('button', { name: 'Change image' }).click()
  const chooser = window.getByRole('group', { name: 'Choose an image' })
  await expect(chooser.getByRole('button', { name: 'square.svg' })).toHaveAttribute('aria-pressed', 'true')
  await chooser.getByRole('button', { name: 'wide.svg' }).click()
  await expect(chooser).toHaveCount(0)
  await expect(card('The Map').locator('img.card-image')).toHaveAttribute('src', 'zn-asset://main/wide.svg')
  await expect
    .poll(() => fs.readFile(join(projectDir, 'boards/main/notes/the-map.md'), 'utf8'))
    .toContain('image: assets/wide.svg')
  expect((await fs.readdir(assets)).sort()).toEqual(before)
  await window.getByRole('button', { name: 'Change image' }).click()
  await window.screenshot({ path: join('test-results', 'image-cards-chooser.png') })
  await window.getByRole('button', { name: 'Close image chooser' }).click()
})

test('with no text, centres the picture in the card', async () => {
  await window.locator('.tab', { hasText: 'Settings' }).first().click()
  await window.getByLabel('Image card title').selectOption('none')
  await window.locator('.tab', { hasText: 'Boards' }).first().click()
  for (const title of ['The Map', 'The Coast']) {
    const c = window.locator('.board-card.image-card').nth(title === 'The Map' ? 0 : 1)
    const box = (await c.boundingBox())!
    const img = (await c.locator('img.card-image').boundingBox())!
    expect(Math.abs(img.x + img.width / 2 - (box.x + box.width / 2))).toBeLessThan(1.5)
  }
  await window.screenshot({ path: join('test-results', 'image-cards-none.png') })
})
