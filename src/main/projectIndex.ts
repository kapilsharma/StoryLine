import { promises as fs } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import type { ProjectSnapshot, SnapshotReply } from '@shared/ipc'
import type { ProjectChange } from '@shared/changes'
import type { Note } from '@shared/types'
import { applyProjectPatch, planReload, type PatchOp, type ProjectPatch } from '@shared/patch'
import { loadChanges, loadSnapshot } from './projectService'
import { classify } from './data/watcher'
import { clearTouches, drainTouches } from './data/journal'

/**
 * The open project, held in memory (#184).
 *
 * Before this, every edit wrote its file and then re-read the *whole* project to
 * hand the renderer a fresh snapshot — 1,100 file reads for one autosave on Zoey
 * Nyxx, 6,300 at 3,000 cards, and Google Drive makes each read ~20× slower.
 *
 * Now the snapshot is read once, on open, and kept here. Every write, delete and
 * rename the app makes is recorded in `data/journal.ts`; asking for the snapshot
 * re-reads just those files (the same `loadChanges` the #131 focused reload uses)
 * and merges them in with `applyProjectPatch`. An edit costs the files it touched.
 *
 * **Invariant:** the snapshot here deep-equals what `loadSnapshot(root)` would read
 * from disk. Anything that can't be patched with certainty — a board appearing or
 * vanishing, a read that keeps failing, a different root — rebuilds from disk.
 * Disk is the source of truth; this is a cache of it.
 *
 * External edits arrive through the watcher → renderer → `applyChanges` (the
 * `project:reloadChanges` handler), and a full reload through `rebuild`.
 *
 * All work is serialised: two handlers flushing at once would otherwise let the
 * second return a snapshot from before the first's patch landed, and a renderer
 * that applies replies in arrival order would then step back in time.
 */

interface Index {
  root: string
  snapshot: ProjectSnapshot
  /** Which numbered state `snapshot` is (#188). */
  version: number
  /** The ops that produced each recent version from the one before — what a reply is built from. */
  log: Map<number, PatchOp[]>
}

let index: Index | null = null
let queue: Promise<unknown> = Promise.resolve()

/**
 * Version numbers only ever go up, across rebuilds and projects, so a renderer
 * holding an old number can never mistake a new state for one it has.
 */
let lastVersion = 0

/** The last version a reply took the renderer to (one window, so one renderer). */
let sent: { root: string; version: number } | null = null

/** How many recent versions' patches to keep for building replies. */
const LOG_SIZE = 200

/** Run `fn` after everything already queued, whatever became of it. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

const same = (a: string, b: string): boolean => resolve(a) === resolve(b)

/** How long to wait before re-reading after a failed read (Drive mid-sync, #137). */
const RETRY_MS = 500

/** Read the whole project and hold it. `stampLastOpened` as for `loadSnapshot`. */
async function build(root: string, stampLastOpened = false): Promise<ProjectSnapshot> {
  // Anything the journal holds is about to be read anyway.
  clearTouches()
  const snapshot = await loadSnapshot(root, stampLastOpened)
  index = { root, snapshot, version: ++lastVersion, log: new Map() }
  return snapshot
}

/** The whole held project as a reply, and note that the renderer now has it. */
function whole(current: Index): Extract<SnapshotReply, { kind: 'snapshot' }> {
  sent = { root: current.root, version: current.version }
  return { kind: 'snapshot', version: current.version, snapshot: current.snapshot }
}

/**
 * What to send the renderer now (#188): the ops from the version it was last
 * sent to the current one, or — first time, another project, a rebuild in
 * between, or older than the log reaches — the whole project.
 */
function reply(current: Index): SnapshotReply {
  if (!sent || !same(sent.root, current.root) || sent.version > current.version) return whole(current)
  const ops: PatchOp[] = []
  for (let v = sent.version + 1; v <= current.version; v++) {
    const step = current.log.get(v)
    if (!step) return whole(current)
    ops.push(...step)
  }
  const from = sent.version
  sent = { root: current.root, version: current.version }
  return { kind: 'patch', root: current.root, from, version: current.version, patch: { ops } }
}

/** Open a project: read it whole, stamp `lastOpened`, and hold it. */
export function openIndex(root: string): Promise<Extract<SnapshotReply, { kind: 'snapshot' }>> {
  return serial(async () => {
    await build(root, true)
    return whole(index!)
  })
}

/** Throw the held snapshot away and read the project again (a full reload). */
export function rebuildIndex(root: string): Promise<SnapshotReply> {
  return serial(async () => {
    await build(root)
    return whole(index!)
  })
}

/** Forget the project (app start, or a test starting over). */
export function dropIndex(): void {
  index = null
  sent = null
  clearTouches()
}

/** Where a change's file lives — the inverse of `classify`. */
function changePath(root: string, change: ProjectChange): string {
  const { kind, id, boardId } = change
  if (kind === 'project') return join(root, 'project.json')
  const board = join(root, 'boards', boardId ?? '')
  if (kind === 'board') return join(board, 'board.json')
  const folder = { character: 'characters', timeline: 'timeline', colgroup: 'colgroups', note: 'notes', view: 'views' }[kind]
  return join(board, folder, `${id}${kind === 'view' ? '.json' : '.md'}`)
}

/** Is this entity already in the snapshot? */
function held(snapshot: ProjectSnapshot, change: ProjectChange): boolean {
  if (change.kind === 'project') return true
  const bd = snapshot.boards.find((b) => b.board.id === change.boardId)
  if (!bd) return false
  const list = {
    board: [bd.board],
    character: bd.characters,
    timeline: bd.timeline,
    colgroup: bd.colGroups,
    note: bd.notes,
    view: bd.views
  }[change.kind]
  return list.some((x) => x.id === change.id)
}

/**
 * Drop the changes whose file is, right now, empty but whose entity we already
 * hold. Google Drive (and some editors) truncate a file before writing it back;
 * reading it in that moment would replace a good note with a blank one and orphan
 * its card. Keeping the old entry is right — the watcher fires again when the
 * real content lands. A file that is *new* and empty is taken as it is.
 */
async function withoutHalfWritten(root: string, snapshot: ProjectSnapshot, changes: ProjectChange[]): Promise<ProjectChange[]> {
  const keep = await Promise.all(
    changes.map(async (change) => {
      if (change.type === 'unlink' || !held(snapshot, change)) return true
      try {
        return (await fs.stat(changePath(root, change))).size > 0
      } catch {
        return true // gone: let the read report it (as a removal)
      }
    })
  )
  return changes.filter((_, i) => keep[i])
}

/** `loadChanges`, once more after a pause if the first attempt fails. */
async function readChanges(root: string, changes: ProjectChange[]): Promise<ProjectPatch> {
  try {
    return await loadChanges(root, changes)
  } catch {
    await new Promise<void>((r) => setTimeout(r, RETRY_MS))
    return loadChanges(root, changes)
  }
}

/** The snapshot after an update, and the patch that got it there — null when it was rebuilt instead. */
interface Updated {
  snapshot: ProjectSnapshot
  patch: ProjectPatch | null
}

/**
 * Bring the held snapshot up to date with `changes` (plus whatever the journal
 * recorded) and return it with the patch that was applied. Rebuilds from disk
 * when the changes can't be patched, or reading them keeps failing.
 */
async function update(root: string, extra: ProjectChange[]): Promise<Updated> {
  const rebuilt = async (): Promise<Updated> => ({ snapshot: await build(root), patch: null })
  if (!index || !same(index.root, root)) return rebuilt()
  const current = index
  const changes = [
    ...drainTouches().flatMap(({ path, type }) => {
      const rel = relative(current.root, path)
      if (rel.startsWith('..') || isAbsolute(rel)) return []
      const change = classify(rel, type)
      return change ? [change] : []
    }),
    ...extra
  ]
  if (changes.length === 0) return { snapshot: current.snapshot, patch: { ops: [] } }

  const plan = planReload(current.snapshot, changes)
  if (plan.mode === 'full') return rebuilt()

  let patch: ProjectPatch
  try {
    patch = await readChanges(root, await withoutHalfWritten(root, current.snapshot, plan.changes))
  } catch {
    // Still failing after the retry: start again from disk. If that throws too,
    // the caller sees it, as it did before the index existed.
    return rebuilt()
  }
  if (patch.ops.length > 0) {
    current.snapshot = applyProjectPatch(current.snapshot, patch)
    current.version = ++lastVersion
    current.log.set(current.version, patch.ops)
    current.log.delete(current.version - LOG_SIZE)
  }
  return { snapshot: current.snapshot, patch }
}

/**
 * The project as it is on disk, after the app's own recent writes — what every
 * mutating handler returns. Costs only the files written since the last call.
 */
export function indexSnapshot(root: string): Promise<ProjectSnapshot> {
  return serial(async () => (await update(root, [])).snapshot)
}

/**
 * The reply for a handler that changed the project: bring the index up to date
 * with its writes and send the renderer what changed since its copy (#188).
 */
export function indexReply(root: string): Promise<SnapshotReply> {
  return serial(async () => {
    await update(root, [])
    return reply(index!)
  })
}

/**
 * Apply watcher-reported external edits (#131's focused reload) and reply with
 * what changed, as for an in-app edit.
 */
export function applyChanges(root: string, changes: ProjectChange[]): Promise<SnapshotReply> {
  return serial(async () => {
    await update(root, changes)
    return reply(index!)
  })
}

/**
 * The note ids and uids on a board, up to date with the app's own writes — for
 * picking a fresh id without listing (and reading) every note file.
 */
export async function noteKeys(root: string, boardId: string): Promise<{ ids: string[]; uids: string[] }> {
  const snapshot = await indexSnapshot(root)
  const notes: Note[] = snapshot.boards.find((b) => b.board.id === boardId)?.notes ?? []
  return {
    ids: notes.map((n) => n.id),
    uids: notes.map((n) => n.uid).filter((u): u is string => Boolean(u))
  }
}
