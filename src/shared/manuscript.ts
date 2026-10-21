/**
 * The Manuscript row (Issue #204): a built-in row at the top of the board whose
 * cells hold the novel's prose, one per column at a chosen level — one per
 * Chapter, say, each spanning that chapter's scenes.
 *
 * The row is not a character. It is added when the board is drawn and saved
 * nowhere; its cards are ordinary cards on {@link MANUSCRIPT_ROW_ID}, each
 * naming the column it belongs to in `cell`. Which columns are cells, and the
 * span each covers, are worked out here from the column tree, so a cell always
 * lines up with its chapter however the scenes under it move.
 *
 * Pure and shared: the board layout, the published site and the export all
 * need the same answers.
 */
import { buildColumnTree, type ColumnItem } from './columns'
import type { BoardData } from './ipc'
import {
  MANUSCRIPT_ROW_ID,
  type Card,
  type ColumnGroup,
  type ManuscriptCellRef,
  type Project,
  type TimelineUnit
} from './types'

export { MANUSCRIPT_ROW_ID }

/** One cell of the Manuscript row: a column at the chosen level. */
export interface ManuscriptCell {
  ref: ManuscriptCellRef
  /** The column's name — "Chapter 3". A new cell's note is titled with it. */
  label: string
  /**
   * Every unit under the column, hidden ones included, in board order. The cell
   * spans the first to the last; the layout drops whichever are hidden.
   */
  unitIds: string[]
}

/**
 * The depth the project's Manuscript row snaps to, or null when the project has
 * none. Anything other than a whole number ≥ 0 — a hand-edited project.json —
 * counts as none rather than guessing.
 */
export function manuscriptLevel(project: Pick<Project, 'manuscriptLevel'>): number | null {
  const level = project.manuscriptLevel
  return typeof level === 'number' && Number.isInteger(level) && level >= 0 ? level : null
}

/** A stable string for a cell, for keys and lookups. Ids are unique only within a kind. */
export function cellKey(ref: ManuscriptCellRef): string {
  return `${ref.kind}:${ref.id}`
}

/** True for a card on the Manuscript row. */
export function isManuscriptCard(card: Pick<Card, 'rowId'>): boolean {
  return card.rowId === MANUSCRIPT_ROW_ID
}

/**
 * The Manuscript row's cells at `level`, in board order.
 *
 * A cell is every column at that depth, plus any shallower column with nothing
 * under it — a chapter with no scenes, when the cells are scenes — so every unit
 * on the board is in exactly one cell. A group with no units under it has
 * nothing to span and is no cell.
 */
export function manuscriptCells(
  colGroups: ColumnGroup[],
  timeline: TimelineUnit[],
  level: number
): ManuscriptCell[] {
  const tree = buildColumnTree(colGroups, timeline)

  const unitsUnder = (item: ColumnItem): string[] => {
    if (item.kind === 'unit') return [item.unit.id]
    return tree.childrenOf(item.node.id).flatMap(unitsUnder)
  }

  const cells: ManuscriptCell[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const item of tree.childrenOf(parentId)) {
      if (item.kind === 'node' && depth < level) {
        walk(item.node.id, depth + 1)
        continue
      }
      const unitIds = unitsUnder(item)
      if (unitIds.length === 0) continue
      cells.push(
        item.kind === 'node'
          ? { ref: { kind: 'node', id: item.node.id }, label: item.node.label, unitIds }
          : { ref: { kind: 'unit', id: item.unit.id }, label: item.unit.label, unitIds }
      )
    }
  }
  walk(null, 0)
  return cells
}

/**
 * A board with its manuscript taken out, for a published site that should not
 * carry the draft (Issue #204): the Manuscript row's cards go, and so does every
 * note only they pointed at. A note some other card also uses stays.
 */
export function withoutManuscript(data: BoardData): BoardData {
  if (!data.board.cards.some(isManuscriptCard)) return data
  const cards = data.board.cards.filter((c) => !isManuscriptCard(c))
  const kept = new Set(cards.map((c) => c.noteUid))
  const dropped = new Set(
    data.board.cards.filter((c) => isManuscriptCard(c) && !kept.has(c.noteUid)).map((c) => c.noteUid)
  )
  return {
    ...data,
    board: { ...data.board, cards },
    notes: data.notes.filter((n) => n.uid === undefined || !dropped.has(n.uid))
  }
}
