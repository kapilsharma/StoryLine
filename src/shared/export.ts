/**
 * The payload a static export ships to the browser.
 *
 * Written by `scripts/export-static.mts` as **`snapshot.js`** — a
 * `window.<SNAPSHOT_GLOBAL> = {…}` assignment rather than a `.json` file, so the
 * exported folder also opens straight from `file://` (where `fetch()` is blocked
 * by CORS) and the web shell stays data-independent enough to prebuild once.
 * Consumed by `src/web/staticApi.ts`.
 */
import type { AppSettings } from './config'
import type { BoardData, EntityBodyKind } from './ipc'
import type { Project } from './types'

/** Global that the generated `snapshot.js` assigns the bundle to. */
export const SNAPSHOT_GLOBAL = '__ZN_SNAPSHOT__'

/** Bumped only if the bundle shape changes in a way an older shell can't read. */
export const EXPORT_FORMAT_VERSION = 1

/** Key into {@link ExportBundle.entityBodies}. */
export function entityBodyKey(boardId: string, kind: EntityBodyKind, id: string): string {
  return `${boardId}/${kind}/${id}`
}

export interface ExportBundle {
  formatVersion: number
  /** ISO timestamp of the export. */
  generatedAt: string
  /** Version of the app that produced the bundle. */
  appVersion: string
  /** Project metadata. `boards` lists only the exported boards, in order. */
  project: Project
  /**
   * The exported boards. Unlike a live `ProjectSnapshot`, notes here carry their
   * full markdown body — a static export has no lazy loader to fetch them from.
   *
   * Each board also carries its family trees (`views`) and family-graph
   * `problems`. Both were added in v0.6.0 without bumping
   * {@link EXPORT_FORMAT_VERSION}: the addition is purely additive, and
   * `createStaticApi` defaults them, so an older bundle still loads.
   */
  boards: BoardData[]
  /** Character/timeline markdown bodies, keyed by {@link entityBodyKey}. */
  entityBodies: Record<string, string>
  /**
   * Appearance settings only — theme, card font size, preview colours. Recents
   * are deliberately **excluded**: they hold absolute local filesystem paths
   * that must never be published.
   */
  settings: AppSettings
}
