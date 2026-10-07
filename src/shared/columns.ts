/**
 * The column hierarchy as a tree (Issue #104).
 *
 * A board's columns are `TimelineUnit`s (leaves — the only things a card can sit
 * on) grouped under `ColumnGroup`s (Novel, Part, Chapter … any depth). Both carry
 * a `parent` and a sibling-relative `order`, so the sequence the board draws is a
 * depth-first walk, not a sort on one global number.
 *
 * Pure and shared: the grid layout, the IPC handlers that move things around and
 * the delete confirmation all need the same answers, and none of them should
 * re-derive "what is under this group" for themselves.
 *
 * Hand-edited files can be inconsistent — a `parent` naming a group that no
 * longer exists, or two groups naming each other. Reads are lenient everywhere
 * else in the app, so an inconsistent node is **repaired to top level** here
 * rather than hidden or looped over.
 */
import type { ColumnGroup, TimelineUnit } from './types'

export type ColumnKind = 'node' | 'unit'

/** A reference to one thing in the tree. Ids are only unique within a kind. */
export interface ColumnRef {
  kind: ColumnKind
  id: string
}

export type ColumnItem =
  | { kind: 'node'; node: ColumnGroup }
  | { kind: 'unit'; unit: TimelineUnit }

/** An item found under a group, with how far below it sits (1 = a direct child). */
export type ColumnDescendant = ColumnItem & { depth: number }

/** A change to where something sits: its parent and its place among siblings. */
export interface ColumnPlacement {
  ref: ColumnRef
  /** New parent group id; null = top level. */
  parent: string | null
  /** New 1-based order among the new siblings. */
  order: number
}

export const refOf = (item: ColumnItem): ColumnRef =>
  item.kind === 'node' ? { kind: 'node', id: item.node.id } : { kind: 'unit', id: item.unit.id }

export const sameRef = (a: ColumnRef, b: ColumnRef): boolean => a.kind === b.kind && a.id === b.id

const itemOrder = (item: ColumnItem): number => (item.kind === 'node' ? item.node.order : item.unit.order)
const itemLabel = (item: ColumnItem): string => (item.kind === 'node' ? item.node.label : item.unit.label)
const itemId = (item: ColumnItem): string => (item.kind === 'node' ? item.node.id : item.unit.id)

/** Siblings sort by `order`; ties put groups first, then fall back to label and id so it is stable. */
function compareItems(a: ColumnItem, b: ColumnItem): number {
  return (
    itemOrder(a) - itemOrder(b) ||
    (a.kind === b.kind ? 0 : a.kind === 'node' ? -1 : 1) ||
    itemLabel(a).localeCompare(itemLabel(b)) ||
    itemId(a).localeCompare(itemId(b))
  )
}

export interface ColumnTree {
  /** The items directly under `parentId`, in display order. `null` = top level. */
  childrenOf(parentId: string | null): ColumnItem[]
  /** The group an item effectively sits under (after repair); null = top level. */
  parentOf(ref: ColumnRef): string | null
  /** 0 for a top-level item, 1 for a child of a top-level group, and so on. */
  depthOf(ref: ColumnRef): number
  node(id: string): ColumnGroup | undefined
}

export function buildColumnTree(colGroups: ColumnGroup[], timeline: TimelineUnit[]): ColumnTree {
  const nodes = new Map(colGroups.map((g) => [g.id, g]))

  // A group is "in a cycle" iff walking its parents leads back to itself. Such
  // groups are lifted to top level; a group merely *under* a cycle keeps its
  // parent, which is now top level, so it stays attached to something sensible.
  const inCycle = (g: ColumnGroup): boolean => {
    let cur = g.parent !== undefined ? nodes.get(g.parent) : undefined
    for (let steps = 0; cur && steps <= nodes.size; steps++) {
      if (cur.id === g.id) return true
      cur = cur.parent !== undefined ? nodes.get(cur.parent) : undefined
    }
    return false
  }

  const nodeParent = new Map<string, string | null>()
  for (const g of colGroups) {
    const ok = g.parent !== undefined && g.parent !== g.id && nodes.has(g.parent) && !inCycle(g)
    nodeParent.set(g.id, ok ? (g.parent as string) : null)
  }
  const unitParent = new Map<string, string | null>()
  for (const u of timeline) {
    unitParent.set(u.id, u.parent !== undefined && nodes.has(u.parent) ? u.parent : null)
  }

  const children = new Map<string | null, ColumnItem[]>()
  const push = (parent: string | null, item: ColumnItem): void => {
    const list = children.get(parent)
    if (list) list.push(item)
    else children.set(parent, [item])
  }
  for (const g of colGroups) push(nodeParent.get(g.id) ?? null, { kind: 'node', node: g })
  for (const u of timeline) push(unitParent.get(u.id) ?? null, { kind: 'unit', unit: u })
  for (const list of children.values()) list.sort(compareItems)

  const parentOf = (ref: ColumnRef): string | null =>
    (ref.kind === 'node' ? nodeParent.get(ref.id) : unitParent.get(ref.id)) ?? null

  return {
    childrenOf: (parentId) => children.get(parentId) ?? [],
    parentOf,
    depthOf(ref) {
      let depth = 0
      for (let p = parentOf(ref); p !== null; p = parentOf({ kind: 'node', id: p })) depth++
      return depth
    },
    node: (id) => nodes.get(id)
  }
}

/**
 * Every unit in the order the board draws its columns: a depth-first walk, so a
 * group's units sit together wherever the group sits. This is the single "column
 * order" that card spans (`colStart`…`colEnd`) are measured against.
 */
export function orderedLeaves(colGroups: ColumnGroup[], timeline: TimelineUnit[]): TimelineUnit[] {
  const tree = buildColumnTree(colGroups, timeline)
  const out: TimelineUnit[] = []
  const walk = (parentId: string | null): void => {
    for (const item of tree.childrenOf(parentId)) {
      if (item.kind === 'unit') out.push(item.unit)
      else walk(item.node.id)
    }
  }
  walk(null)
  return out
}

/** Everything under a group — groups and columns — in display order. */
export function collectColumnDescendants(
  colGroups: ColumnGroup[],
  timeline: TimelineUnit[],
  nodeId: string
): ColumnDescendant[] {
  const tree = buildColumnTree(colGroups, timeline)
  const out: ColumnDescendant[] = []
  const walk = (parentId: string, depth: number): void => {
    for (const item of tree.childrenOf(parentId)) {
      out.push({ ...item, depth })
      if (item.kind === 'node') walk(item.node.id, depth + 1)
    }
  }
  walk(nodeId, 1)
  return out
}

/**
 * Whether `ref` may be moved under `newParentId`. A group can't go under itself
 * or anything inside it; anything else can go anywhere that exists.
 */
export function canMoveUnder(
  tree: ColumnTree,
  ref: ColumnRef,
  newParentId: string | null
): boolean {
  if (newParentId === null) return true
  if (!tree.node(newParentId)) return false
  if (ref.kind === 'unit') return true
  for (let p: string | null = newParentId; p !== null; p = tree.parentOf({ kind: 'node', id: p })) {
    if (p === ref.id) return false
  }
  return true
}

/** The order a new item should take to land last under `parentId`. */
export function nextOrder(tree: ColumnTree, parentId: string | null): number {
  const siblings = tree.childrenOf(parentId)
  return siblings.length === 0 ? 1 : Math.max(...siblings.map(itemOrder)) + 1
}

/**
 * Renumber a complete, ordered sibling list under `parent`, returning only the
 * placements that actually change something. Orders are 1-based and contiguous.
 */
function renumber(
  tree: ColumnTree,
  items: ColumnItem[],
  parent: string | null
): ColumnPlacement[] {
  const out: ColumnPlacement[] = []
  items.forEach((item, i) => {
    const ref = refOf(item)
    const order = i + 1
    if (itemOrder(item) !== order || tree.parentOf(ref) !== parent) out.push({ ref, parent, order })
  })
  return out
}

const findItem = (tree: ColumnTree, ref: ColumnRef): ColumnItem | undefined =>
  tree.childrenOf(tree.parentOf(ref)).find((it) => sameRef(refOf(it), ref))

/**
 * Put the siblings of `parentId` in the order given by `refs`. Anything under
 * the parent that `refs` leaves out keeps its relative order, after the named
 * ones, so a stale list from the UI can never drop a column from the board.
 */
export function planReorder(
  tree: ColumnTree,
  parentId: string | null,
  refs: ColumnRef[]
): ColumnPlacement[] {
  const current = tree.childrenOf(parentId)
  const named = refs
    .map((r) => current.find((it) => sameRef(refOf(it), r)))
    .filter((it): it is ColumnItem => it !== undefined)
  const rest = current.filter((it) => !named.includes(it))
  return renumber(tree, [...named, ...rest], parentId)
}

/**
 * Move `ref` under `newParentId` so it lands at `index` among that parent's other
 * children (0 = first; omitted or past the end = last). Returns `null` when the
 * move is not allowed — a group into its own subtree — or the item doesn't exist.
 *
 * Both the old and new sibling lists are renumbered, because pulling something
 * out of the middle would otherwise leave a gap behind it.
 */
export function planMove(
  tree: ColumnTree,
  ref: ColumnRef,
  newParentId: string | null,
  index?: number
): ColumnPlacement[] | null {
  const item = findItem(tree, ref)
  if (!item || !canMoveUnder(tree, ref, newParentId)) return null

  const oldParent = tree.parentOf(ref)
  const target = tree.childrenOf(newParentId).filter((it) => !sameRef(refOf(it), ref))
  const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length))
  target.splice(at, 0, item)

  const placements = renumber(tree, target, newParentId)
  if (oldParent !== newParentId) {
    const left = tree.childrenOf(oldParent).filter((it) => !sameRef(refOf(it), ref))
    placements.push(...renumber(tree, left, oldParent))
  }
  return placements
}

/** Where, relative to a row, something was dropped. */
export type DropPosition = 'before' | 'inside' | 'after'

/**
 * Turn "dropped `dragged` on `target`, at this position" into the parent and index
 * to move it to — or `null` when that is not a legal drop (onto itself, a group
 * into its own subtree, `inside` a column). `index` counts the new siblings with
 * the dragged item already taken out, which is what `planMove` expects.
 */
export function planDrop(
  tree: ColumnTree,
  dragged: ColumnRef,
  target: ColumnRef,
  position: DropPosition
): { parent: string | null; index?: number } | null {
  if (sameRef(dragged, target)) return null
  if (position === 'inside') {
    if (target.kind !== 'node') return null
    return canMoveUnder(tree, dragged, target.id) ? { parent: target.id } : null
  }
  const parent = tree.parentOf(target)
  if (!canMoveUnder(tree, dragged, parent)) return null
  const siblings = tree.childrenOf(parent).filter((it) => !sameRef(refOf(it), dragged))
  const at = siblings.findIndex((it) => sameRef(refOf(it), target))
  if (at < 0) return null
  return { parent, index: position === 'before' ? at : at + 1 }
}
