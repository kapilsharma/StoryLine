import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * End-to-end coverage for the study-notes features (Issues #59–#67), against a
 * real Electron app and a real project on disk. Run `npm run build` first.
 *
 * These live here rather than in jsdom because each one crosses a boundary that
 * a component test stubs out: search runs in the main process over files, the
 * asset protocol is registered on the Electron side, and card stacking is a
 * layout question jsdom answers 0×0 to.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

/**
 * Tab clicks are scoped to the header nav: "Notes" and "Boards" also appear in
 * the Notes tab's own filter chips ("Notes", "All boards"), and an unscoped
 * role query matches both.
 */
const tab = (name: string) => window.locator('nav.tabs').getByRole('button', { name, exact: true })

/** Two boards, so cross-board search (#60) has somewhere to fail. */
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
        name: 'Study Project',
        timelineLabel: 'Section',
        rowLabel: 'Phase',
        kind: 'general',
        boards: ['adm', 'concepts'],
        created: '2026-08-16',
        lastOpened: '2026-08-16',
        families: {}
      },
      null,
      2
    )
  )

  // ── Board 1: two rows, two columns, three cards — two of them in one cell ──
  await write(
    'boards/adm/board.json',
    JSON.stringify(
      {
        id: 'adm',
        name: 'ADM',
        cards: [
          { id: 'c1', noteUid: 'n_0001', rowId: 'phase-a', colStart: 'objectives', colEnd: 'objectives' },
          { id: 'c2', noteUid: 'n_0002', rowId: 'phase-a', colStart: 'steps', colEnd: 'steps' },
          // Same row, same column as c2 — this is the #66 case.
          { id: 'c3', noteUid: 'n_0003', rowId: 'phase-a', colStart: 'steps', colEnd: 'steps' }
        ],
        hiddenRows: [],
        hiddenCols: [],
        presets: [],
        members: ['phase-a', 'phase-b'],
        rowOrder: ['phase-a', 'phase-b'],
        rowGroupOrder: [],
        colOrder: ['objectives', 'steps'],
        collapsedRowGroups: [],
        collapsedColGroups: [],
        zoom: 1,
        views: []
      },
      null,
      2
    )
  )
  await write(
    'boards/adm/characters/phase-a.md',
    `---\nid: phase-a\ntype: character\nname: Phase A\ncolour: '#2E86C1'\n---\nThe vision phase.\n`
  )
  await write(
    'boards/adm/characters/phase-b.md',
    `---\nid: phase-b\ntype: character\nname: Phase B\ncolour: '#E67E22'\n---\nThe business phase.\n`
  )
  await write('boards/adm/timeline/objectives.md', `---\nid: objectives\nlabel: Objectives\norder: 1\n---\n`)
  await write('boards/adm/timeline/steps.md', `---\nid: steps\nlabel: Steps\norder: 2\n---\n`)
  await write(
    'boards/adm/notes/two-objectives.md',
    `---\nuid: n_0001\ntitle: 2 objectives\nboards:\n  - adm\n---\nDevelop an aspirational vision of the enterprise.\n`
  )
  await write(
    'boards/adm/notes/eleven-steps.md',
    `---\nuid: n_0002\ntitle: 11 steps\nboards:\n  - adm\n---\nEstablish the architecture project.\n`
  )
  await write(
    'boards/adm/notes/stacked.md',
    `---\nuid: n_0003\ntitle: Stacked card\nboards:\n  - adm\n---\nShares a cell with the steps card.\n`
  )

  // ── Board 2: exists purely so a search can miss it, then find it ──
  await write(
    'boards/concepts/board.json',
    JSON.stringify(
      {
        id: 'concepts',
        name: 'Concepts',
        cards: [],
        hiddenRows: [],
        hiddenCols: [],
        presets: [],
        members: [],
        rowOrder: [],
        rowGroupOrder: [],
        colOrder: [],
        collapsedRowGroups: [],
        collapsedColGroups: [],
        zoom: 1,
        views: []
      },
      null,
      2
    )
  )
  await write(
    'boards/concepts/notes/gap.md',
    `---\nuid: n_0010\ntitle: Gap\nboards:\n  - concepts\n---\nA statement of difference between two states.\n`
  )
}

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-study-e2e-')), 'study-project')
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
  await expect(window.locator('.project-title')).toHaveText('Study Project')
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test.describe('project labels and kind (#62, #63)', () => {
  test('names the tabs from the project’s own labels', async () => {
    await expect(window.getByRole('button', { name: 'Phases' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Sections' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Characters' })).toHaveCount(0)
  })

  test('a general project has no Family tab', async () => {
    await expect(window.getByRole('button', { name: 'Family' })).toHaveCount(0)
  })
})

test.describe('search (#59, #60)', () => {
  test.beforeEach(async () => {
    await tab('Notes').click()
    await window.locator('input.search').fill('')
  })

  test('finds a note by text that appears only in its body', async () => {
    await window.locator('input.search').fill('aspirational vision')
    // The phrase is in no title — a title-only search would find nothing.
    await expect(window.locator('.note-card')).toHaveCount(1)
    await expect(window.locator('.note-card-title')).toHaveText('2 objectives')
    await expect(window.locator('.note-card-snippet')).toContainText('aspirational vision')
  })

  test('scoped to this board, a note on the other board is not found', async () => {
    await window.getByRole('button', { name: 'This board' }).click()
    await window.locator('input.search').fill('statement of difference')
    await expect(window.locator('.note-card')).toHaveCount(0)
  })

  test('switching to All boards finds it, and says which board', async () => {
    await window.getByRole('button', { name: 'All boards' }).click()
    await window.locator('input.search').fill('statement of difference')
    await expect(window.locator('.note-card')).toHaveCount(1)
    await expect(window.locator('.note-card-tags .tag.board')).toHaveText('Concepts')
  })

  test('finds a row by its body text', async () => {
    await window.getByRole('button', { name: 'All boards' }).click()
    await window.locator('input.search').fill('business phase')
    // Wait on the count first: search is debounced, and asserting text against a
    // locator that has not resolved yet is what makes this spec flaky in
    // sequence but pass in isolation.
    await expect(window.locator('.note-card')).toHaveCount(1)
    await expect(window.locator('.note-card-title')).toHaveText('Phase B')
    await expect(window.locator('.note-card-tags .tag.kind')).toHaveText('Row')
  })

  test('reflects an edit made outside the app', async () => {
    await window.getByRole('button', { name: 'All boards' }).click()
    await fs.writeFile(
      join(projectDir, 'boards', 'concepts', 'notes', 'gap.md'),
      `---\nuid: n_0010\ntitle: Gap\nboards:\n  - concepts\n---\nA freshly rewritten body about interoperability.\n`
    )
    // The watcher invalidates the index, so the new text becomes findable.
    await expect(async () => {
      await window.locator('input.search').fill('interoperability')
      await expect(window.locator('.note-card')).toHaveCount(1)
    }).toPass({ timeout: 10_000 })
  })
})

test.describe('board: stacked cards (#66) and revision mode (#67)', () => {
  test.beforeEach(async () => {
    await tab('Boards').click()
    await window.locator('.board-tab', { hasText: 'ADM' }).first().click()
    await expect(window.locator('.board-card').first()).toBeVisible()
    // Each test drives revision mode itself — the toolbar state is per session,
    // and an order-dependent spec is worse than a slightly repetitive one.
    const leave = window.getByTitle(/Leave revision mode/)
    if (await leave.count()) await leave.click()
  })

  test('two cards sharing a cell are both visible and do not overlap', async () => {
    const steps = window.locator('.board-card', { hasText: '11 steps' })
    const stacked = window.locator('.board-card', { hasText: 'Stacked card' })
    await expect(steps).toBeVisible()
    await expect(stacked).toBeVisible()

    const a = await steps.boundingBox()
    const b = await stacked.boundingBox()
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    // Same column, different vertical bands — this is what #66 buys.
    expect(Math.abs(a!.x - b!.x)).toBeLessThan(4)
    const overlaps = a!.y < b!.y + b!.height && b!.y < a!.y + a!.height
    expect(overlaps).toBe(false)
  })

  test('revision mode masks every card, and a click reveals just one', async () => {
    await window.getByTitle(/Revision mode/).click()
    await expect(window.locator('.board-card.masked')).toHaveCount(3)
    await expect(window.getByText('2 objectives')).toHaveCount(0)

    await window.locator('.board-card.masked').first().click()
    await expect(window.locator('.board-card.masked')).toHaveCount(2)
  })

  test('a column header reveals its whole column', async () => {
    await window.getByTitle(/Revision mode/).click()
    await expect(window.locator('.board-card.masked')).toHaveCount(3)

    await window.locator('.col-head', { hasText: 'Steps' }).click()
    // Two cards live in Steps; only the Objectives card stays hidden.
    await expect(window.locator('.board-card.masked')).toHaveCount(1)
  })

  test('reveal-all and hide-all work from the toolbar', async () => {
    await window.getByTitle(/Revision mode/).click()
    await expect(window.locator('.board-card.masked')).toHaveCount(3)

    await window.getByTitle('Reveal every card').click()
    await expect(window.locator('.board-card.masked')).toHaveCount(0)
    await window.getByTitle('Hide every card again').click()
    await expect(window.locator('.board-card.masked')).toHaveCount(3)
  })

  test('leaving revision mode restores every title', async () => {
    await window.getByTitle(/Revision mode/).click()
    await expect(window.locator('.board-card.masked')).toHaveCount(3)

    await window.getByTitle(/Leave revision mode/).click()
    await expect(window.locator('.board-card.masked')).toHaveCount(0)
    await expect(window.getByText('2 objectives')).toBeVisible()
  })
})

test.describe('assets (#61)', () => {
  test('an image referenced from a note actually loads over zn-asset://', async () => {
    // A 1×1 red PNG, written straight into the board's assets folder.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    await fs.mkdir(join(projectDir, 'boards', 'adm', 'assets'), { recursive: true })
    await fs.writeFile(join(projectDir, 'boards', 'adm', 'assets', 'diagram.png'), png)
    await fs.writeFile(
      join(projectDir, 'boards', 'adm', 'notes', 'with-image.md'),
      `---\nuid: n_0020\ntitle: With image\nboards:\n  - adm\n---\n![Diagram](assets/diagram.png)\n`
    )

    await tab('Notes').click()
    await expect(async () => {
      await window.locator('input.search').fill('With image')
      await window.locator('.note-card-title', { hasText: 'With image' }).click()
      await expect(window.locator('.note-body img')).toBeVisible()
    }).toPass({ timeout: 10_000 })

    const img = window.locator('.note-body img')
    await expect(img).toHaveAttribute('src', 'zn-asset://adm/diagram.png')
    // naturalWidth is 0 for an image the renderer could not load — this is the
    // assertion that proves the custom protocol and the CSP actually agree.
    await expect
      .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)
  })
})
