/**
 * The IPC contract shared between the main process and the renderer.
 * The preload bridge implements `AppApi`; the renderer consumes it via
 * `window.api`.
 *
 * Convention: every mutating call returns a fresh `ProjectSnapshot` so the
 * renderer can replace its state in one step. The filesystem watcher remains a
 * backstop for *external* edits.
 */
import type { Board, Card, Character, Note, Problem, Project, TimelineUnit, View, ViewMode } from './types'
import type { AppConfig, AppSettings } from './config'
import type { ProjectMeta } from './project'
import type { ProjectChange } from './changes'
import type { SearchHit, SearchScope } from './search'
import type { AssetImport, AssetRef } from './assets'

/** Entities whose markdown body the dedicated editor can edit (notes use getNote/saveNote). */
export type EntityBodyKind = 'character' | 'timeline'

/**
 * A board and the entities it owns. Since v2 (schemaVersion 2), characters,
 * timeline units and notes are per-board rather than project-global.
 */
export interface BoardData {
  board: Board
  characters: Character[]
  timeline: TimelineUnit[]
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

/** Fields needed to create a card (and its backing note) from an empty cell. */
export interface NewCardInput {
  boardId: string
  title: string
  rowId: string
  colStart: string
  colEnd: string
}

export interface AppApi {
  // ── App config ──
  getConfig(): Promise<AppConfig>
  updateSettings(settings: AppSettings): Promise<AppConfig>

  // ── Project lifecycle ──
  createProject(): Promise<string | null>
  pickProject(): Promise<string | null>
  openProject(root: string): Promise<ProjectSnapshot>
  reloadProject(root: string): Promise<ProjectSnapshot>
  removeRecent(root: string): Promise<AppConfig>
  /** Update project-level metadata (name, row/timeline labels, project kind). */
  saveProjectMeta(root: string, meta: ProjectMeta): Promise<ProjectSnapshot>
  /** Persist the family → colour map used by the family tree. */
  saveFamilyColours(root: string, families: Record<string, string>): Promise<ProjectSnapshot>

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
  ): Promise<ProjectSnapshot>
  /** Removes the file, its cards, and every inbound father/mother/spouse ref. */
  deleteCharacter(root: string, boardId: string, id: string): Promise<ProjectSnapshot>
  /**
   * Renames the character's *file* and retargets every relation pointing at the
   * old id in one batch. Ids are otherwise frozen at creation.
   */
  renameCharacter(
    root: string,
    boardId: string,
    oldId: string,
    newName: string
  ): Promise<ProjectSnapshot>
  /**
   * Applies a Children edit by rewriting the children's `father`/`mother` —
   * children are derived, never stored on the parent.
   */
  setChildren(
    root: string,
    boardId: string,
    parentId: string,
    childIds: string[]
  ): Promise<ProjectSnapshot>

  // ── Timeline units (per board) ──
  saveTimelineUnit(root: string, boardId: string, unit: TimelineUnit): Promise<ProjectSnapshot>
  deleteTimelineUnit(root: string, boardId: string, id: string): Promise<ProjectSnapshot>
  /** Persist a new ordering; `orderedIds` becomes each unit's `order` index. */
  reorderTimeline(root: string, boardId: string, orderedIds: string[]): Promise<ProjectSnapshot>

  // ── Notes (per board) ──
  saveNote(root: string, boardId: string, note: Note): Promise<ProjectSnapshot>
  deleteNote(root: string, boardId: string, id: string): Promise<ProjectSnapshot>
  /** Fetch a note's full content (incl. body) — bodies are lazy-loaded. */
  getNote(root: string, boardId: string, id: string): Promise<Note>
  /** Rename a note's markdown file; fixes `related:` links, keeps cards intact. */
  renameNote(root: string, boardId: string, oldId: string, newName: string): Promise<ProjectSnapshot>

  // ── Entity body (character / timeline markdown body) ──
  getEntityBody(root: string, boardId: string, kind: EntityBodyKind, id: string): Promise<string>
  saveEntityBody(
    root: string,
    boardId: string,
    kind: EntityBodyKind,
    id: string,
    body: string
  ): Promise<ProjectSnapshot>

  // ── Boards ──
  saveBoard(root: string, board: Board): Promise<ProjectSnapshot>
  createBoard(root: string, name: string): Promise<ProjectSnapshot>
  renameBoard(root: string, id: string, name: string): Promise<ProjectSnapshot>
  deleteBoard(root: string, id: string): Promise<ProjectSnapshot>
  /** Persist a new board display order; `orderedIds` becomes `project.boards`. */
  reorderBoards(root: string, orderedIds: string[]): Promise<ProjectSnapshot>

  // ── Family-tree views (per board) ──
  saveView(root: string, boardId: string, view: View): Promise<ProjectSnapshot>
  createView(
    root: string,
    boardId: string,
    name: string,
    rootCharacterId?: string | null,
    mode?: ViewMode
  ): Promise<ProjectSnapshot>
  /** Copies the source view's filters; the copy gets a fresh camera. */
  duplicateView(root: string, boardId: string, id: string, name: string): Promise<ProjectSnapshot>
  renameView(root: string, boardId: string, id: string, name: string): Promise<ProjectSnapshot>
  deleteView(root: string, boardId: string, id: string): Promise<ProjectSnapshot>
  reorderViews(root: string, boardId: string, orderedIds: string[]): Promise<ProjectSnapshot>

  // ── Cards ──
  createCard(root: string, input: NewCardInput): Promise<ProjectSnapshot>
  updateCard(root: string, boardId: string, card: Card): Promise<ProjectSnapshot>
  deleteCard(root: string, boardId: string, cardId: string): Promise<ProjectSnapshot>

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
}
