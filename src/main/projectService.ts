import { basename } from 'path'
import { SCHEMA_VERSION, type Board, type Project } from '@shared/types'
import type { BoardData, ProjectSnapshot } from '@shared/ipc'
import type { ProjectChange } from '@shared/changes'
import type { PatchOp, ProjectPatch } from '@shared/patch'
import { buildGraph } from '@shared/graph'
import {
  ensureBoardDirs,
  isProject,
  listBoardIds,
  listCharacters,
  listColumnGroups,
  listNoteMetas,
  listTimeline,
  listViews,
  readBoard,
  readCharacter,
  readColumnGroup,
  readNoteMeta,
  readProject,
  readTimelineUnit,
  readView,
  writeBoard,
  writeProject
} from './data/repository'
import { migrateIfNeeded } from './data/migrate'

/**
 * The project the app currently has open.
 *
 * Held here because the `zn-asset://` protocol handler (see `src/main/index.ts`)
 * has to resolve a board-relative asset path against *some* root, and a URL
 * carrying an absolute filesystem path would be both ugly and a way to read
 * arbitrary files. Set by `loadSnapshot`, which every open goes through.
 */
let openRoot: string | null = null

/** The root of the currently open project, or null before one is opened. */
export function currentRoot(): string | null {
  return openRoot
}

/** Today's date as YYYY-MM-DD. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * A fresh, empty board. `members` is `[]` rather than `null`: a board created
 * in-app is curated from the start, so a character entered for the family tree
 * never lands on its grid uninvited. Only pre-v0.6.0 boards carry `null`.
 */
export function defaultBoard(id = 'main', name = 'Main Board'): Board {
  return {
    id,
    name,
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
  }
}

/**
 * Scaffold a new project inside `dir`. `dir` is the chosen folder and becomes
 * the project root. Throws if it already contains a project.
 */
export async function createProject(dir: string): Promise<ProjectSnapshot> {
  if (await isProject(dir)) {
    throw new Error('That folder already contains a ZN Story Line project.')
  }

  await ensureBoardDirs(dir, 'main')
  await writeBoard(dir, defaultBoard())

  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    name: basename(dir),
    timelineLabel: 'Chapter',
    boards: ['main'],
    created: today(),
    lastOpened: today(),
    families: {}
  }
  await writeProject(dir, project)

  return loadSnapshot(dir)
}

/** Read a single board plus the entities it owns. */
async function loadBoardData(root: string, boardId: string): Promise<BoardData> {
  const [{ value: board }, characters, timeline, colGroups, notes] = await Promise.all([
    readBoard(root, boardId),
    listCharacters(root, boardId),
    listTimeline(root, boardId),
    listColumnGroups(root, boardId),
    listNoteMetas(root, boardId)
  ])
  const views = await listViews(root, boardId, board.views)
  // Family-graph problems (dangling parents, cycles, one-sided spouses) are
  // computed here rather than in the renderer so the same list is available to a
  // static export, which never runs the loader.
  const { problems } = buildGraph(characters)
  return { board, characters, timeline, colGroups, notes, views, problems }
}

/**
 * Read an entire project into a snapshot. Runs any needed schema migration
 * first. `stampLastOpened` should be true only when the user actually opens the
 * project (otherwise every snapshot read would rewrite project.json).
 */
export async function loadSnapshot(root: string, stampLastOpened = false): Promise<ProjectSnapshot> {
  if (!(await isProject(root))) {
    throw new Error('That folder is not a ZN Story Line project (no project.json).')
  }

  await migrateIfNeeded(root)

  const { value: project, mtimeMs } = await readProject(root)
  // `project.boards` is the authoritative display order (Issue 17). Fall back to
  // appending any board folders not listed there (e.g. added externally) so a
  // stale/incomplete list never hides a board.
  const onDisk = await listBoardIds(root)
  const ordered = project.boards.filter((id) => onDisk.includes(id))
  const extra = onDisk.filter((id) => !ordered.includes(id))
  const boardIds = [...ordered, ...extra]
  const boards = await Promise.all(boardIds.map((id) => loadBoardData(root, id)))

  openRoot = root

  if (stampLastOpened) {
    try {
      await writeProject(root, { ...project, lastOpened: today() }, mtimeMs)
      project.lastOpened = today()
    } catch {
      // ignore — non-critical
    }
  }

  return { root, project, boards }
}

/** True for a "the file is simply gone" error — the file was read after a delete. */
function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/**
 * Read one changed entity into the patch op that re-states it in the snapshot
 * (#131). A delete — or a file that vanished before it could be read — becomes a
 * null-value op the merge treats as a removal. Any other read error (a half-synced
 * Google Drive file, say) is thrown, so the whole focused reload is abandoned and
 * the renderer keeps the snapshot it has; the watcher will fire again.
 */
async function loadOp(root: string, change: ProjectChange): Promise<PatchOp | null> {
  const { kind, id, boardId, type } = change
  if (kind === 'project') {
    try {
      return { target: 'project', project: (await readProject(root)).value }
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }
  if (!boardId) return null

  if (kind === 'board') {
    try {
      return { target: 'board', boardId, board: (await readBoard(root, boardId)).value }
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }

  // A delete needs no read — the entity is simply dropped from its board.
  if (type === 'unlink') return { target: kind, boardId, id, value: null }

  try {
    switch (kind) {
      case 'character':
        return { target: 'character', boardId, id, value: (await readCharacter(root, boardId, id)).value }
      case 'timeline':
        return { target: 'timeline', boardId, id, value: (await readTimelineUnit(root, boardId, id)).value }
      case 'colgroup':
        return { target: 'colgroup', boardId, id, value: (await readColumnGroup(root, boardId, id)).value }
      case 'note':
        return { target: 'note', boardId, id, value: await readNoteMeta(root, boardId, id) }
      case 'view':
        return { target: 'view', boardId, id, value: (await readView(root, boardId, id)).value }
    }
  } catch (err) {
    // Added/changed then gone (a quick create-delete) — drop it, same as unlink.
    if (isMissing(err)) return { target: kind, boardId, id, value: null }
    throw err
  }
  return null
}

/**
 * Re-read only the entities a batch of watcher changes names, for a focused
 * live-reload (#131). Duplicate events for one file (a watcher can fire add then
 * change) collapse to a single read — the last event for a path wins, so a trailing
 * delete still removes it. Returns the ops in first-seen order.
 */
export async function loadChanges(root: string, changes: ProjectChange[]): Promise<ProjectPatch> {
  // Collapse to the last change per target path, preserving first-seen order.
  const order: string[] = []
  const latest = new Map<string, ProjectChange>()
  for (const change of changes) {
    const key = `${change.kind}:${change.boardId ?? ''}:${change.id}`
    if (!latest.has(key)) order.push(key)
    latest.set(key, change)
  }
  const ops = await Promise.all(order.map((key) => loadOp(root, latest.get(key)!)))
  return { ops: ops.filter((op): op is PatchOp => op !== null) }
}
