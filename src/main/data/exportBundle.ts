import { EXPORT_FORMAT_VERSION, entityBodyKey, type ExportBundle } from '@shared/export'
import { DEFAULT_SETTINGS, type AppSettings, type Theme } from '@shared/config'
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

/**
 * Page background per theme, mirroring `--bg` in `src/renderer/src/index.css`.
 * Duplicated deliberately: see {@link applyThemeToHtml}.
 */
const THEME_BG: Record<Theme, string> = { light: '#ffffff', dark: '#1b1c1f' }

/**
 * Stamp the exported theme into `index.html`.
 *
 * The web build inlines its CSS into the (deferred) JS bundle, so nothing is
 * styled until that whole file has parsed — which means a dark board would flash
 * white first. Setting `data-theme` up front, plus a one-line inline background,
 * paints the right colour immediately. It has to be a `<style>` rather than a
 * script because the page's CSP allows inline styles but not inline scripts.
 *
 * Safe to re-apply to already-stamped html.
 */
export function applyThemeToHtml(html: string, theme: Theme): string {
  const stamped = html.replace(/<html([^>]*)>/i, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\s*data-theme="[^"]*"/gi, '')
    return `<html${cleaned} data-theme="${theme}">`
  })
  const style = `<style id="zn-theme-bg">html{background:${THEME_BG[theme]}}</style>`
  return /<style id="zn-theme-bg">[^<]*<\/style>/i.test(stamped)
    ? stamped.replace(/<style id="zn-theme-bg">[^<]*<\/style>/i, style)
    : stamped.replace('</head>', `  ${style}\n  </head>`)
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
