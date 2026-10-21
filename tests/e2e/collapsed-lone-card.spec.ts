import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchApp, openProject } from './launch-app'

/**
 * A card alone in a collapsed group is shown, not counted (issue #161), in the
 * real app.
 *
 * What jsdom cannot judge: the card actually drawn over the collapsed stripes,
 * its hover tip and note opening, and that nothing on it can be edited.
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
      schemaVersion: 3,
      name: 'Lone',
      timelineLabel: 'Chapter',
      boards: ['main'],
      created: '2026-10-14',
      lastOpened: '2026-10-14',
      families: {}
    })
  )
  // Ana and Ben share the Crew row group; Cat is ungrouped. Act 1 holds
  // Chapters 1–2, where Ana has one card and Cat has two.
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
        card('k2', 'n_0002', 'cat', 'ch1'),
        card('k3', 'n_0003', 'cat', 'ch2'),
        card('k4', 'n_0004', 'ben', 'ch3')
      ],
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
  const char = (id: string, name: string, colour: string, group?: string): string =>
    `---\nid: ${id}\ntype: character\nname: ${name}\ncolour: '${colour}'\n${group ? `group: ${group}\n` : ''}---\n`
  await write('boards/main/characters/ana.md', char('ana', 'Ana', '#2E86C1', 'Crew'))
  await write('boards/main/characters/ben.md', char('ben', 'Ben', '#C0392B', 'Crew'))
  await write('boards/main/characters/cat.md', char('cat', 'Cat', '#27AE60'))
  const unit = (id: string, label: string, order: number, group?: string): string =>
    `---\nid: ${id}\nlabel: ${label}\norder: ${order}\n${group ? `group: ${group}\n` : ''}---\n`
  await write('boards/main/timeline/ch1.md', unit('ch1', 'Chapter 1', 1, 'Act 1'))
  await write('boards/main/timeline/ch2.md', unit('ch2', 'Chapter 2', 2, 'Act 1'))
  await write('boards/main/timeline/ch3.md', unit('ch3', 'Chapter 3', 3, 'Act 2'))
  await write('boards/main/timeline/ch4.md', unit('ch4', 'Chapter 4', 4))
  const note = (uid: string, title: string, extra = ''): string =>
    `---\nuid: ${uid}\ntitle: ${title}\n${extra}boards:\n  - main\n---\nBody of ${title}.\n`
  await write('boards/main/notes/opening.md', note('n_0001', 'Opening', 'hover: She arrives at dawn\n'))
  await write('boards/main/notes/cat-one.md', note('n_0002', 'Cat One'))
  await write('boards/main/notes/cat-two.md', note('n_0003', 'Cat Two'))
  await write('boards/main/notes/ben-fight.md', note('n_0004', 'Ben Fight'))
}

const openNote = () => window.locator('.note-popup, .note-panel')
const card = (title: string) => window.locator('.board-card', { hasText: title })
const toggle = (label: string) => window.getByRole('button', { name: new RegExp(`^(Collapse|Expand) ${label}$`) })

/** True when the centre of `inner`'s box lies inside `outer`'s. */
async function sitsOn(inner: ReturnType<Page['locator']>, outer: ReturnType<Page['locator']>): Promise<boolean> {
  const a = (await inner.boundingBox())!
  const b = (await outer.boundingBox())!
  const cx = a.x + a.width / 2
  const cy = a.y + a.height / 2
  return cx > b.x && cx < b.x + b.width && cy > b.y && cy < b.y + b.height
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-lone-e2e-')), 'lone')
  await scaffold(projectDir)

  app = await launchApp()
  window = await openProject(app, projectDir)
  await expect(window.locator('.project-title')).toHaveText('Lone')
  await expect(card('Opening')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test.describe('a collapsed column group', () => {
  test.beforeAll(async () => {
    await toggle('Act 1').click()
    await expect(window.locator('.col-head.collapsed')).toHaveCount(1)
  })

  test('shows a lone card on the stripes and counts a crowded cell', async () => {
    const lone = card('Opening')
    await expect(lone).toHaveClass(/read-only/)
    // Drawn over a striped collapsed cell, not a normal one.
    const cells = window.locator('.collapsed-cell')
    let onStripes = false
    for (const c of await cells.all()) if (await sitsOn(lone, c)) onStripes = true
    expect(onStripes).toBe(true)
    // Cat's two cards in Act 1 stay a count; no "1" badge anywhere.
    await expect(window.locator('.marker')).toHaveText(['2'])
    await expect(card('Cat One')).toHaveCount(0)
  })

  test('is read-only: no drag, no resize handles, no card menu', async () => {
    const lone = card('Opening')
    await expect(lone).toHaveAttribute('draggable', 'false')
    await expect(lone.locator('.resize-handle')).toHaveCount(0)
    await lone.click({ button: 'right' })
    await expect(window.locator('.context-menu')).toHaveCount(0)
  })

  test('still hovers and opens its note', async () => {
    const lone = card('Opening')
    // The last test left the mouse on the card; enter it afresh.
    await window.mouse.move(5, 5)
    await expect(lone.locator('.card-hover-icon')).toHaveCount(1)
    await lone.hover()
    await expect(window.locator('.card-hover-tip')).toContainText('She arrives at dawn')
    await lone.click()
    await expect(openNote()).toBeVisible()
    await window.keyboard.press('Escape')
  })

  test.afterAll(async () => {
    await toggle('Act 1').click()
    await expect(window.locator('.col-head.collapsed')).toHaveCount(0)
  })
})

test.describe('a collapsed row group', () => {
  test('shows each member’s lone card in that member’s colour', async () => {
    await window.locator('.row-group-head', { hasText: 'Crew' }).click()
    await expect(window.locator('.row-head.collapsed')).toHaveCount(1)
    await expect(card('Opening')).toHaveClass(/read-only/)
    await expect(card('Ben Fight')).toHaveClass(/read-only/)
    const border = (title: string) =>
      card(title).evaluate((el) => (el as HTMLElement).style.getPropertyValue('--card-border'))
    expect(await border('Opening')).toBe('#2E86C1')
    expect(await border('Ben Fight')).toBe('#C0392B')
    // Cat's row is open, so its cards are ordinary ones.
    await expect(card('Cat One')).not.toHaveClass(/read-only/)
  })
})
