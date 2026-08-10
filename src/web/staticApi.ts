import type { AppConfig, AppSettings } from '@shared/config'
import { SNAPSHOT_GLOBAL, entityBodyKey, type ExportBundle } from '@shared/export'
import type { AppApi, BoardData, EntityBodyKind, ProjectSnapshot } from '@shared/ipc'
import type { Note } from '@shared/types'

/**
 * The `AppApi` implementation for a static export — the browser-side counterpart
 * of `src/preload/index.ts`. Reads are served from the bundled snapshot; anything
 * that would touch a file on disk is refused with {@link ReadOnlyError}, which
 * the store surfaces as a toast.
 *
 * Two categories are deliberately *allowed* to change in-session, because they
 * are how you read a board rather than story content, and they reset on reload:
 *
 *  - **Appearance** (`updateSettings`) — theme, card font size, preview colours.
 *  - **Board view state** (`saveBoard`) — zoom, collapsed groups, hidden
 *    rows/columns, presets, row order. Card *placement* goes through
 *    `createCard`/`updateCard`/`deleteCard`, which stay refused.
 */

/** Root path reported by a static snapshot. Nothing resolves it as a real path. */
export const STATIC_ROOT = '/'

export const READ_ONLY_MESSAGE = 'This board is published read-only — your change was not saved.'

export class ReadOnlyError extends Error {
  constructor() {
    super(READ_ONLY_MESSAGE)
    this.name = 'ReadOnlyError'
  }
}

const denied = <T>(): Promise<T> => Promise.reject(new ReadOnlyError())

/** Thrown when `index.html` loaded but `snapshot.js` didn't. */
export class MissingSnapshotError extends Error {
  constructor() {
    super(
      'No story data found. This page expects a snapshot.js next to index.html — ' +
        're-run the export and upload the whole folder.'
    )
    this.name = 'MissingSnapshotError'
  }
}

/** Read the bundle that `snapshot.js` assigned to the global. */
export function readBundle(source: unknown = window): ExportBundle {
  const bundle = (source as Record<string, ExportBundle | undefined>)[SNAPSHOT_GLOBAL]
  if (!bundle || !Array.isArray(bundle.boards)) throw new MissingSnapshotError()
  return bundle
}

export function createStaticApi(bundle: ExportBundle): AppApi {
  // Mirror the desktop contract: snapshot notes are metadata-only, with bodies
  // served on demand by getNote. Keeps every consumer on the same code path as
  // the real app instead of quietly relying on eagerly-loaded bodies.
  let boards: BoardData[] = bundle.boards.map((bd) => ({
    ...bd,
    board: { ...bd.board },
    notes: bd.notes.map((n) => ({ ...n, body: '' }))
  }))
  let settings: AppSettings = bundle.settings

  const snapshot = (): ProjectSnapshot => ({
    root: STATIC_ROOT,
    project: bundle.project,
    boards
  })
  const config = (): AppConfig => ({ recents: [], settings })

  const fullNote = (boardId: string, id: string): Note => {
    const note = bundle.boards.find((bd) => bd.board.id === boardId)?.notes.find((n) => n.id === id)
    if (!note) throw new Error(`Note not found: ${id}`)
    return note
  }

  return {
    // ── Allowed: appearance ──
    getConfig: async () => config(),
    updateSettings: async (next) => {
      settings = next
      return config()
    },

    // ── Project lifecycle ──
    createProject: () => denied<string | null>(),
    pickProject: () => denied<string | null>(),
    openProject: async () => snapshot(),
    reloadProject: async () => snapshot(),
    // Recents are never exported, so there is nothing to remove — succeed quietly.
    removeRecent: async () => config(),
    saveProjectMeta: () => denied<ProjectSnapshot>(),

    // ── Refused: anything backed by a file ──
    saveCharacter: () => denied<ProjectSnapshot>(),
    deleteCharacter: () => denied<ProjectSnapshot>(),
    saveTimelineUnit: () => denied<ProjectSnapshot>(),
    deleteTimelineUnit: () => denied<ProjectSnapshot>(),
    reorderTimeline: () => denied<ProjectSnapshot>(),
    saveNote: () => denied<ProjectSnapshot>(),
    deleteNote: () => denied<ProjectSnapshot>(),
    renameNote: () => denied<ProjectSnapshot>(),
    saveEntityBody: () => denied<ProjectSnapshot>(),
    createBoard: () => denied<ProjectSnapshot>(),
    renameBoard: () => denied<ProjectSnapshot>(),
    deleteBoard: () => denied<ProjectSnapshot>(),
    reorderBoards: () => denied<ProjectSnapshot>(),
    createCard: () => denied<ProjectSnapshot>(),
    updateCard: () => denied<ProjectSnapshot>(),
    deleteCard: () => denied<ProjectSnapshot>(),

    // ── Allowed: reads ──
    getNote: async (_root, boardId, id) => fullNote(boardId, id),
    getEntityBody: async (_root, boardId, kind: EntityBodyKind, id) =>
      bundle.entityBodies[entityBodyKey(boardId, kind, id)] ?? '',

    // ── Allowed: board view state (in-session only) ──
    saveBoard: async (_root, board) => {
      boards = boards.map((bd) => (bd.board.id === board.id ? { ...bd, board } : bd))
      return snapshot()
    },

    // Nothing changes underneath a static export — no watcher to subscribe to.
    onProjectChange: () => () => {}
  }
}
