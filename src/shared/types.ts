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
  /**
   * What sort of row this is on the board (Issue #119). `plot` marks a
   * high-level planning thread — a transformation arc, the stakes, the mystery —
   * rather than a person; such rows always sort above character rows and can be
   * hidden as a group. Absent (the default) means `character`, so every file
   * written before this existed loads and writes back unchanged. A plot row is
   * kept out of the family tree / graph, since it is not a person.
   */
  rowKind?: 'character' | 'plot'

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

  /**
   * True when the file's markdown body holds a note (issue #41). Derived on
   * read from the body the Characters tab edits — see `src/shared/entityBody.ts`
   * — so the board can mark which rows have something to show without loading
   * every body. Never written to disk.
   */
  hasNote?: boolean
}

/** A plot row (Issue #119) — a planning thread rather than a person. */
export function isPlotRow(c: Character): boolean {
  return c.rowKind === 'plot'
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

/**
 * A timeline unit — one `timeline/<id>.md` file. Becomes a board column: the
 * leaf of the column hierarchy, and the only thing a card can sit on.
 */
export interface TimelineUnit {
  /** Unique slug; also the filename stem. Used as `colStart`/`colEnd`. */
  id: string
  label: string
  /**
   * Display order among its siblings — the units and {@link ColumnGroup}s sharing
   * the same `parent`. Since schema v4 this is *not* global: the board's column
   * sequence is a depth-first walk of the tree (see `src/shared/columns.ts`).
   */
  order: number
  summary?: string
  tags?: string[]
  /**
   * Id of the {@link ColumnGroup} this column sits under; absent = top level. A
   * leaf may attach at any depth, so a chapter with no scenes can sit beside a
   * part that has them.
   */
  parent?: string
  custom?: Record<string, unknown>

  /**
   * True when the file's markdown body holds a note (Issue #104). Derived on read
   * so the board can show a 📝 on the column header without loading bodies —
   * the same arrangement as {@link Character.hasNote}. Never written to disk.
   */
  hasNote?: boolean
}

/**
 * A node in a board's column hierarchy — a Part, a Novel, a Chapter that has
 * scenes under it (Issue #104). One `boards/<boardId>/colgroups/<id>.md` file.
 *
 * It exists as an entity, with a frozen id, so that renaming it never detaches
 * its note: the note is the file's markdown body, reached through the
 * entity-body API (`kind: 'colgroup'`), and everything points at the id.
 * A group never holds a card — it holds children and a note.
 */
export interface ColumnGroup {
  /** Unique slug; also the filename stem. Frozen at creation, like a character's. */
  id: string
  type: 'colgroup'
  label: string
  /** Id of the parent group; absent = top level. */
  parent?: string
  /** Display order among its siblings (see {@link TimelineUnit.order}). */
  order: number
  /** True when the file's markdown body holds a note. Derived on read; never written. */
  hasNote?: boolean
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
  /**
   * Id of the note's {@link CardStatus} (Issue #108) — where the scene stands.
   * Absent = no status. An id the project no longer defines is kept as written
   * and simply shows no icon, so deleting a status never rewrites a note.
   */
  status?: string
  /**
   * Hover text (Issue #111): a short reminder shown when the mouse rests on the
   * card on the board, so the author need not open the note. Plain text; line
   * breaks are kept. Absent = no tooltip.
   */
  hover?: string
  /** Raw markdown body, preserved verbatim on write. May be omitted in list views (lazy). */
  body: string

  /**
   * True when the note's markdown body holds something (issue #46). Set on the
   * list-view metas, where the body is dropped — it is what lets a board card
   * say "there is more inside" without loading every note. Never written to
   * disk; on a note read whole, `body` already answers the question.
   */
  hasBody?: boolean
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
  /**
   * Hide all plot rows on this board (Issue #119). Per-board view state, so a
   * chosen "character-only" or "structure-only" view sticks. Absent/false = show.
   */
  hidePlotRows?: boolean
  /** Hide all character rows on this board (Issue #119). Absent/false = show. */
  hideCharacterRows?: boolean
  /** Ids of collapsed {@link ColumnGroup}s (view state, per board). Labels before v4. */
  collapsedColGroups: string[]
  /** Persisted zoom level for this board. */
  zoom: number
  /**
   * Family-tree view ids in tab order (files under `boards/<id>/views/`).
   * Added in v0.6.0; absent on older boards and defaulted to `[]`.
   */
  views: string[]
  /**
   * Width in px of the sticky row-header column, as the user dragged it (#80).
   *
   * Genuinely optional: absent means {@link ROW_HEADER_W_DEFAULT}, so a board
   * written before this existed needs no migration and no schema bump. Unlike
   * `zoom` it is *not* scaled by zoom — it is a real width on screen.
   */
  rowHeaderWidth?: number
}

/** Width of a board's row-header column before the user resizes it (#80). */
export const ROW_HEADER_W_DEFAULT = 170
/** Narrowest the header column can be dragged — still fits a swatch and a short name. */
export const ROW_HEADER_W_MIN = 120
/**
 * Widest the header column can be dragged, as a share of the *visible* board.
 * A fraction rather than a px cap, so the grid can never be pushed off screen.
 */
export const ROW_HEADER_W_MAX_FRACTION = 0.5

/**
 * Coerce a persisted row-header width into range. Only the minimum is applied
 * here: the maximum depends on the window size, which the data layer cannot
 * know, so the drag enforces it (see `BoardGrid`).
 */
export function normalizeRowHeaderWidth(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  return Math.max(ROW_HEADER_W_MIN, Math.round(raw))
}

/**
 * A saved family tree — one `boards/<boardId>/views/<id>.json` file.
 *
 * A view is a set of filters over the board's cast plus the camera and any
 * hand-made arrangement. Deleting one deletes a camera and a filter, never a
 * character.
 */
/**
 * A tree's layout mode (Issue 30):
 *  - `freeflow` — generation-based auto-layout (the original behaviour).
 *  - `timeline` — the vertical axis is calendar years; a character with a birth
 *    year is pinned to its year (draggable only on X), undated ones float freely.
 * Set at creation; a free-flow tree can be converted to timeline **one way** —
 * never back.
 */
export type ViewMode = 'freeflow' | 'timeline'

export interface View {
  schemaVersion: number
  id: string
  name: string
  /** Layout mode; defaults to `freeflow` for views written before Issue 30. */
  mode: ViewMode
  /**
   * Timeline mode only: how many calendar years occupy one row-height of
   * vertical space. Higher = more compact (a 30-year gap needn't be a huge drop).
   * Defaults to 20 when unset (Issue 30).
   */
  yearsPerRow?: number

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
export const SCHEMA_VERSION = 4

/**
 * What sort of project this is (Issue #63).
 *
 * `story` keeps the full novel-planning UI — family fields on a character, the
 * Family tab. `general` hides both, for a project whose rows are topics, phases
 * or products rather than people. Absent means `story`, so every project written
 * before this existed behaves exactly as it did.
 */
export type ProjectKind = 'story' | 'general'

export const PROJECT_KINDS: ProjectKind[] = ['story', 'general']

/** Project metadata — `project.json`. */
export interface Project {
  /** On-disk schema version (see SCHEMA_VERSION). */
  schemaVersion: number
  name: string
  /**
   * Label for the deepest column level — the units cards sit on, e.g. "Chapter".
   * When {@link timelineLevelLabels} is set this mirrors its last entry, so a
   * reader that predates levels still names the Timeline tab sensibly.
   */
  timelineLabel: string
  /**
   * One label per column level, top → deepest: `["Novel", "Part", "Chapter",
   * "Scene"]` (Issue #104). Whatever sits at depth `d` — a group or a leaf — is
   * called `timelineLevelLabels[d]`. Absent means a single level named by
   * `timelineLabel`, which is what every project written before v4 is.
   */
  timelineLevelLabels?: string[]
  /**
   * Label for board rows, e.g. "Character", "Topic", "Phase" (Issue #62).
   * Optional and additive: absent means "Character", which is what every
   * project written before this field behaved as.
   */
  rowLabel?: string
  /** See {@link ProjectKind}. Absent = `story`. */
  kind?: ProjectKind
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
  /**
   * The statuses a card can carry, in display order (Issue #108). Absent means
   * the built-in set (`DEFAULT_CARD_STATUSES` in `src/shared/cardStatus.ts`), so
   * a project that never touched them is written back without the key; `[]` is
   * an explicit "no statuses". Per project, not per app, so a note's status
   * resolves wherever the folder is opened.
   */
  cardStatuses?: CardStatus[]
}

/**
 * One status a card can be in — "💡 Idea", "✅ Draft done" (Issue #108). Notes
 * point at it by `id`, so the icon and label can be changed without touching a
 * single note.
 */
export interface CardStatus {
  /** Stable slug, frozen at creation. What a note's `status:` holds. */
  id: string
  /** Shown at the left of the card — usually one emoji. */
  icon: string
  /** What the status means; the icon's tooltip and the dropdown text. */
  label: string
}

/** A fresh family-tree view with everything defaulted. */
export function defaultView(id: string, name: string): View {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    mode: 'freeflow',
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
