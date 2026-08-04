/**
 * Shared domain types — used by both the main process (filesystem layer)
 * and the renderer (UI). These mirror the on-disk file formats described in
 * Requirements/index.md §3.
 */

/** A character — one `characters/<id>.md` file. */
export interface Character {
  /** Unique slug; also the filename stem. Used as `rowId` in board data. */
  id: string
  type: 'character'
  name: string
  /** Hex colour for thread line and card border, e.g. "#E24B4A". */
  colour: string
  role?: string
  age?: number
  species?: string
  tags?: string[]
  /** Optional group label; rows sharing a value are grouped on the board. */
  group?: string
  /** Any additional user-defined frontmatter fields. */
  custom?: Record<string, unknown>
}

/** A timeline unit — one `timeline/<id>.md` file. Becomes a board column. */
export interface TimelineUnit {
  /** Unique slug; also the filename stem. Used as `colStart`/`colEnd`. */
  id: string
  label: string
  /** Integer display order across the board columns. */
  order: number
  summary?: string
  tags?: string[]
  /** Optional group label; columns sharing a value are grouped on the board. */
  group?: string
  custom?: Record<string, unknown>
}

/** A `related` entry on a note (Requirements §11). */
export interface RelatedNote {
  /** Filename of the related note, e.g. "wolf-ch4.md". */
  file: string
  /** Optional inline comment; null when absent. */
  comment: string | null
}

/** A note — one `notes/<id>.md` file. Card content lives here. */
export interface Note {
  /** Filename stem (slug). Renameable — NOT the stable identity (see `uid`). */
  id: string
  /**
   * Stable identity (`n_<8 hex>`), stored in frontmatter and never changed.
   * Cards reference notes by this, so the file can be renamed (even externally)
   * without breaking links. Optional: notes created outside the app may lack one
   * until the app next writes them (lazy assignment).
   */
  uid?: string
  /** Displayed on the card, truncated to ~60 chars. */
  title: string
  tags?: string[]
  /** Board ids this note appears on. Derived from board JSON (kept in sync). */
  boards?: string[]
  related?: RelatedNote[]
  /** ISO date (YYYY-MM-DD). */
  created?: string
  /** Raw markdown body, preserved verbatim on write. May be omitted in list views (lazy). */
  body: string
}

/** A card placed on a board grid. */
export interface Card {
  id: string
  /** Stable uid of the backing note (see Note.uid) — rename-safe reference. */
  noteUid: string
  /** Character id — the row this card sits on. */
  rowId: string
  /** Timeline unit id where the span starts. */
  colStart: string
  /** Timeline unit id where the span ends (equal to colStart for single-column). */
  colEnd: string
}

/** A saved show/hide configuration for a board. */
export interface BoardPreset {
  name: string
  hiddenRows: string[]
  hiddenCols: string[]
}

/** A board — one `boards/<id>.json` file. Source of truth for card placement. */
export interface Board {
  id: string
  name: string
  cards: Card[]
  hiddenRows: string[]
  hiddenCols: string[]
  presets: BoardPreset[]
  /** Character ids in display order, used for within-group member ordering. */
  rowOrder: string[]
  /**
   * Top-level row-block order: group labels and ungrouped character ids, in
   * display order. Controls how groups (and standalone rows) are sequenced.
   */
  rowGroupOrder: string[]
  /** Timeline unit ids in display order (columns). */
  colOrder: string[]
  /** Collapsed row-group labels (view state, per board). */
  collapsedRowGroups: string[]
  /** Collapsed column-group labels (view state, per board). */
  collapsedColGroups: string[]
  /** Persisted zoom level for this board. */
  zoom: number
}

/**
 * On-disk schema version, stamped into `project.json`. Bump only on a
 * *breaking* schema change (which also warrants a major app-version bump and a
 * migration step). Additive/optional changes do NOT bump this — they're handled
 * by lenient parsing + the `normalize*` defaults.
 */
export const SCHEMA_VERSION = 3

/** Project metadata — `project.json`. */
export interface Project {
  /** On-disk schema version (see SCHEMA_VERSION). */
  schemaVersion: number
  name: string
  /** Label for timeline units, e.g. "Chapter". */
  timelineLabel: string
  /** Board ids belonging to this project. */
  boards: string[]
  /** ISO date. */
  created: string
  /** ISO date. */
  lastOpened: string
}
