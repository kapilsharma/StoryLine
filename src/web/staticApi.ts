import type { AppConfig, AppSettings } from '@shared/config'
import { SNAPSHOT_GLOBAL, entityBodyKey, type ExportBundle } from '@shared/export'
import type {
  AppApi,
  BoardData,
  DocExportResult,
  EntityBodyKind,
  ProjectSnapshot,
  SnapshotReply,
  StaticExportResult
} from '@shared/ipc'
import type { Note } from '@shared/types'
import type { AssetRef } from '@shared/assets'
import { searchEntries } from '@shared/search'

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
 *  - **Family-tree view state** (`saveView`) — camera, arrangement, connector
 *    routes, and the view's own filters. Same reasoning: a published tree is
 *    something you pan, fit and re-centre to read it. Creating, renaming,
 *    duplicating or deleting a tree changes the project, so those stay refused.
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
    notes: bd.notes.map((n) => ({ ...n, body: '' })),
    // Bundles written before v0.6.0 carry no trees; default rather than crash.
    views: bd.views ?? [],
    // Bundles written before v4 carry no column groups; a flat board is correct.
    colGroups: bd.colGroups ?? [],
    problems: bd.problems ?? []
  }))
  let settings: AppSettings = bundle.settings

  // Nothing in a static export ever changes, so every reply is the one version.
  const whole = (): SnapshotReply => ({ kind: 'snapshot', version: 0, snapshot: snapshot() })

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
    openProject: async () => whole(),
    reloadProject: async () => whole(),
    // A static export has no watcher, so nothing ever calls this — but the
    // contract needs it. The bundle never changes, so the whole of it is the answer.
    reloadChanges: async () => whole(),
    // Recents are never exported, so there is nothing to remove — succeed quietly.
    removeRecent: async () => config(),
    saveProjectMeta: () => denied<SnapshotReply>(),
    saveFamilyColours: () => denied<SnapshotReply>(),

    // ── Refused: anything backed by a file ──
    saveCharacter: () => denied<SnapshotReply>(),
    addCharacters: () => denied<SnapshotReply>(),
    deleteCharacter: () => denied<SnapshotReply>(),
    renameCharacter: () => denied<SnapshotReply>(),
    setChildren: () => denied<SnapshotReply>(),
    saveTimelineUnit: () => denied<SnapshotReply>(),
    deleteTimelineUnit: () => denied<SnapshotReply>(),
    saveColumnGroup: () => denied<SnapshotReply>(),
    deleteColumnGroup: () => denied<SnapshotReply>(),
    reorderColumns: () => denied<SnapshotReply>(),
    moveColumn: () => denied<SnapshotReply>(),
    wrapColumnInGroup: () => denied<SnapshotReply>(),
    addColumnOutline: () => denied<SnapshotReply>(),
    saveNote: () => denied<SnapshotReply>(),
    deleteNote: () => denied<SnapshotReply>(),
    renameNote: () => denied<SnapshotReply>(),
    saveEntityBody: () => denied<SnapshotReply>(),
    createBoard: () => denied<SnapshotReply>(),
    renameBoard: () => denied<SnapshotReply>(),
    deleteBoard: () => denied<SnapshotReply>(),
    reorderBoards: () => denied<SnapshotReply>(),
    createView: () => denied<SnapshotReply>(),
    duplicateView: () => denied<SnapshotReply>(),
    renameView: () => denied<SnapshotReply>(),
    deleteView: () => denied<SnapshotReply>(),
    reorderViews: () => denied<SnapshotReply>(),
    createCard: () => denied<SnapshotReply>(),
    updateCard: () => denied<SnapshotReply>(),
    deleteCard: () => denied<SnapshotReply>(),

    // ── Allowed: reads ──
    // Search runs over the bundle, which (unlike a live snapshot) carries every
    // note body — so a published site searches its own content with the same
    // matcher the desktop app uses (Issues #59, #60).
    searchNotes: async (_root, query, scope) =>
      searchEntries(
        bundle.boards.flatMap((bd) => [
          ...bd.notes.map((n) => ({
            boardId: bd.board.id,
            kind: 'note' as const,
            id: n.id,
            title: n.title,
            tags: n.tags ?? [],
            body: n.body ?? ''
          })),
          ...bd.characters.map((c) => ({
            boardId: bd.board.id,
            kind: 'character' as const,
            id: c.id,
            title: c.name,
            tags: c.tags ?? [],
            body: bundle.entityBodies[entityBodyKey(bd.board.id, 'character', c.id)] ?? ''
          })),
          ...bd.timeline.map((t) => ({
            boardId: bd.board.id,
            kind: 'timeline' as const,
            id: t.id,
            title: t.label,
            tags: t.tags ?? [],
            body: bundle.entityBodies[entityBodyKey(bd.board.id, 'timeline', t.id)] ?? ''
          }))
        ]),
        query,
        scope
      ),

    // Assets are copied into the exported folder, so there is nothing to import.
    importAsset: () => denied<AssetRef>(),
    pickAsset: async () => null,

    getNote: async (_root, boardId, id) => fullNote(boardId, id),
    getEntityBody: async (_root, boardId, kind: EntityBodyKind, id) =>
      bundle.entityBodies[entityBodyKey(boardId, kind, id)] ?? '',

    // ── Allowed: board / tree view state (in-session only) ──
    saveBoard: async (_root, board) => {
      boards = boards.map((bd) => (bd.board.id === board.id ? { ...bd, board } : bd))
      return whole()
    },

    saveView: async (_root, boardId, view) => {
      boards = boards.map((bd) =>
        bd.board.id === boardId
          ? { ...bd, views: bd.views.map((v) => (v.id === view.id ? view : v)) }
          : bd
      )
      return whole()
    },

    // Nothing changes underneath a static export — no watcher to subscribe to.
    onProjectChange: () => () => {},

    // A published site runs in a browser: there is no app menu to drive (#168).
    setMenuState: () => {},
    onMenuCommand: () => () => {},

    // Re-exporting from a browser has nowhere to write a folder to.
    exportStaticSite: () => denied<StaticExportResult | null>(),
    // Document export needs a native save dialog, which a static site has not.
    exportDocument: () => denied<DocExportResult | null>()
  }
}
