/**
 * Shared domain types — used by both the main process (filesystem layer)
 * and the renderer (UI). These mirror the on-disk file formats described in
 * Requirements/index.md §3.
 */

export type Gender = 'male' | 'female' | 'other' | 'unknown'

export const GENDERS: Gender[] = ['male', 'female', 'other', 'unknown']

/**
 * A character — one `boards/<boardId>/characters/<id>.md` file.
 *
 * The family fields (v0.6.0, Issue 29) are all optional and purely additive: a
 * character file written before the Family tab existed loads unchanged, and a
 * character that never appears on a tree is written back byte-identical.
 */
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

  // ── Family fields (all optional; see src/shared/families.ts) ──
  /**
   * Which family this person belongs to, for colouring on the family tree.
   * Absent = inferred from the surname in `name`, so existing files group
   * correctly without being edited.
   */
  family?: string
  /** Absent on a character that has never been touched by the Family tab. */
  gender?: Gender
  /** Partial ISO date as an opaque string: "1984", "1984-06" or "1984-06-12". */
  birthday?: string
  /** Partial ISO date. Absent = living. */
  died?: string
  maidenName?: string
  /** Character id of the father, if known. */
  father?: string
  /** Character id of the mother, if known. */
  mother?: string
  /** Character ids. Symmetric — the app writes both sides. */
  spouse?: string[]

  /** Any additional user-defined frontmatter fields. */
  custom?: Record<string, unknown>

  /**
   * True for a synthesised placeholder standing in for a referenced-but-missing
   * character. Built by `buildGraph`; never written to disk.
   */
  ghost?: boolean
}

/**
 * A couple (or lone parent) plus their children. Not stored — derived by
 * `buildGraph`. This is the unit the tree layout positions, which is what keeps
 * spouses together and siblings contiguous.
 */
export interface Union {
  /** `${fatherId ?? '_'}+${motherId ?? '_'}` — stable and order-independent. */
  id: string
  /** One or two character ids. */
  partnerIds: string[]
  /** Character ids, sorted by birthday then name. */
  childIds: string[]
}

/** A data problem found while building the family graph. Reported, never thrown. */
export interface Problem {
  kind: 'dangling' | 'self-reference' | 'cycle' | 'asymmetric-spouse' | 'levelling'
  /** Character id the problem is attached to. */
  id: string
  message: string
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
  /**
   * The characters that are *on* this board, as rows — its cast.
   *
   * Characters can exist in a board's folder without being on the grid: a
   * relative added only so the family tree has context is cast, not plot. So
   * membership is opt-in, through the board's "+ Character" picker.
   *
   * `null` means a board written before v0.6.0, where a character file existing
   * *was* membership. It keeps that meaning — everyone is a row — until the board
   * is curated, at which point the concrete list is stamped. That is what lets
   * this land with no migration and no schema bump.
   */
  members: string[] | null
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
  /**
   * Family-tree view ids in tab order (files under `boards/<id>/views/`).
   * Added in v0.6.0; absent on older boards and defaulted to `[]`.
   */
  views: string[]
}

/**
 * A saved family tree — one `boards/<boardId>/views/<id>.json` file.
 *
 * A view is a set of filters over the board's cast plus the camera and any
 * hand-made arrangement. Deleting one deletes a camera and a filter, never a
 * character.
 */
export interface View {
  schemaVersion: number
  id: string
  name: string

  /**
   * The characters this tree draws — its membership, opt-in like a board's.
   *
   * `null` means the filters below decide, which is how a view written before
   * membership existed behaves. Curating the tree (adding or removing a person,
   * or arranging it) stamps the concrete list, and from then on the filters are
   * only a bulk-add helper: "select these" seeds `members` and stops mattering.
   *
   * Why explicit rather than filter-driven: a character added for context should
   * not silently appear on every tree, and a tree you have shaped by hand should
   * not change because someone new was entered elsewhere.
   */
  members: string[] | null

  // ── Filters: seed `members` via "Select these"; live only while members is null ──
  /** Character the tree is drawn around; null = everyone on the board. */
  root: string | null
  /** Generations up. null = unlimited, 0 = none (descendants only). */
  parentDepth: number | null
  /** Generations down. null = unlimited, 0 = none (ancestors only). */
  childDepth: number | null
  /** Pull in the families of spouses reached through the walk. */
  includeSpouseFamilies: boolean
  /** Explicitly excluded character ids. Applies on top of `members`. */
  hidden: string[]

  // ── Display state ──
  /**
   * True once the tree has been arranged by hand. An arranged view is frozen:
   * its members are exactly the keys of `overrides`, everyone has a stored
   * position, and a newly added character does **not** appear on its own — it is
   * imported explicitly. Without this, adding one person re-runs the layout and
   * throws away an arrangement that took real work.
   */
  arranged: boolean
  /** Show dashed placeholders for referenced-but-missing people. */
  showGhosts: boolean
  /** Character ids whose descendants are collapsed. */
  collapsed: string[]
  zoom: number
  panX: number
  panY: number
  /** Manual node positions, keyed by character id. */
  overrides: Record<string, { x: number; y: number }>
  /**
   * Manual connector routes, keyed by edge id (`child:<union>:<child>` or
   * `partner:<union>`). Waypoints the line is routed through, draw.io style.
   * A route whose edge no longer exists is simply ignored.
   */
  edgeRoutes: Record<string, Array<{ x: number; y: number }>>
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
  /**
   * Family → hex colour for the family tree. Assigned automatically from the
   * palette and persisted, so a family's colour is stable as people are added.
   * Added in v0.6.0; absent on older projects and defaulted to `{}`.
   */
  families: Record<string, string>
}

/** A fresh family-tree view with everything defaulted. */
export function defaultView(id: string, name: string): View {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    // Explicit and empty. `view:create` seeds it from the filters so a new tab
    // opens with something on it, but as a *stamped* list — so a character added
    // later does not appear on this tree without being put there.
    members: [],
    root: null,
    parentDepth: null,
    childDepth: null,
    includeSpouseFamilies: true,
    hidden: [],
    arranged: false,
    showGhosts: true,
    collapsed: [],
    zoom: 1,
    panX: 0,
    panY: 0,
    overrides: {},
    edgeRoutes: {}
  }
}
