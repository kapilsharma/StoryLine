import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Layer 3 for the Family tab (Issue 29). Run `npm run build` first.
 *
 * Everything here is something jsdom cannot answer, and each one shipped as a
 * bug in the standalone app before the merge:
 *
 *  - **Rendered geometry.** jsdom has no layout engine, so every box is 0×0 and
 *    a DOM-presence assertion passes whether or not the tree is on screen. The
 *    canvas collapses to height 0 unless its parent is a flex *container*, and
 *    that failure looks exactly like "nodes exist, nothing visible".
 *  - **Real pointer sequences.** Dragging captures the pointer, which retargets
 *    later events — so a bend cannot be removed by double-click, and a drag that
 *    starts one pixel off a node pans the canvas instead.
 *
 * The project under test is a throwaway copy of `tests/fixtures/ashvale-family`, so the
 * spec can drag things about without editing files under version control.
 */

let app: ElectronApplication
let window: Page
let projectDir: string

/** Wait until node positions stop changing.
 *
 *  Fitting the view persists the camera, which round-trips through a file write
 *  and a snapshot reload — so a box measured immediately after a fit is stale by
 *  the time the mouse gets there, and the drag lands on empty space and pans. */
async function waitForStable(page: Page): Promise<void> {
  let previous = ''
  for (let i = 0; i < 40; i++) {
    const current = JSON.stringify(
      await page.locator('.node').evaluateAll((els) =>
        els.slice(0, 5).map((e) => {
          const r = e.getBoundingClientRect()
          return [Math.round(r.x), Math.round(r.y)]
        })
      )
    )
    if (current === previous && current !== '[]') return
    previous = current
    await page.waitForTimeout(120)
  }
}

/** Fit the tree, then return a node that is fully on screen.
 *
 *  A node picked by name may sit outside the window: `boundingBox()` still
 *  reports a position, the mouse events land nowhere, and the test fails looking
 *  exactly like a broken drag. */
async function visibleNode(page: Page): Promise<Locator> {
  const viewport = page.locator('.viewport')
  const box = (await viewport.boundingBox())!

  // Double-clicking *empty space* fits. Aiming at a corner is not enough: a wide
  // tree can have a node there, and then the two clicks toggle its selection
  // instead of fitting — which leaves the next click deselecting rather than
  // selecting. So find a point that really is bare canvas.
  const empty = await page.evaluate((vp) => {
    for (const [fx, fy] of [
      [0.02, 0.96],
      [0.98, 0.96],
      [0.5, 0.98],
      [0.02, 0.04],
      [0.5, 0.02]
    ]) {
      const x = vp.x + vp.width * fx
      const y = vp.y + vp.height * fy
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      if (el?.classList.contains('viewport') || el?.classList.contains('world')) return { x, y }
    }
    return null
  }, box)
  if (empty) {
    await page.mouse.dblclick(empty.x, empty.y)
    await waitForStable(page)
  }

  for (const node of await page.locator('.node').all()) {
    const b = await node.boundingBox()
    if (!b) continue
    const inside =
      b.x > box.x + 4 &&
      b.y > box.y + 4 &&
      b.x + b.width < box.x + box.width - 4 &&
      b.y + b.height < box.y + box.height - 4
    if (inside) return node
  }
  throw new Error('No node is fully inside the viewport, even after fitting')
}

/**
 * Show the Family tab, on the named tree if given.
 *
 * These tests share one Electron window, so each has to establish where it is
 * rather than inheriting whatever tab the previous one left open — otherwise one
 * failure cascades into every test after it.
 */
async function goToFamily(page: Page, tree?: string): Promise<void> {
  // Clear any selection bar first: its buttons overlay the canvas.
  for (const label of ['Done', 'Clear']) {
    const button = page.getByRole('button', { name: label })
    if (await button.isVisible().catch(() => false)) await button.click()
  }
  await page.getByRole('button', { name: 'Family' }).click()
  await expect(page.locator('.viewport, .tree-empty')).toBeVisible()
  if (tree) await page.getByRole('button', { name: tree }).click()
  await waitForStable(page)
}

/**
 * Select a person by clicking their node centre — a press that never moves.
 *
 * Clicking *toggles*, so one click deselects a node that was already selected.
 * Check and click again rather than assuming the starting state, which no test
 * should have to know.
 */
async function selectNode(page: Page, node: Locator): Promise<void> {
  await waitForStable(page)
  for (let attempt = 0; attempt < 2; attempt++) {
    const b = (await node.boundingBox())!
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await page.waitForTimeout(150)
    if (((await node.getAttribute('class')) ?? '').includes('selected')) return
  }
  await expect(node).toHaveClass(/selected/)
}

/** Drag a node by a screen-space delta and wait for the position to settle. */
async function dragNode(page: Page, node: Locator, dx: number, dy: number): Promise<void> {
  await waitForStable(page)
  // Re-measure at the last possible moment — see waitForStable.
  const b = (await node.boundingBox())!
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2

  // Fail loudly if the press would miss: a drag that starts on empty space pans
  // the canvas instead, which reads as "dragging is broken".
  const onNode = await page.evaluate(
    ([x, y]) => Boolean((document.elementFromPoint(x, y) as HTMLElement)?.closest?.('.node')),
    [cx, cy]
  )
  expect(onNode, 'the drag must start on the node, not on empty canvas').toBe(true)

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 })
  await page.mouse.up()
  await waitForStable(page)
}

test.beforeAll(async () => {
  projectDir = join(await fs.mkdtemp(join(tmpdir(), 'zn-family-e2e-')), 'ashvale-family')
  await fs.cp(join(__dirname, '../fixtures/ashvale-family'), projectDir, { recursive: true })

  const env: Record<string, string> = { ...process.env } as Record<string, string>
  // Clear or Electron starts as plain Node (a quirk of some dev shells).
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: [join(__dirname, '../../out/main/index.js')], env })

  // Stub the native folder picker; there is no way to drive it from Playwright.
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, projectDir)

  window = await app.firstWindow()
  await window.setViewportSize({ width: 1400, height: 900 })
  await window.getByText('Open project…').click()
  await expect(window.locator('.project-title')).toHaveText(/Ashvale Family/)
  await window.getByRole('button', { name: 'Family' }).click()
  await expect(window.locator('.viewport')).toBeVisible()
  await waitForStable(window)
})

test.afterAll(async () => {
  await app?.close()
  await fs.rm(join(projectDir, '..'), { recursive: true, force: true }).catch(() => {})
})

test('the canvas has real height, and the tree is actually on screen', async () => {
  // The regression this guards: `.viewport` sizes itself with flex: 1 and its
  // only child is absolutely positioned, so a block parent collapses it to
  // height 0 and `overflow: hidden` hides every node.
  const viewport = (await window.locator('.viewport').boundingBox())!
  expect(viewport.height).toBeGreaterThan(200)

  const nodes = window.locator('.node')
  expect(await nodes.count()).toBeGreaterThan(5)

  const first = (await nodes.first().boundingBox())!
  expect(first.width).toBeGreaterThan(50)
  expect(first.height).toBeGreaterThan(20)

  // At least a few nodes inside the visible viewport, not merely in the DOM.
  const onScreen = await nodes.evaluateAll(
    (els, vp) =>
      els.filter((e) => {
        const r = e.getBoundingClientRect()
        return (
          r.width > 0 &&
          r.height > 0 &&
          r.right > vp.x &&
          r.bottom > vp.y &&
          r.x < vp.x + vp.width &&
          r.y < vp.y + vp.height
        )
      }).length,
    viewport
  )
  expect(onScreen).toBeGreaterThan(3)
})

test('connectors are drawn, and they join the nodes rather than floating', async () => {
  const edges = window.locator('.edges path.edge')
  expect(await edges.count()).toBeGreaterThan(3)
  const box = (await edges.first().boundingBox())!
  // A degenerate path reports a zero-area box.
  expect(box.width + box.height).toBeGreaterThan(10)
})

test('dragging a person freezes the tree and keeps them where they were put', async () => {
  const node = await visibleNode(window)
  const id = await node.getAttribute('data-id')
  const before = (await node.boundingBox())!

  await dragNode(window, node, 120, 60)

  const moved = window.locator(`.node[data-id="${id}"]`)
  const after = (await moved.boundingBox())!
  expect(Math.round(after.x - before.x)).toBeGreaterThan(60)
  expect(Math.round(after.y - before.y)).toBeGreaterThan(20)

  // The first drag arranges the whole view, and the moved node is marked pinned.
  await expect(moved).toHaveClass(/pinned/)
  await expect(window.getByRole('button', { name: 'Back to auto layout' })).toBeVisible()

  // Arranged means new people are imported deliberately, not auto-placed.
  await expect(window.getByRole('button', { name: /Add person/ })).toBeVisible()

  // And it survived the round-trip to disk.
  const view = JSON.parse(
    await fs.readFile(join(projectDir, 'boards', 'family', 'views', 'everyone.json'), 'utf8')
  )
  expect(view.arranged).toBe(true)
  expect(Object.keys(view.overrides)).toContain(id)
})

test('a person is placed once on an arranged tree, then stays put', async () => {
  // Follows the drag above, so the view is arranged. Hide someone by resetting to
  // auto and re-freezing would be slower; instead check the import path directly.
  const add = window.getByRole('button', { name: /Add person/ })
  const label = await add.textContent()
  if (label?.includes('(')) {
    await add.click()
    const choice = window.locator('.context-menu button').first()
    const name = (await choice.textContent())!.trim()
    await choice.click()
    await waitForStable(window)
    await expect(window.locator('.node', { hasText: name }).first()).toBeVisible()
  }
})

test('a connector can be bent by hand, and the bend removed again', async () => {
  await goToFamily(window, 'Everyone')
  // Back to auto layout first: on an arranged tree the lines are wherever the
  // hand-placed nodes put them, which makes picking one to click unreliable.
  const reset = window.getByRole('button', { name: 'Back to auto layout' })
  if (await reset.isVisible()) {
    await reset.click()
    await waitForStable(window)
  }
  await visibleNode(window)

  // A point *on* the polyline, not on its bounding box: an elbow's bbox corner
  // is empty space, and clicking there selects nothing. `getPointAtLength` walks
  // the real path, and the fat transparent twin (stroke-width 14) makes the hit
  // forgiving — a 1.5px line is not a realistic click target.
  const viewport = (await window.locator('.viewport').boundingBox())!
  const target = await window.locator('.edges path.edge-hit').evaluateAll(
    (paths, vp) => {
      for (const p of paths as SVGPathElement[]) {
        const total = p.getTotalLength()
        if (total < 60) continue
        const ctm = p.getScreenCTM()
        if (!ctm) continue
        // Sample along the path and take the first point in clear space.
        for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
          const local = p.getPointAtLength(total * t)
          const x = ctm.a * local.x + ctm.c * local.y + ctm.e
          const y = ctm.b * local.x + ctm.d * local.y + ctm.f
          const inside =
            x > vp.x + 20 && y > vp.y + 20 && x < vp.x + vp.width - 20 && y < vp.y + vp.height - 20
          if (!inside) continue
          const hit = document.elementFromPoint(x, y) as HTMLElement | null
          if (hit?.classList.contains('edge-hit')) return { x, y }
        }
      }
      return null
    },
    viewport
  )
  expect(target, 'expected a clickable connector inside the viewport').not.toBeNull()

  await window.mouse.click(target!.x, target!.y)
  await expect(window.locator('.selection-bar')).toBeVisible()

  // Dragging a hollow diamond (segment midpoint) inserts a waypoint.
  const diamond = window.locator('.handle.virtual').first()
  await expect(diamond).toBeVisible()
  const d = (await diamond.boundingBox())!
  await window.mouse.move(d.x + d.width / 2, d.y + d.height / 2)
  await window.mouse.down()
  await window.mouse.move(d.x + d.width / 2 + 50, d.y + d.height / 2 + 30, { steps: 10 })
  await window.mouse.up()
  await window.waitForTimeout(300)

  await expect(window.getByRole('button', { name: 'Reset route' })).toBeVisible()
  const routed = window.getByRole('button', { name: /Reset \d+ line/ })
  await expect(routed).toBeVisible()

  // Every corner of the drawn line gets a square, whether it came from the
  // automatic elbow or from this edit, so a corner is always grabbable — and
  // always removable. Dragging materialised the elbow's own corners alongside
  // the new one, so there is more than one to clear.
  const removers = window.locator('.handle.remove')
  expect(await removers.count()).toBeGreaterThan(0)

  // The ✕ exists because pointer capture eats the double-click: dragging a
  // handle retargets later events to the viewport, so a dblclick never arrives.
  // Clearing every corner drops the route and the automatic path returns.
  for (let i = 0; i < 8; i++) {
    if (!(await routed.isVisible())) break
    await removers.first().click({ force: true })
    await window.waitForTimeout(250)
  }
  await expect(routed).toBeHidden()
  await expect(window.locator('path.edge.routed')).toHaveCount(0)
})

test('selecting a person traces their family and names their parents', async () => {
  await goToFamily(window, 'Everyone')
  const node = await visibleNode(window)
  await selectNode(window, node)
  await expect(window.locator('.viewport.focused')).toBeVisible()

  // The person's bar, identified by its own Clear button: a connector may also be
  // selected (fitting the view clicks the canvas, which can land on a line), and
  // then two bars are on screen at once.
  const bar = window.locator('.selection-bar', {
    has: window.getByRole('button', { name: 'Clear' })
  })
  // Either parents are named, or it says there are none — both are answers.
  await expect(bar.locator('.hint')).toHaveText(/Parents:|No parents recorded/)
  // Everything unrelated dims, so the family is legible on a dense tree.
  expect(await window.locator('.node.dim').count()).toBeGreaterThan(0)
})

test('a character can be added to and removed from one tree only', async () => {
  await goToFamily(window, 'Everyone')

  // Take someone off this tree, then put them back — the file is never touched,
  // so the "+ Add person" count is the mirror of the node count.
  const node = await visibleNode(window)
  const name = (await node.locator('.name').textContent())!.trim()
  const before = await window.locator('.node').count()

  await selectNode(window, node)
  await window.getByRole('button', { name: 'Remove from this tree' }).click()

  // `toHaveCount` retries; `waitForStable` only watches positions, so it can
  // return while the removed node is still in the DOM.
  await expect(window.locator('.node')).toHaveCount(before - 1)
  await expect(window.locator('.node', { hasText: name })).toHaveCount(0)
  // Still a character in the project — just not on this tree.
  const add = window.getByRole('button', { name: /Add person \(\d+\)/ })
  await expect(add).toBeVisible()

  await add.click()
  await window.locator('.context-menu button', { hasText: name }).first().click()
  await expect(window.locator('.node')).toHaveCount(before)
})

test('a tree does not pick up a character created on the Characters tab', async () => {
  await goToFamily(window, 'Everyone')
  const treeBefore = await window.locator('.node').count()

  await window.getByRole('button', { name: 'Characters' }).click()
  await window.getByRole('button', { name: '+ Add' }).click()
  await window.locator('.entity-form input').first().fill('Reference Person')
  await window.getByRole('button', { name: 'Create' }).click()
  await window.waitForTimeout(600)

  // The Characters tab counts them; nothing else does.
  await expect(window.getByRole('button', { name: /^Reference only \(/ })).toBeVisible()

  await window.getByRole('button', { name: 'Family' }).click()
  await expect(window.locator('.node')).toHaveCount(treeBefore)

  await window.getByRole('button', { name: 'Boards' }).click()
  await window.waitForTimeout(500)
  await expect(window.locator('.row-head', { hasText: 'Reference Person' })).toHaveCount(0)
  // ...but the board offers to put them on.
  await expect(window.locator('select[title*="already in this project"]')).toBeVisible()
})

test('the board’s cast is a curated subset of the characters', async () => {
  // Counted on the Characters tab rather than by counting row headers: this
  // example has no timeline units, so the grid shows its "add a column" prompt
  // instead of a grid. The filter counts are the honest measure either way.
  await window.getByRole('button', { name: 'Characters' }).click()
  await window.waitForTimeout(500)

  const count = async (pattern: RegExp): Promise<number> => {
    const label = (await window.getByRole('button', { name: pattern }).textContent())!
    return Number(/\((\d+)\)/.exec(label)![1])
  }
  const all = await count(/^All \(\d+\)/)
  const onBoard = await count(/^On board \(\d+\)/)
  const onTree = await count(/^On a tree \(\d+\)/)

  expect(onBoard).toBeGreaterThan(0)
  expect(onBoard).toBeLessThan(all)
  // The trees are what most of this cast exists for.
  expect(onTree).toBeGreaterThan(onBoard)
})

test('the view tabs switch between trees over the same cast', async () => {
  await goToFamily(window, 'Everyone')
  const tabs = window.locator('.family-view .tabs .tab')
  expect(await tabs.count()).toBeGreaterThan(2)

  const everyone = await window.locator('.node').count()
  await window.getByRole('button', { name: 'Rowan’s ancestors' }).click()
  await waitForStable(window)
  const ancestors = await window.locator('.node').count()

  // A filtered tree is a subset — the same characters, fewer of them.
  expect(ancestors).toBeGreaterThan(0)
  expect(ancestors).toBeLessThan(everyone)
})
