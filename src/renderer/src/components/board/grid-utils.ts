import type { Board, Card, Character, Note, TimelineUnit } from '@shared/types'

/** Columns visible on a board: timeline ordered by `order`, minus hidden. */
export function visibleColumns(board: Board, timeline: TimelineUnit[]): TimelineUnit[] {
  const ordered = [...timeline].sort((a, b) => a.order - b.order)
  return ordered.filter((u) => !board.hiddenCols.includes(u.id))
}

/** Full timeline order as id→position, used to resolve spans across hidden cols. */
export function timelinePositions(timeline: TimelineUnit[]): Map<string, number> {
  const ordered = [...timeline].sort((a, b) => a.order - b.order)
  return new Map(ordered.map((u, i) => [u.id, i]))
}

/** Ordered timeline ids (low→high), for width-preserving moves/resizes. */
export function orderedColumnIds(timeline: TimelineUnit[]): string[] {
  return [...timeline].sort((a, b) => a.order - b.order).map((u) => u.id)
}

/**
 * The board's cast, in display order — `rowOrder` first, then the rest by name.
 *
 * Membership is `board.members` when set. `null` means a board written before
 * v0.6.0, where having a character file *was* being on the board, so it keeps
 * that meaning: everyone. Hidden rows are still members — hiding is temporary,
 * not-a-member is "this character isn't in this story".
 */
export function boardMembers(board: Board, characters: Character[]): Character[] {
  const allowed = board.members
  const pool = allowed ? characters.filter((c) => allowed.includes(c.id)) : characters

  const byId = new Map(pool.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const ordered: Character[] = []
  for (const id of board.rowOrder) {
    const c = byId.get(id)
    if (c) {
      ordered.push(c)
      seen.add(id)
    }
  }
  const rest = pool.filter((c) => !seen.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))
  return [...ordered, ...rest]
}

/**
 * Characters in the board's folder that are *not* on its grid — the pool the
 * "+ Character" picker offers. Empty for a legacy (`members: null`) board,
 * because everyone is already a row there.
 */
export function nonMembers(board: Board, characters: Character[]): Character[] {
  if (!board.members) return []
  const on = new Set(board.members)
  return characters.filter((c) => !on.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))
}

/** Rows drawn on a board: its cast, minus the ones hidden for now. */
export function visibleRows(board: Board, characters: Character[]): Character[] {
  return boardMembers(board, characters).filter((c) => !board.hiddenRows.includes(c.id))
}

/**
 * The board with `members` turned into a concrete list, so the first curating
 * action on a legacy board converts it rather than silently doing nothing.
 * Returns the board unchanged when it already has a list.
 */
export function withMaterializedMembers(board: Board, characters: Character[]): Board {
  if (board.members) return board
  return { ...board, members: boardMembers(board, characters).map((c) => c.id) }
}

/** The board with `id` added to its cast (materializing a legacy board first). */
export function addBoardMember(board: Board, characters: Character[], id: string): Board {
  const next = withMaterializedMembers(board, characters)
  if (next.members!.includes(id)) return next
  return { ...next, members: [...next.members!, id] }
}

/**
 * The board with `id` taken off its grid. The character file is untouched — this
 * is "not in this story", not a delete — so its cards go, along with its place in
 * the order and any stale hidden/row entries.
 */
export function removeBoardMember(board: Board, characters: Character[], id: string): Board {
  const next = withMaterializedMembers(board, characters)
  return {
    ...next,
    members: next.members!.filter((m) => m !== id),
    cards: next.cards.filter((c) => c.rowId !== id),
    rowOrder: next.rowOrder.filter((r) => r !== id),
    rowGroupOrder: next.rowGroupOrder.filter((k) => k !== id),
    hiddenRows: next.hiddenRows.filter((r) => r !== id)
  }
}

/** Resolve a card's backing note by its stable uid (rename-safe). */
export function noteForCard(notes: Note[], noteUid: string): Note | undefined {
  return notes.find((n) => n.uid === noteUid)
}

export function truncate(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export interface ResolvedSpan {
  startIdx: number
  endIdx: number
}

/**
 * Resolve a card's column span to visible-column indices, honouring the
 * show/hide rules (§8.2): anchor to the first/last visible column within the
 * span's range; return null if the whole span is hidden. Pure helper used in
 * tests and as the basis for the grouped layout's column placement.
 */
export function resolveSpan(
  colStart: string,
  colEnd: string,
  visibleCols: TimelineUnit[],
  positions: Map<string, number>
): ResolvedSpan | null {
  const a = positions.get(colStart)
  const b = positions.get(colEnd)
  if (a == null || b == null) return null
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const within = visibleCols.filter((c) => {
    const p = positions.get(c.id)
    return p != null && p >= lo && p <= hi
  })
  if (within.length === 0) return null
  const startIdx = visibleCols.findIndex((c) => c.id === within[0].id)
  const endIdx = visibleCols.findIndex((c) => c.id === within[within.length - 1].id)
  return { startIdx, endIdx }
}

// ── Grouping layout ──────────────────────────────────────────────────────────

/**
 * Gather an ordered list into blocks keyed by `group`. All members of a group
 * are collected into one block (so e.g. all "Fae" rows sit together), and
 * blocks are emitted in order of each group's first appearance. Ungrouped
 * items each form their own solo block.
 */
function gatherBlocks<T>(items: T[], groupOf: (t: T) => string | undefined): Array<{ group: string | null; members: T[] }> {
  const order: string[] = []
  const map = new Map<string, { group: string | null; members: T[] }>()
  let solo = 0
  for (const item of items) {
    const g = groupOf(item)
    const key = g ?? `__solo_${solo++}`
    if (!map.has(key)) {
      order.push(key)
      map.set(key, { group: g ?? null, members: [] })
    }
    map.get(key)!.members.push(item)
  }
  return order.map((k) => map.get(k)!)
}

export type ColSlot =
  | { kind: 'col'; index: number; unit: TimelineUnit; group: string | null }
  | { kind: 'colGroup'; index: number; group: string; members: TimelineUnit[] }

export interface ColHeader {
  group: string
  startIndex: number
  span: number
  collapsed: boolean
}

export interface ColumnLayout {
  slots: ColSlot[]
  headers: ColHeader[]
  /** Visible unit id → slot index (collapsed members map to their group slot). */
  slotOfUnit: Map<string, number>
  hasGroups: boolean
}

export function buildColumnLayout(board: Board, timeline: TimelineUnit[]): ColumnLayout {
  const visible = visibleColumns(board, timeline)
  const blocks = gatherBlocks(visible, (u) => u.group)
  const slots: ColSlot[] = []
  const headers: ColHeader[] = []
  const slotOfUnit = new Map<string, number>()
  let hasGroups = false

  for (const block of blocks) {
    if (block.group != null) {
      hasGroups = true
      const collapsed = board.collapsedColGroups.includes(block.group)
      if (collapsed) {
        const index = slots.length
        slots.push({ kind: 'colGroup', index, group: block.group, members: block.members })
        block.members.forEach((m) => slotOfUnit.set(m.id, index))
        headers.push({ group: block.group, startIndex: index, span: 1, collapsed: true })
      } else {
        const startIndex = slots.length
        for (const unit of block.members) {
          const index = slots.length
          slots.push({ kind: 'col', index, unit, group: block.group })
          slotOfUnit.set(unit.id, index)
        }
        headers.push({ group: block.group, startIndex, span: block.members.length, collapsed: false })
      }
    } else {
      const unit = block.members[0]
      const index = slots.length
      slots.push({ kind: 'col', index, unit, group: null })
      slotOfUnit.set(unit.id, index)
    }
  }

  return { slots, headers, slotOfUnit, hasGroups }
}

export type RowLine =
  | { kind: 'row'; index: number; char: Character; group: string | null }
  | { kind: 'groupHeader'; index: number; group: string }
  | { kind: 'groupRow'; index: number; group: string; members: Character[] }

export interface RowLayout {
  lines: RowLine[]
  /** Character id → line index (collapsed members map to their group's row line). */
  lineOfChar: Map<string, number>
  hasGroups: boolean
}

/** Top-level block key for a row block: group label, or the char id when ungrouped. */
function rowBlockKey(block: { group: string | null; members: Character[] }): string {
  return block.group ?? block.members[0].id
}

export function buildRowLayout(board: Board, characters: Character[]): RowLayout {
  const visible = visibleRows(board, characters)
  // Members within a group follow `visible` (rowOrder then name); blocks are
  // gathered together, then sequenced by `rowGroupOrder` (stable for the rest).
  const gathered = gatherBlocks(visible, (c) => c.group)
  const goIndex = (key: string): number => {
    const i = board.rowGroupOrder.indexOf(key)
    return i < 0 ? Infinity : i
  }
  const blocks = gathered
    .map((b, i) => ({ b, i }))
    .sort((x, y) => goIndex(rowBlockKey(x.b)) - goIndex(rowBlockKey(y.b)) || x.i - y.i)
    .map((o) => o.b)

  const lines: RowLine[] = []
  const lineOfChar = new Map<string, number>()
  let hasGroups = false

  for (const block of blocks) {
    if (block.group != null) {
      hasGroups = true
      const collapsed = board.collapsedRowGroups.includes(block.group)
      if (collapsed) {
        const index = lines.length
        lines.push({ kind: 'groupRow', index, group: block.group, members: block.members })
        block.members.forEach((c) => lineOfChar.set(c.id, index))
      } else {
        lines.push({ kind: 'groupHeader', index: lines.length, group: block.group })
        for (const char of block.members) {
          const index = lines.length
          lines.push({ kind: 'row', index, char, group: block.group })
          lineOfChar.set(char.id, index)
        }
      }
    } else {
      const char = block.members[0]
      const index = lines.length
      lines.push({ kind: 'row', index, char, group: null })
      lineOfChar.set(char.id, index)
    }
  }

  return { lines, lineOfChar, hasGroups }
}

/** Visible units within a card's [colStart..colEnd] range, in display order. */
function unitsInSpan(
  colStart: string,
  colEnd: string,
  visible: TimelineUnit[],
  positions: Map<string, number>
): TimelineUnit[] {
  const a = positions.get(colStart)
  const b = positions.get(colEnd)
  if (a == null || b == null) return []
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return visible.filter((u) => {
    const p = positions.get(u.id)
    return p != null && p >= lo && p <= hi
  })
}

export interface PlacedCard {
  card: Card
  note: Note | undefined
  lineIndex: number
  startSlot: number
  endSlot: number
  colour: string
  /**
   * Which level within the row this card sits on (Issue #66).
   *
   * 0 for a card that shares its span with nothing. Cards on the same row whose
   * column spans overlap get successive levels and are drawn stacked, so a cell
   * can hold more than one card instead of them landing on top of each other.
   */
  stackIndex: number
}

export interface BoardLayout {
  cols: ColumnLayout
  rows: RowLayout
  fullCards: PlacedCard[]
  /** Marker counts for collapsed regions, keyed `lineIndex:slotIndex`. */
  markers: Map<string, number>
  /**
   * How many stack levels each row line needs (Issue #66). Keyed by
   * `lineIndex`; absent means one. The grid uses it to grow the row track.
   */
  stackDepth: Map<number, number>
}

export const markerKey = (lineIndex: number, slotIndex: number): string => `${lineIndex}:${slotIndex}`

/**
 * Assign each card on a row a stack level, so overlapping cards sit above one
 * another rather than on top of each other (Issue #66).
 *
 * Classic greedy interval colouring: take the cards left to right and drop each
 * onto the first level whose previous card has already ended. Cards that do not
 * overlap therefore stay on level 0 and a board that never stacks looks exactly
 * as it did before.
 *
 * Mutates `stackIndex` in place and returns the depth needed.
 */
function assignStackLevels(cards: PlacedCard[]): number {
  const ordered = [...cards].sort((a, b) => a.startSlot - b.startSlot || a.endSlot - b.endSlot)
  /** Last occupied slot on each level. */
  const levelEnds: number[] = []

  for (const pc of ordered) {
    let level = levelEnds.findIndex((end) => end < pc.startSlot)
    if (level === -1) level = levelEnds.length
    levelEnds[level] = pc.endSlot
    pc.stackIndex = level
  }
  return Math.max(1, levelEnds.length)
}

/**
 * Compute the full board layout: column slots/headers, row lines, placed cards,
 * and marker counts for cards that fall inside a collapsed group.
 */
export function buildBoardLayout(
  board: Board,
  characters: Character[],
  timeline: TimelineUnit[],
  notes: Note[]
): BoardLayout {
  const cols = buildColumnLayout(board, timeline)
  const rows = buildRowLayout(board, characters)
  const positions = timelinePositions(timeline)
  const visible = visibleColumns(board, timeline)
  const charById = new Map(characters.map((c) => [c.id, c]))
  const collapsedColSlot = new Set(
    cols.slots.filter((s) => s.kind === 'colGroup').map((s) => s.index)
  )

  const fullCards: PlacedCard[] = []
  const markers = new Map<string, number>()
  const addMarker = (line: number, slot: number): void => {
    const k = markerKey(line, slot)
    markers.set(k, (markers.get(k) ?? 0) + 1)
  }

  for (const card of board.cards) {
    const lineIndex = rows.lineOfChar.get(card.rowId)
    if (lineIndex == null) continue // character hidden
    const within = unitsInSpan(card.colStart, card.colEnd, visible, positions)
    if (within.length === 0) continue // whole span hidden

    const slotIdxs = within.map((u) => cols.slotOfUnit.get(u.id)!).filter((i) => i != null)
    if (slotIdxs.length === 0) continue
    const startSlot = Math.min(...slotIdxs)
    const endSlot = Math.max(...slotIdxs)

    const rowCollapsed = rows.lines[lineIndex].kind === 'groupRow'
    const colCollapsed = slotIdxs.some((i) => collapsedColSlot.has(i))

    if (rowCollapsed || colCollapsed) {
      addMarker(lineIndex, startSlot)
    } else {
      const char = charById.get(card.rowId)
      fullCards.push({
        card,
        note: noteForCard(notes, card.noteUid),
        lineIndex,
        startSlot,
        endSlot,
        colour: char?.colour ?? '#888',
        stackIndex: 0
      })
    }
  }

  // Stack levels are per row line, so each line is coloured independently.
  const stackDepth = new Map<number, number>()
  const byLine = new Map<number, PlacedCard[]>()
  for (const pc of fullCards) {
    const list = byLine.get(pc.lineIndex)
    if (list) list.push(pc)
    else byLine.set(pc.lineIndex, [pc])
  }
  for (const [lineIndex, cards] of byLine) {
    const depth = assignStackLevels(cards)
    if (depth > 1) stackDepth.set(lineIndex, depth)
  }

  return { cols, rows, fullCards, markers, stackDepth }
}

// ── Reordering (custom row/group sort, persisted in board JSON) ──────────────

/**
 * New `rowOrder` after moving `draggedId` to sit immediately before
 * `targetId`. Only reorders within the same group; cross-group drops are a
 * no-op (regrouping is done by editing the character's `group`). Returns the
 * full visible order so the saved `rowOrder` is authoritative.
 */
export function reorderRowMember(
  board: Board,
  characters: Character[],
  draggedId: string,
  targetId: string
): string[] {
  const visible = visibleRows(board, characters)
  const dragged = visible.find((c) => c.id === draggedId)
  const target = visible.find((c) => c.id === targetId)
  if (!dragged || !target || dragged.id === target.id) return board.rowOrder
  if ((dragged.group ?? null) !== (target.group ?? null)) return board.rowOrder

  const ids = visible.map((c) => c.id).filter((id) => id !== draggedId)
  const at = ids.indexOf(targetId)
  if (at < 0) return board.rowOrder
  ids.splice(at, 0, draggedId)
  return ids
}

/** Top-level block keys (group labels + ungrouped char ids) in display order. */
export function orderedRowBlockKeys(board: Board, characters: Character[]): string[] {
  const { lines } = buildRowLayout(board, characters)
  const keys: string[] = []
  for (const line of lines) {
    if (line.kind === 'groupHeader' || line.kind === 'groupRow') keys.push(line.group)
    else if (line.kind === 'row' && line.group == null) keys.push(line.char.id)
  }
  return keys
}

/**
 * New `rowGroupOrder` after moving the `draggedKey` block to sit immediately
 * before the `targetKey` block.
 */
export function reorderRowBlocks(
  board: Board,
  characters: Character[],
  draggedKey: string,
  targetKey: string
): string[] {
  if (draggedKey === targetKey) return board.rowGroupOrder
  const keys = orderedRowBlockKeys(board, characters).filter((k) => k !== draggedKey)
  const at = keys.indexOf(targetKey)
  if (at < 0) return board.rowGroupOrder
  keys.splice(at, 0, draggedKey)
  return keys
}
