import { EXPORT_FORMAT_VERSION, entityBodyKey, type ExportBundle } from '@shared/export'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/config'
import type { BoardData } from '@shared/ipc'
import { loadSnapshot } from '../projectService'
import { listNotes, readEntityBody } from './repository'

/**
 * Builds the {@link ExportBundle} for a static export.
 *
 * Deliberately reuses `loadSnapshot` — including its schema migration — so an
 * export can never disagree with what the desktop app would show. Two things it
 * adds on top of a live snapshot: full note bodies (a static site has no lazy
 * loader) and the character/timeline markdown bodies the editor reads.
 *
 * Pure Node: no Electron, so it runs from a plain script.
 */

export interface ExportOptions {
  /** Board ids to include, in the order given. Omit/empty for every board. */
  boards?: string[]
  /** Appearance settings to bake in. Defaults to {@link DEFAULT_SETTINGS}. */
  settings?: AppSettings
  /** Stamped into the bundle as the producing app version. */
  appVersion: string
  /** ISO timestamp; injected so tests and reproducible builds can pin it. */
  generatedAt: string
}

/** Thrown when `--boards` names something the project doesn't have. */
export class UnknownBoardError extends Error {
  constructor(
    readonly requested: string[],
    readonly available: string[]
  ) {
    super(
      `Unknown board id(s): ${requested.join(', ')}. ` +
        `Available: ${available.join(', ') || '(none)'}`
    )
    this.name = 'UnknownBoardError'
  }
}

export async function buildExportBundle(root: string, options: ExportOptions): Promise<ExportBundle> {
  const snapshot = await loadSnapshot(root)
  const available = snapshot.boards.map((bd) => bd.board.id)

  const requested = options.boards?.filter((id) => id.length > 0) ?? []
  if (requested.length > 0) {
    const missing = requested.filter((id) => !available.includes(id))
    if (missing.length > 0) throw new UnknownBoardError(missing, available)
  }
  // Selection order wins when given, so `--boards b,a` publishes tabs in that order.
  const selected = requested.length > 0 ? requested : available

  const boards: BoardData[] = []
  const entityBodies: Record<string, string> = {}

  for (const boardId of selected) {
    const boardData = snapshot.boards.find((bd) => bd.board.id === boardId)
    if (!boardData) continue

    // Snapshot notes are metadata-only (bodies are lazy in the app); the export
    // needs them in full.
    const notes = await listNotes(root, boardId)
    boards.push({ ...boardData, notes })

    for (const character of boardData.characters) {
      entityBodies[entityBodyKey(boardId, 'character', character.id)] = await readEntityBody(
        root,
        boardId,
        'character',
        character.id
      )
    }
    for (const unit of boardData.timeline) {
      entityBodies[entityBodyKey(boardId, 'timeline', unit.id)] = await readEntityBody(
        root,
        boardId,
        'timeline',
        unit.id
      )
    }
  }

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: options.generatedAt,
    appVersion: options.appVersion,
    project: { ...snapshot.project, boards: selected },
    boards,
    entityBodies,
    settings: options.settings ?? { ...DEFAULT_SETTINGS }
  }
}
