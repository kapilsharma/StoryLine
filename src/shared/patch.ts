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
import type { BoardData, ProjectSnapshot, SnapshotReply } from './ipc'
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

/**
 * Upsert `value` into `list` by id, or remove it when `value` is null. A new
 * entity goes where the loader would have put it — in id order — so a patched
 * snapshot lists things exactly as a fresh `loadSnapshot` does (#187: the project
 * index is a patched snapshot, and must equal a fresh read).
 */
function upsert<T extends { id: string }>(list: T[], id: string, value: T | null): T[] {
  if (value === null) return list.filter((x) => x.id !== id)
  const at = list.findIndex((x) => x.id === id)
  if (at === -1) {
    const before = list.findIndex((x) => byId(x, value) > 0)
    return before === -1 ? [...list, value] : [...list.slice(0, before), value, ...list.slice(before)]
  }
  const next = list.slice()
  next[at] = value
  return next
}

/** Code-unit order, the same as the loader's `Array.prototype.sort()` over file stems. */
const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The loader's column order: by `order`, ties in id order (it sorts ids first, then stably by order). */
const byOrder = <T extends { id: string; order: number }>(a: T, b: T): number => a.order - b.order || byId(a, b)

/**
 * Views in the loader's order: those `board.views` lists first, in that order,
 * then any others in id order. Same array back when nothing moved.
 */
function orderViews(views: View[], order: string[]): View[] {
  const present = new Map(views.map((v) => [v.id, v]))
  const listed = order.filter((id) => present.has(id))
  const listedSet = new Set(listed)
  const rest = views.filter((v) => !listedSet.has(v.id)).sort(byId)
  const next = [...listed.map((id) => present.get(id)!), ...rest]
  return next.every((v, i) => views[i] === v) ? views : next
}

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
  // Boards whose view order may have moved: a view added, or `board.views` re-read.
  const viewsMoved = new Set<string>()

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
        viewsMoved.add(op.boardId)
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
        viewsMoved.add(op.boardId)
        break
    }
  }

  for (const boardId of viewsMoved) {
    const bd = edited.get(boardId)!
    bd.views = orderViews(bd.views, bd.board.views)
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

/** The renderer's copy of the project, and which numbered state of it that is (#188). */
export interface HeldSnapshot {
  snapshot: ProjectSnapshot
  version: number
}

/**
 * Merge a reply into the held copy (#188). A whole snapshot replaces it; a patch
 * applies only onto the exact version it was made from, of the same project.
 * Returns null on a gap — a patch for some other version or project — and the
 * caller must fetch the whole project instead of guessing.
 */
export function applyReply(held: HeldSnapshot | null, reply: SnapshotReply): HeldSnapshot | null {
  if (reply.kind === 'snapshot') return { snapshot: reply.snapshot, version: reply.version }
  if (!held || held.version !== reply.from || held.snapshot.root !== reply.root) return null
  return { snapshot: applyProjectPatch(held.snapshot, reply.patch), version: reply.version }
}
