import { basename } from 'path'
import { SCHEMA_VERSION, type Board, type Project } from '@shared/types'
import type { BoardData, ProjectSnapshot } from '@shared/ipc'
import {
  ensureBoardDirs,
  isProject,
  listBoardIds,
  listCharacters,
  listNoteMetas,
  listTimeline,
  readBoard,
  readProject,
  writeBoard,
  writeProject
} from './data/repository'
import { migrateIfNeeded } from './data/migrate'

/** Today's date as YYYY-MM-DD. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** A fresh, empty board. */
export function defaultBoard(id = 'main', name = 'Main Board'): Board {
  return {
    id,
    name,
    cards: [],
    hiddenRows: [],
    hiddenCols: [],
    presets: [],
    rowOrder: [],
    rowGroupOrder: [],
    colOrder: [],
    collapsedRowGroups: [],
    collapsedColGroups: [],
    zoom: 1
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
    lastOpened: today()
  }
  await writeProject(dir, project)

  return loadSnapshot(dir)
}

/** Read a single board plus the entities it owns. */
async function loadBoardData(root: string, boardId: string): Promise<BoardData> {
  const [{ value: board }, characters, timeline, notes] = await Promise.all([
    readBoard(root, boardId),
    listCharacters(root, boardId),
    listTimeline(root, boardId),
    listNoteMetas(root, boardId)
  ])
  return { board, characters, timeline, notes }
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
