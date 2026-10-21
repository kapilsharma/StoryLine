/**
 * The IPC contract shared between the main process and the renderer.
 * The preload bridge implements `AppApi`; the renderer consumes it via
 * `window.api`.
 *
 * Convention: every call that changes the project returns a `SnapshotReply` —
 * usually just what changed since the renderer's copy (#188), the whole
 * `ProjectSnapshot` when that can't be described as a patch. The renderer merges
 * it with `applyReply` (`src/shared/patch.ts`). The filesystem watcher remains a
 * backstop for *external* edits.
 */
import type {
  Board,
  Card,
  Character,
  ColumnGroup,
  ManuscriptCellRef,
  Note,
  Problem,
  Project,
  TimelineUnit,
  View,
  ViewMode
} from './types'
import type { AppConfig, AppSettings } from './config'
import type { ProjectMeta } from './project'
import type { ProjectChange } from './changes'
import type { ProjectPatch } from './patch'
import type { SearchHit, SearchScope } from './search'
import type { AssetImport, AssetRef } from './assets'
import type { ColumnRef } from './columns'
import type { OutlineItem } from './outline'
import type { MarkdownExportOptions } from './exportMarkdown'

/**
 * Entities whose markdown body the dedicated editor can edit (notes use
 * getNote/saveNote). A `colgroup`'s body is the note of that tier (Issue #104).
 */
export type EntityBodyKind = 'character' | 'timeline' | 'colgroup'

/**
 * A board and the entities it owns. Since v2 (schemaVersion 2), characters,
 * timeline units and notes are per-board rather than project-global.
 */
export interface BoardData {
  board: Board
  characters: Character[]
  timeline: TimelineUnit[]
  /**
   * The groups the columns hang under — Parts, Novels, Chapters-with-scenes
   * (Issue #104). Empty for a flat board. `hasNote` is set, the bodies are not.
   */
  colGroups: ColumnGroup[]
  notes: Note[]
  /**
   * Saved family trees over this board's cast (v0.6.0). A board with no
   * `views/` folder simply has none — the Family tab offers to create the first.
   */
  views: View[]
  /**
   * Dangling parent/spouse refs, cycles and asymmetric spouses found while
   * building this board's family graph. Reported, never thrown — a cast is
   * always partially entered.
   */
  problems: Problem[]
}

/** A bundle of everything needed to render an open project. */
export interface ProjectSnapshot {
  root: string
  project: Project
  boards: BoardData[]
}

/**
 * What a call that changes the project sends back (#188).
 *
 * The main process holds the open project in memory (#184) and numbers every
 * state of it. A reply is either the whole snapshot at some `version`, or the
 * `patch` that takes the renderer's copy from `from` — the last version it was
 * sent — to `version`. At 3,000 cards the whole snapshot is ~1 MB, ~20 ms to
 * clone on each side of the IPC and a fresh identity for every object the board
 * memoises on; an autosave's patch is one note.
 *
 * The renderer applies a patch only onto the version it names; anything else is
 * a gap, and it asks for the whole project again (`applyReply`).
 */
export type SnapshotReply =
  | { kind: 'snapshot'; version: number; snapshot: ProjectSnapshot }
  | { kind: 'patch'; root: string; from: number; version: number; patch: ProjectPatch }

/** Fields needed to create a card (and its backing note) from an empty cell. */
export interface NewCardInput {
  boardId: string
  title: string
  rowId: string
  colStart: string
  colEnd: string
  /** A Manuscript-row cell (#204): the column the new note is the prose of. */
  cell?: ManuscriptCellRef
}

export interface AppApi {
  // ── App config ──
  getConfig(): Promise<AppConfig>
  updateSettings(settings: AppSettings): Promise<AppConfig>

  // ── Project lifecycle ──
  createProject(): Promise<string | null>
  pickProject(): Promise<string | null>
  openProject(root: string): Promise<SnapshotReply>
  reloadProject(root: string): Promise<SnapshotReply>
  /**
   * Re-read only the entities named by a batch of watcher changes and return a
   * patch to merge into the current snapshot (#131). The focused counterpart of
   * {@link reloadProject}: the renderer calls this when {@link ProjectChange}s
   * are all board-local, so an external edit of one note costs one file read
   * instead of re-reading every board. Removed entities come back as a null-value
   * op; board/project adds and removals go through `reloadProject` instead.
   */
  reloadChanges(root: string, changes: ProjectChange[]): Promise<SnapshotReply>
  removeRecent(root: string): Promise<AppConfig>
  /** Update project-level metadata (name, row/timeline labels, project kind). */
  saveProjectMeta(root: string, meta: ProjectMeta): Promise<SnapshotReply>
  /** Persist the family → colour map used by the family tree. */
  saveFamilyColours(root: string, families: Record<string, string>): Promise<SnapshotReply>

  // ── Characters (per board) ──
  /**
   * Saves the character and keeps spouse links symmetric on the other side.
   *
   * Creating a character does **not** put them on the board grid — membership is
   * opt-in, so a relative entered for the family tree stays off the plot. Pass
   * `addToBoard` for a character created *from* the board ("+ Row"), where being
   * a row is the reason it exists. Ignored when updating an existing character.
   */
  saveCharacter(
    root: string,
    boardId: string,
    character: Character,
    addToBoard?: boolean
  ): Promise<SnapshotReply>
  /** Removes the file, its cards, and every inbound father/mother/spouse ref. */
  /**
   * Create many characters at once ("Add multiple characters", Issue #175) and
   * put them on the board. Family links between them use `newRef(i)` ids.
   */
  addCharacters(root: string, boardId: string, characters: Character[]): Promise<SnapshotReply>
  deleteCharacter(root: string, boardId: string, id: string): Promise<SnapshotReply>
  /**
   * Renames the character's *file* and retargets every relation pointing at the
   * old id in one batch. Ids are otherwise frozen at creation.
   */
  renameCharacter(
    root: string,
    boardId: string,
    oldId: string,
    newName: string
  ): Promise<SnapshotReply>
  /**
   * Applies a Children edit by rewriting the children's `father`/`mother` —
   * children are derived, never stored on the parent.
   */
  setChildren(
    root: string,
    boardId: string,
    parentId: string,
    childIds: string[]
  ): Promise<SnapshotReply>

  // ── Timeline units (per board) ──
  saveTimelineUnit(root: string, boardId: string, unit: TimelineUnit): Promise<SnapshotReply>
  deleteTimelineUnit(root: string, boardId: string, id: string): Promise<SnapshotReply>

  // ── Column hierarchy (per board, Issue #104) ──
  /**
   * Create or update a group. An empty `id` creates one; the label of an existing
   * group can change freely because its id — and so its note — never does.
   */
  saveColumnGroup(root: string, boardId: string, group: ColumnGroup): Promise<SnapshotReply>
  /**
   * Delete a group **and everything under it** — child groups, their columns and
   * those columns' cards. The renderer asks first (listing what will go); this
   * does not.
   */
  deleteColumnGroup(root: string, boardId: string, id: string): Promise<SnapshotReply>
  /**
   * Put the children of `parentId` (null = top level) in the order given. Anything
   * left out keeps its relative order after the named ones.
   */
  reorderColumns(
    root: string,
    boardId: string,
    parentId: string | null,
    order: ColumnRef[]
  ): Promise<SnapshotReply>
  /**
   * Move a group or column under `newParentId` (null = top level), at `index` among
   * its new siblings (omitted = last). Rejects a group moved into its own subtree.
   */
  moveColumn(
    root: string,
    boardId: string,
    ref: ColumnRef,
    newParentId: string | null,
    index?: number
  ): Promise<SnapshotReply>
  /**
   * "Break this chapter into scenes": insert a new group, labelled `label`, in the
   * place of a column and put the column under it. The column keeps its id, cards
   * and note, so nothing needs repointing; `moveNote` carries its note up to the
   * new group instead of leaving it on the column.
   */
  wrapColumnInGroup(
    root: string,
    boardId: string,
    unitId: string,
    label: string,
    moveNote: boolean
  ): Promise<SnapshotReply>
  /**
   * Create a whole outline of groups and columns at once ("Add multiple chapters",
   * Issue #172), appended at the top level after what is already there.
   */
  addColumnOutline(root: string, boardId: string, items: OutlineItem[]): Promise<SnapshotReply>

  // ── Notes (per board) ──
  saveNote(root: string, boardId: string, note: Note): Promise<SnapshotReply>
  deleteNote(root: string, boardId: string, id: string): Promise<SnapshotReply>
  /** Fetch a note's full content (incl. body) — bodies are lazy-loaded. */
  getNote(root: string, boardId: string, id: string): Promise<Note>
  /** Rename a note's markdown file; fixes `related:` links, keeps cards intact. */
  renameNote(root: string, boardId: string, oldId: string, newName: string): Promise<SnapshotReply>

  // ── Entity body (character / timeline markdown body) ──
  getEntityBody(root: string, boardId: string, kind: EntityBodyKind, id: string): Promise<string>
  saveEntityBody(
    root: string,
    boardId: string,
    kind: EntityBodyKind,
    id: string,
    body: string
  ): Promise<SnapshotReply>

  // ── Boards ──
  saveBoard(root: string, board: Board): Promise<SnapshotReply>
  createBoard(root: string, name: string): Promise<SnapshotReply>
  renameBoard(root: string, id: string, name: string): Promise<SnapshotReply>
  deleteBoard(root: string, id: string): Promise<SnapshotReply>
  /** Persist a new board display order; `orderedIds` becomes `project.boards`. */
  reorderBoards(root: string, orderedIds: string[]): Promise<SnapshotReply>

  // ── Family-tree views (per board) ──
  saveView(root: string, boardId: string, view: View): Promise<SnapshotReply>
  createView(
    root: string,
    boardId: string,
    name: string,
    rootCharacterId?: string | null,
    mode?: ViewMode
  ): Promise<SnapshotReply>
  /** Copies the source view's filters; the copy gets a fresh camera. */
  duplicateView(root: string, boardId: string, id: string, name: string): Promise<SnapshotReply>
  renameView(root: string, boardId: string, id: string, name: string): Promise<SnapshotReply>
  deleteView(root: string, boardId: string, id: string): Promise<SnapshotReply>
  reorderViews(root: string, boardId: string, orderedIds: string[]): Promise<SnapshotReply>

  // ── Cards ──
  createCard(root: string, input: NewCardInput): Promise<SnapshotReply>
  updateCard(root: string, boardId: string, card: Card): Promise<SnapshotReply>
  deleteCard(root: string, boardId: string, cardId: string): Promise<SnapshotReply>

  // ── Search (Issues #59, #60) ──
  /**
   * Full-text search over note, character and timeline bodies.
   *
   * Runs in the main process because note bodies are not in the snapshot —
   * `listNoteMetas` drops them on purpose. An empty `scope.boardIds` searches
   * every board, which is the whole point of #60.
   */
  searchNotes(root: string, query: string, scope: SearchScope): Promise<SearchHit[]>

  // ── Assets (Issue #61) ──
  /**
   * Copy a file into `boards/<boardId>/assets/`, de-duplicating the name, and
   * return what to write in the markdown. Rejects unknown extensions and
   * anything over {@link MAX_ASSET_BYTES}.
   */
  importAsset(root: string, boardId: string, file: AssetImport): Promise<AssetRef>
  /** Open the OS file picker and import whatever is chosen. Null if cancelled. */
  pickAsset(root: string, boardId: string): Promise<AssetRef | null>

  // ── Live reload ──
  onProjectChange(listener: (change: ProjectChange) => void): () => void

  // ── Static site export (Issue #48) ──
  /**
   * Export the project as a self-contained static site — the in-app
   * counterpart of `npm run export:static`. Opens a native folder picker for
   * the destination; every board and the app's current appearance settings
   * are used, same as the CLI's defaults. Null if the picker was cancelled.
   *
   * When `root` sits next to a `projectgroup.json` listing more than one
   * project, the user is asked (native dialog) whether to export just this
   * project or every project in the group (Issue #101) — in the latter case
   * each lands in its own `<outDir>/<folder>` and the result's `projects`
   * lists what was exported.
   */
  exportStaticSite(root: string): Promise<StaticExportResult | null>

  // ── Document export (Issue #125) ──
  /**
   * Flatten one board into a single Markdown or PDF document for reading or
   * printing — unrelated to {@link exportStaticSite}, which publishes the whole
   * project as an interactive web app. Opens a native save dialog; null if the
   * save was cancelled.
   */
  exportDocument(
    root: string,
    boardId: string,
    options: DocExportOptions
  ): Promise<DocExportResult | null>
}

/** Summary returned after a successful in-app static export. */
export interface StaticExportResult {
  outDir: string
  files: number
  bytes: number
  /** Present only when the user chose to export every project in the group. */
  projects?: { folder: string; name: string }[]
}

/** Output format for a document export (Issue #125). */
export type DocExportFormat = 'markdown' | 'pdf'

/** What a document export covers, plus the format to write it in (Issue #125). */
export interface DocExportOptions extends MarkdownExportOptions {
  format: DocExportFormat
}

/** Where a document export landed and how big it is. */
export interface DocExportResult {
  path: string
  bytes: number
}
