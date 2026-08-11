import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { buildGraph } from '@shared/graph'
import { DEFAULT_SETTINGS } from '@shared/config'
import { listCharacters, listViews, readBoard, readProject } from '@main/data/repository'
import { loadSnapshot } from '@main/projectService'
import { layoutTree } from '@renderer/components/tree/layout'
import type { View } from '@shared/types'

/**
 * End-to-end over the on-disk fixture project at `tests/fixtures/ashvale-family`,
 * read through the app's own repository layer. Catches the class of bug that
 * in-code fixtures miss: a frontmatter shape that parses in a test but not from an
 * actual file.
 *
 * The people are invented, and the project is deliberately shaped to exercise the
 * things the Family tab can get wrong — three generations, three families, partial
 * dates in all three forms, one character with no `gender` key, a married-in spouse
 * whose `family` disagrees with her surname, and a curated board that holds only 3
 * of the 21 characters.
 *
 * Assertions stay structural (subsets, gaps, "the root is present") rather than
 * naming people, because they describe properties of the layout engine rather than
 * of this data — the same test should keep meaning something if the fixture grows.
 * Counts that *are* the point, like the board being a strict subset, are asserted
 * as relationships.
 */

const root = join(process.cwd(), 'tests', 'fixtures', 'ashvale-family')
const BID = 'family'

/** A fixture view with any hand-placed geometry stripped.
 *
 *  Anything asserting *computed* geometry has to ignore stored overrides, or the
 *  test measures the arrangement rather than the layout engine's output. */
const computed = (v: View): View => ({ ...v, arranged: false, overrides: {}, edgeRoutes: {} })

const cast = () => listCharacters(root, BID)
const viewsOf = async (): Promise<View[]> => {
  const { value: board } = await readBoard(root, BID)
  return listViews(root, BID, board.views)
}
const viewNamed = async (id: string): Promise<View> => {
  const v = (await viewsOf()).find((x) => x.id === id)
  if (!v) throw new Error(`fixture has no view "${id}"`)
  return v
}

describe('the family fixture project', () => {
  it('opens as a normal Story Line project, with trees under the board', async () => {
    const snapshot = await loadSnapshot(root)
    const board = snapshot.boards.find((b) => b.board.id === BID)
    expect(board).toBeDefined()
    expect(board!.characters.length).toBeGreaterThanOrEqual(15)
    expect(board!.views.length).toBeGreaterThanOrEqual(2)
    // View order comes from board.json, and every listed view must exist.
    expect(board!.views.map((v) => v.id)).toEqual(board!.board.views)
  })

  it('demonstrates the split it exists to demonstrate: small board, large trees', async () => {
    const { value: board } = await readBoard(root, BID)
    const characters = await cast()
    // The point of the fixture: most of the cast is context for the family tree,
    // not rows on the plot grid. Asserted as a relationship rather than a count, so
    // the test still means something if the fixture grows.
    expect(board.members).not.toBeNull()
    expect(board.members!.length).toBeGreaterThan(0)
    expect(board.members!.length).toBeLessThan(characters.length)
    for (const id of board.members!) {
      expect(characters.map((c) => c.id)).toContain(id)
    }

    const everyone = (await viewsOf()).find((v) => v.id === 'everyone')!
    expect(everyone.members).not.toBeNull()
    expect(everyone.members!.length).toBeGreaterThan(board.members!.length)
  })

  it('gives every tree an explicit membership, so none drifts', async () => {
    for (const view of await viewsOf()) {
      expect({ view: view.id, explicit: view.members !== null }).toEqual({
        view: view.id,
        explicit: true
      })
    }
  })

  it('carries a persisted family palette', async () => {
    const { value: project } = await readProject(root)
    expect(Object.keys(project.families).length).toBeGreaterThan(1)
    for (const colour of Object.values(project.families)) {
      expect(colour).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('reads dates back as strings, not Dates', async () => {
    const dated = (await cast()).filter((c) => c.birthday)
    expect(dated.length).toBeGreaterThan(0)
    for (const c of dated) {
      expect(typeof c.birthday).toBe('string')
      expect(c.birthday).toMatch(/^\d{4}(-\d{2}(-\d{2})?)?$/)
    }
  })

  it('lays out every character with no warnings', async () => {
    const characters = await cast()
    const layout = layoutTree(buildGraph(characters), computed(await viewNamed('everyone')))
    expect(layout.nodes).toHaveLength(characters.length)
    expect(layout.warnings).toEqual([])
    expect([...layout.byGeneration.keys()].length).toBeGreaterThanOrEqual(3)
  })

  it('holds adjacent couples at exactly the partner gap', async () => {
    const graph = buildGraph(await cast())
    const layout = layoutTree(graph, computed(await viewNamed('everyone')))
    const at = (id: string): number => layout.nodes.find((n) => n.id === id)!.x

    // A couple that drifts apart stops reading as a couple, so the separation
    // pass pins partners rather than merely keeping them from overlapping.
    //
    // Only for couples *adjacent* in their row: someone with two spouses can be
    // next to one of them at most, and the other lands on the far side.
    for (const union of layout.unions) {
      if (union.partnerIds.length !== 2) continue
      const [a, b] = union.partnerIds
      const na = layout.nodes.find((n) => n.id === a)
      const nb = layout.nodes.find((n) => n.id === b)
      if (!na || !nb || na.gen !== nb.gen) continue

      const row = layout.byGeneration.get(na.gen)!.map((n) => n.id)
      if (Math.abs(row.indexOf(a) - row.indexOf(b)) !== 1) continue

      expect({ union: union.id, gap: Math.round(Math.abs(at(b) - at(a))) }).toEqual({
        union: union.id,
        gap: DEFAULT_SETTINGS.nodeWidth + DEFAULT_SETTINGS.partnerGap
      })
    }
  })

  it('renders one dataset as several different trees', async () => {
    // Deliberately names nobody: this asserts that the filters *separate* the
    // sides, which stays true however the fixture's people are spelled.
    const graph = buildGraph(await cast())
    const ids = (v: View): string[] =>
      layoutTree(graph, computed(v))
        .nodes.map((n) => n.id)
        .sort()

    const all = await viewsOf()
    const everyone = ids(await viewNamed('everyone'))
    const sides = all.filter((v) => v.root)
    expect(sides.length).toBeGreaterThan(0)

    for (const side of sides) {
      const shown = ids(side)
      // Each side is a subset of everyone — not a *strict* one: as a real family
      // fills in, marriages can connect it densely enough that a one-sided view
      // legitimately reaches everybody. That filters genuinely separate two
      // families is asserted on a controlled fixture instead, in
      // family-selection.test.ts (`twoFamiliesJoined`).
      expect(shown.length).toBeLessThanOrEqual(everyone.length)
      for (const id of shown) expect(everyone).toContain(id)
      // A view contains its own root, when that root still exists. A view whose
      // root was deleted falls back to everyone — real behaviour, flagged in the
      // tree settings panel rather than asserted against here.
      if (graph.byId.has(side.root!)) expect(shown).toContain(side.root)
    }
  })

  it('honours childDepth 0 as ancestors-only', async () => {
    const graph = buildGraph(await cast())
    const view = computed(await viewNamed('rowan-ancestors'))
    expect(view.childDepth).toBe(0)

    const ids = new Set(layoutTree(graph, view).nodes.map((n) => n.id))
    const rootId = view.root!

    // At least one ancestor is present...
    const parents = [graph.byId.get(rootId)?.father, graph.byId.get(rootId)?.mother].filter(Boolean)
    expect(parents.some((p) => ids.has(p as string))).toBe(true)

    // ...and no descendant of the root is, however deep.
    const descendants = new Set<string>()
    const walk = (id: string): void => {
      for (const child of graph.childrenOf.get(id) ?? []) {
        if (descendants.has(child)) continue
        descendants.add(child)
        walk(child)
      }
    }
    walk(rootId)
    for (const d of descendants) expect({ id: d, shown: ids.has(d) }).toEqual({ id: d, shown: false })
  })
})

describe('hand-edited state in the fixture', () => {
  it('places everyone exactly where they were put', async () => {
    const graph = buildGraph(await cast())
    for (const view of await viewsOf()) {
      const moved = Object.keys(view.overrides)
      if (!moved.length) continue // nobody has been dragged in this view yet

      const withEdits = layoutTree(graph, view)
      for (const id of moved) {
        if (!graph.byId.has(id) || view.hidden.includes(id)) continue
        const node = withEdits.nodes.find((n) => n.id === id)
        expect(node).toBeDefined()
        expect(node!.pinned).toBe(true)
        expect(node!.x).toBeCloseTo(view.overrides[id].x, 3)
        expect(node!.y).toBeCloseTo(view.overrides[id].y, 3)
      }
    }
  })

  it('shows an arranged view’s members regardless of its filters', async () => {
    const graph = buildGraph(await cast())
    for (const view of await viewsOf()) {
      if (!view.arranged) continue

      // Membership is the override list, not the filters — importing someone the
      // filter excludes must still put them on the canvas.
      const shown = new Set(layoutTree(graph, view).nodes.map((n) => n.id))
      for (const id of Object.keys(view.overrides)) {
        if (!graph.byId.has(id) || view.hidden.includes(id)) continue
        expect({ id, shown: shown.has(id) }).toEqual({ id, shown: true })
      }
    }
  })
})
