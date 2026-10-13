/**
 * Focused live-reload (#131).
 *
 * `watcher.ts` already says exactly which entity changed on disk. Rather than
 * re-read every board on an external edit (O(all files)), the renderer plans a
 * focused reload: the main process loads just the touched slices and returns a
 * {@link ProjectPatch}, which `applyProjectPatch` merges into the existing
 * snapshot (O(touched files)).
 *
 * Both functions are pure — no filesystem, no IPC — so the planning rules and the
 * merge semantics are unit-tested directly.
 */
import type { Board, Character, ColumnGroup, Note, Project, TimelineUnit, View } from './types'
import type { BoardData, ProjectSnapshot } from './ipc'
import type { ProjectChange } from './changes'
import { buildGraph } from './graph'

/**
 * One resolved reload operation. For `add`/`change` the main process has read the
 * file and `value` holds the fresh entity; for a removal (`unlink`, or a file that
 * vanished before it could be read) `value` is null. The `project` and `board`
 * targets always carry their value — they are only ever re-read, never removed by
 * a patch (a removed board goes through a full reload, see {@link planReload}).
 */
export type PatchOp =
  | { target: 'project'; project: Project }
  | { target: 'board'; boardId: string; board: Board }
  | { target: 'character'; boardId: string; id: string; value: Character | null }
  | { target: 'timeline'; boardId: string; id: string; value: TimelineUnit | null }
  | { target: 'colgroup'; boardId: string; id: string; value: ColumnGroup | null }
  | { target: 'note'; boardId: string; id: string; value: Note | null }
  | { target: 'view'; boardId: string; id: string; value: View | null }

export interface ProjectPatch {
  ops: PatchOp[]
}

export type ReloadPlan = { mode: 'full' } | { mode: 'focused'; changes: ProjectChange[] }

/**
 * Decide whether a batch of changes can be reloaded focus-only, or needs the old
 * full reload. A change needs a full reload when it would add or remove a whole
 * board (there is nothing in the snapshot to patch), or names a board the snapshot
 * doesn't know about. Everything else — a note/character/timeline/colgroup/view
 * edit, a `board.json` content change, a `project.json` edit — is focusable.
 *
 * It's all-or-nothing per batch: one board-structural change forces the whole
 * batch full, which keeps the merge simple and is safe because such events are
 * rare next to ordinary content edits.
 */
export function planReload(snapshot: ProjectSnapshot, changes: ProjectChange[]): ReloadPlan {
  if (changes.length === 0) return { mode: 'focused', changes: [] }
  const boardIds = new Set(snapshot.boards.map((bd) => bd.board.id))

  for (const change of changes) {
    if (change.kind === 'project') continue
    // A board whose folder appeared or vanished changes the board set itself.
    if (change.kind === 'board') {
      if (change.type === 'unlink') return { mode: 'full' }
      if (!change.boardId || !boardIds.has(change.boardId)) return { mode: 'full' }
      continue
    }
    // Per-board entity: patchable only when we already hold its board.
    if (!change.boardId || !boardIds.has(change.boardId)) return { mode: 'full' }
  }
  return { mode: 'focused', changes }
}

/** Upsert `value` into `list` by id, or remove it when `value` is null. */
function upsert<T extends { id: string }>(list: T[], id: string, value: T | null): T[] {
  if (value === null) return list.filter((x) => x.id !== id)
  const at = list.findIndex((x) => x.id === id)
  if (at === -1) return [...list, value]
  const next = list.slice()
  next[at] = value
  return next
}

const byOrder = <T extends { order: number }>(a: T, b: T): number => a.order - b.order

/**
 * Reorder a board list to match `project.boards`, mirroring `loadSnapshot`: the
 * ids listed there (and still present) come first in that order, then any extra
 * boards keep their current order. No board is ever dropped.
 */
function reorderBoards(boards: BoardData[], order: string[]): BoardData[] {
  const present = new Set(boards.map((bd) => bd.board.id))
  const ordered = order.filter((id) => present.has(id))
  const extra = boards.filter((bd) => !ordered.includes(bd.board.id)).map((bd) => bd.board.id)
  const seq = [...ordered, ...extra]
  // Already in order? keep the same array identity.
  if (seq.every((id, i) => boards[i]?.board.id === id)) return boards
  return seq.map((id) => boards.find((bd) => bd.board.id === id)!)
}

/**
 * Merge a focused patch into a snapshot, returning a new snapshot. Only the
 * touched boards get new object identities, so React memos keyed on an untouched
 * board (or its character array) don't re-run. The one derived board-level field,
 * `problems`, is recomputed for any board whose characters changed — the same
 * `buildGraph` the loader runs, kept here so the renderer never falls out of sync.
 */
export function applyProjectPatch(snapshot: ProjectSnapshot, patch: ProjectPatch): ProjectSnapshot {
  let project = snapshot.project
  // Per board: the working copy (cloned lazily) and whether its cast changed.
  const edited = new Map<string, BoardData>()
  const castChanged = new Set<string>()

  const working = (boardId: string): BoardData | null => {
    if (edited.has(boardId)) return edited.get(boardId)!
    const current = snapshot.boards.find((bd) => bd.board.id === boardId)
    if (!current) return null
    const copy = { ...current }
    edited.set(boardId, copy)
    return copy
  }

  for (const op of patch.ops) {
    if (op.target === 'project') {
      project = op.project
      continue
    }
    const bd = working(op.boardId)
    // A board we no longer hold (e.g. deleted by another op): nothing to patch.
    if (!bd) continue
    switch (op.target) {
      case 'board':
        bd.board = op.board
        break
      case 'character':
        bd.characters = upsert(bd.characters, op.id, op.value)
        castChanged.add(op.boardId)
        break
      case 'timeline':
        bd.timeline = upsert(bd.timeline, op.id, op.value).sort(byOrder)
        break
      case 'colgroup':
        bd.colGroups = upsert(bd.colGroups, op.id, op.value).sort(byOrder)
        break
      case 'note':
        bd.notes = upsert(bd.notes, op.id, op.value)
        break
      case 'view':
        bd.views = upsert(bd.views, op.id, op.value)
        break
    }
  }

  for (const boardId of castChanged) {
    const bd = edited.get(boardId)!
    bd.problems = buildGraph(bd.characters).problems
  }

  if (edited.size === 0 && project === snapshot.project) return snapshot

  let boards = snapshot.boards.map((bd) => edited.get(bd.board.id) ?? bd)
  // A project.json edit can have reordered the boards.
  if (project !== snapshot.project) boards = reorderBoards(boards, project.boards)

  return { ...snapshot, project, boards }
}
