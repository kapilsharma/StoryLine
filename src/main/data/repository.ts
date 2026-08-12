import { promises as fs } from 'fs'
import { basename, join } from 'path'
import type { Board, Character, Note, Project, TimelineUnit, View } from '@shared/types'
import { isEmptyEntityBody, normalizeEntityBody } from '@shared/entityBody'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'
import { exists, readText, writeTextGuarded } from './fsutil'
import {
  characterToFrontmatter,
  frontmatterToCharacter,
  frontmatterToNote,
  frontmatterToTimelineUnit,
  noteToFrontmatter,
  normalizeView,
  timelineUnitToFrontmatter
} from './mappers'

/**
 * High-level read/write over a project folder.
 *
 * Since schema v2, characters, timeline units and notes are **per board** and
 * live under `boards/<boardId>/{characters,timeline,notes}/`; the board file is
 * `boards/<boardId>/board.json`. Markdown entities round-trip frontmatter while
 * preserving the body; boards and project metadata are plain JSON.
 */

/** A value loaded from disk together with its mtime (for guarded writes). */
export interface Loaded<T> {
  value: T
  /** Carry into the matching write to detect external edits. */
  mtimeMs: number
  path: string
}

/**
 * Default body for a freshly-created timeline file. Characters no longer get it
 * (issue #33): the Characters tab reads "has a body" as "a note was written",
 * and a seeded skeleton would make every character look written-up.
 */
const ENTITY_BODY_TEMPLATE = '\n## Notes\n\n\n## Research\n\n'

// ── Path helpers ─────────────────────────────────────────────────────────────

const projectFile = (root: string): string => join(root, 'project.json')
const boardsDir = (root: string): string => join(root, 'boards')
const boardDir = (root: string, boardId: string): string => join(boardsDir(root), boardId)
const boardFile = (root: string, boardId: string): string => join(boardDir(root, boardId), 'board.json')
const charsDir = (root: string, boardId: string): string => join(boardDir(root, boardId), 'characters')
const timelineDir = (root: string, boardId: string): string => join(boardDir(root, boardId), 'timeline')
const notesDir = (root: string, boardId: string): string => join(boardDir(root, boardId), 'notes')
/**
 * Family-tree views live *under the board*, because a tree is drawn over one
 * board's cast — boards have been fully independent since v0.2.0 and a tree
 * spanning two of them would have no shared characters to draw.
 */
const viewsDir = (root: string, boardId: string): string => join(boardDir(root, boardId), 'views')

const charPath = (root: string, boardId: string, id: string): string =>
  join(charsDir(root, boardId), `${id}.md`)
const viewPath = (root: string, boardId: string, id: string): string =>
  join(viewsDir(root, boardId), `${id}.json`)
const timelinePath = (root: string, boardId: string, id: string): string =>
  join(timelineDir(root, boardId), `${id}.md`)
const notePath = (root: string, boardId: string, id: string): string =>
  join(notesDir(root, boardId), `${id}.md`)

/** List the `.md` filename stems in a directory (returns [] if absent). */
async function listStems(dir: string, ext: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return entries
    .filter((f) => f.endsWith(ext) && !f.startsWith('.'))
    .map((f) => basename(f, ext))
    .sort()
}

/** Create the folder structure for a board (idempotent). */
export async function ensureBoardDirs(root: string, boardId: string): Promise<void> {
  await Promise.all([
    fs.mkdir(charsDir(root, boardId), { recursive: true }),
    fs.mkdir(timelineDir(root, boardId), { recursive: true }),
    fs.mkdir(notesDir(root, boardId), { recursive: true }),
    fs.mkdir(viewsDir(root, boardId), { recursive: true })
  ])
}

// ── Project ──────────────────────────────────────────────────────────────────

/** Backfill defaults so older / partial project.json files load cleanly. */
function normalizeProject(raw: Partial<Project>): Project {
  return {
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
    name: raw.name ?? 'Untitled',
    timelineLabel: raw.timelineLabel ?? 'Chapter',
    boards: raw.boards ?? [],
    created: raw.created ?? '',
    lastOpened: raw.lastOpened ?? '',
    families: raw.families && typeof raw.families === 'object' ? raw.families : {}
  }
}

export async function readProject(root: string): Promise<Loaded<Project>> {
  const { text, mtimeMs } = await readText(projectFile(root))
  const value = normalizeProject(JSON.parse(text) as Partial<Project>)
  return { value, mtimeMs, path: projectFile(root) }
}

export async function writeProject(
  root: string,
  project: Project,
  expectedMtimeMs?: number
): Promise<number> {
  return writeTextGuarded(projectFile(root), JSON.stringify(project, null, 2) + '\n', expectedMtimeMs)
}

/** True if the folder looks like a ZN Story Line project (has project.json). */
export async function isProject(root: string): Promise<boolean> {
  return exists(projectFile(root))
}

// ── Characters (per board) ─────────────────────────────────────────────────────

export function listCharacterIds(root: string, boardId: string): Promise<string[]> {
  return listStems(charsDir(root, boardId), '.md')
}

export async function readCharacter(root: string, boardId: string, id: string): Promise<Loaded<Character>> {
  const path = charPath(root, boardId, id)
  const { text, mtimeMs } = await readText(path)
  const { data, body } = parseFrontmatter(text)
  const value = frontmatterToCharacter(data, id)
  // The file is read whole anyway, so "does this character have a note?" is free
  // here — and the board (issue #41) needs it for every row at once.
  if (!isEmptyEntityBody(body)) value.hasNote = true
  return { value, mtimeMs, path }
}

export async function listCharacters(root: string, boardId: string): Promise<Character[]> {
  const ids = await listCharacterIds(root, boardId)
  return Promise.all(ids.map(async (id) => (await readCharacter(root, boardId, id)).value))
}

export async function writeCharacter(
  root: string,
  boardId: string,
  char: Character,
  expectedMtimeMs?: number
): Promise<number> {
  const path = charPath(root, boardId, char.id)
  // New characters start with no body at all, and a file still carrying the old
  // empty skeleton sheds it here — the one place a character file is rewritten.
  let body = ''
  if (await exists(path)) {
    body = normalizeEntityBody(parseFrontmatter((await readText(path)).text).body)
  }
  await fs.mkdir(charsDir(root, boardId), { recursive: true })
  return writeTextGuarded(path, serializeFrontmatter(characterToFrontmatter(char), body), expectedMtimeMs)
}

export function deleteCharacter(root: string, boardId: string, id: string): Promise<void> {
  return fs.rm(charPath(root, boardId, id), { force: true })
}

/**
 * Move a character's file to a new id. Only the explicit "rename file" action
 * does this — ids are otherwise frozen at creation, because every relation
 * (`father`, `mother`, `spouse`, and the board's `rowOrder`/cards) points at one.
 */
export async function renameCharacterFile(
  root: string,
  boardId: string,
  oldId: string,
  newId: string
): Promise<void> {
  await fs.rename(charPath(root, boardId, oldId), charPath(root, boardId, newId))
}

// ── Timeline units (per board) ──────────────────────────────────────────────────

export function listTimelineIds(root: string, boardId: string): Promise<string[]> {
  return listStems(timelineDir(root, boardId), '.md')
}

export async function readTimelineUnit(
  root: string,
  boardId: string,
  id: string
): Promise<Loaded<TimelineUnit>> {
  const path = timelinePath(root, boardId, id)
  const { text, mtimeMs } = await readText(path)
  const { data } = parseFrontmatter(text)
  return { value: frontmatterToTimelineUnit(data, id), mtimeMs, path }
}

/** All timeline units on a board, sorted by their `order` field. */
export async function listTimeline(root: string, boardId: string): Promise<TimelineUnit[]> {
  const ids = await listTimelineIds(root, boardId)
  const units = await Promise.all(ids.map(async (id) => (await readTimelineUnit(root, boardId, id)).value))
  return units.sort((a, b) => a.order - b.order)
}

export async function writeTimelineUnit(
  root: string,
  boardId: string,
  unit: TimelineUnit,
  expectedMtimeMs?: number
): Promise<number> {
  const path = timelinePath(root, boardId, unit.id)
  let body = ENTITY_BODY_TEMPLATE
  if (await exists(path)) body = parseFrontmatter((await readText(path)).text).body
  await fs.mkdir(timelineDir(root, boardId), { recursive: true })
  return writeTextGuarded(path, serializeFrontmatter(timelineUnitToFrontmatter(unit), body), expectedMtimeMs)
}

export function deleteTimelineUnit(root: string, boardId: string, id: string): Promise<void> {
  return fs.rm(timelinePath(root, boardId, id), { force: true })
}

// ── Entity body (character / timeline markdown body, for the dedicated editor) ──

type BodyKind = 'character' | 'timeline'
const entityPath = (root: string, boardId: string, kind: BodyKind, id: string): string =>
  kind === 'character' ? charPath(root, boardId, id) : timelinePath(root, boardId, id)

/** Read the markdown body (prose after frontmatter) of a character/timeline file. */
export async function readEntityBody(
  root: string,
  boardId: string,
  kind: BodyKind,
  id: string
): Promise<string> {
  const { text } = await readText(entityPath(root, boardId, kind, id))
  return parseFrontmatter(text).body
}

/** Write a new body to a character/timeline file, preserving its frontmatter exactly. */
export async function writeEntityBody(
  root: string,
  boardId: string,
  kind: BodyKind,
  id: string,
  body: string
): Promise<void> {
  const path = entityPath(root, boardId, kind, id)
  const { data } = parseFrontmatter((await readText(path)).text)
  // A character body of nothing but empty `## Notes` / `## Research` headings is
  // "no note" to the Characters tab, so it is not worth keeping on disk either.
  await writeTextGuarded(
    path,
    serializeFrontmatter(data, kind === 'character' ? normalizeEntityBody(body) : body)
  )
}

// ── Notes (per board) ───────────────────────────────────────────────────────────

export function listNoteIds(root: string, boardId: string): Promise<string[]> {
  return listStems(notesDir(root, boardId), '.md')
}

export async function readNote(root: string, boardId: string, id: string): Promise<Loaded<Note>> {
  const path = notePath(root, boardId, id)
  const { text, mtimeMs } = await readText(path)
  const { data, body } = parseFrontmatter(text)
  return { value: frontmatterToNote(data, id, body), mtimeMs, path }
}

export async function listNotes(root: string, boardId: string): Promise<Note[]> {
  const ids = await listNoteIds(root, boardId)
  return Promise.all(ids.map(async (id) => (await readNote(root, boardId, id)).value))
}

export async function writeNote(
  root: string,
  boardId: string,
  note: Note,
  expectedMtimeMs?: number
): Promise<number> {
  await fs.mkdir(notesDir(root, boardId), { recursive: true })
  const out = serializeFrontmatter(noteToFrontmatter(note), note.body)
  return writeTextGuarded(notePath(root, boardId, note.id), out, expectedMtimeMs)
}

/**
 * Note metadata for a board — everything except the body. Used for board/list
 * views (cards show only the title now); the body is fetched lazily when a note
 * popup opens. Still opens each file (needed for uid + title).
 */
export async function listNoteMetas(root: string, boardId: string): Promise<Note[]> {
  const ids = await listNoteIds(root, boardId)
  return Promise.all(
    ids.map(async (id) => {
      const { value } = await readNote(root, boardId, id)
      // The file was read whole anyway, so record whether the body held
      // anything before dropping it — that flag is what marks a card as
      // having more inside (issue #46).
      const meta: Note = { ...value, body: '' }
      if (value.body.trim() !== '') meta.hasBody = true
      return meta
    })
  )
}

export function deleteNote(root: string, boardId: string, id: string): Promise<void> {
  return fs.rm(notePath(root, boardId, id), { force: true })
}

/** Rename a note's markdown file within a board (uid/frontmatter untouched). */
export async function renameNoteFile(
  root: string,
  boardId: string,
  oldId: string,
  newId: string
): Promise<void> {
  await fs.rename(notePath(root, boardId, oldId), notePath(root, boardId, newId))
}

// ── Boards ───────────────────────────────────────────────────────────────────

/** Board ids = subfolders of boards/ that contain a board.json. */
export async function listBoardIds(root: string): Promise<string[]> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(boardsDir(root), { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  const withBoard = await Promise.all(dirs.map(async (d) => ((await exists(boardFile(root, d))) ? d : null)))
  return withBoard.filter((d): d is string => d !== null).sort()
}

/** Backfill fields added in later versions so older board files stay valid. */
function normalizeBoard(raw: Partial<Board> & { id: string; name: string }): Board {
  return {
    id: raw.id,
    name: raw.name,
    cards: raw.cards ?? [],
    hiddenRows: raw.hiddenRows ?? [],
    hiddenCols: raw.hiddenCols ?? [],
    presets: raw.presets ?? [],
    // Absent (pre-v0.6.0) must stay null, not become []: null means "every
    // character is a row", [] means "no character is". Collapsing them would
    // empty every existing board on upgrade.
    members: Array.isArray(raw.members)
      ? raw.members.filter((m): m is string => typeof m === 'string')
      : null,
    rowOrder: raw.rowOrder ?? [],
    rowGroupOrder: raw.rowGroupOrder ?? [],
    colOrder: raw.colOrder ?? [],
    collapsedRowGroups: raw.collapsedRowGroups ?? [],
    collapsedColGroups: raw.collapsedColGroups ?? [],
    zoom: raw.zoom ?? 1,
    views: raw.views ?? []
  }
}

export async function readBoard(root: string, boardId: string): Promise<Loaded<Board>> {
  const path = boardFile(root, boardId)
  const { text, mtimeMs } = await readText(path)
  const value = normalizeBoard(JSON.parse(text) as Partial<Board> & { id: string; name: string })
  return { value, mtimeMs, path }
}

export async function listBoards(root: string): Promise<Board[]> {
  const ids = await listBoardIds(root)
  return Promise.all(ids.map(async (id) => (await readBoard(root, id)).value))
}

export async function writeBoard(
  root: string,
  board: Board,
  expectedMtimeMs?: number
): Promise<number> {
  await fs.mkdir(boardDir(root, board.id), { recursive: true })
  return writeTextGuarded(boardFile(root, board.id), JSON.stringify(board, null, 2) + '\n', expectedMtimeMs)
}

export function deleteBoard(root: string, boardId: string): Promise<void> {
  return fs.rm(boardDir(root, boardId), { recursive: true, force: true })
}

// ── Family-tree views (per board) ────────────────────────────────────────────

export function listViewIds(root: string, boardId: string): Promise<string[]> {
  return listStems(viewsDir(root, boardId), '.json')
}

export async function readView(root: string, boardId: string, id: string): Promise<Loaded<View>> {
  const path = viewPath(root, boardId, id)
  const { text, mtimeMs } = await readText(path)
  return { value: normalizeView(JSON.parse(text) as Partial<View>, id), mtimeMs, path }
}

/**
 * Every view on a board, in `board.views` order. A view file not listed there
 * (added externally) is appended rather than hidden, mirroring how `loadSnapshot`
 * treats board folders missing from `project.boards`.
 */
export async function listViews(root: string, boardId: string, order: string[] = []): Promise<View[]> {
  const onDisk = await listViewIds(root, boardId)
  const ordered = order.filter((id) => onDisk.includes(id))
  const extra = onDisk.filter((id) => !ordered.includes(id))
  return Promise.all([...ordered, ...extra].map(async (id) => (await readView(root, boardId, id)).value))
}

export async function writeView(
  root: string,
  boardId: string,
  view: View,
  expectedMtimeMs?: number
): Promise<number> {
  await fs.mkdir(viewsDir(root, boardId), { recursive: true })
  return writeTextGuarded(
    viewPath(root, boardId, view.id),
    JSON.stringify(view, null, 2) + '\n',
    expectedMtimeMs
  )
}

export function deleteView(root: string, boardId: string, id: string): Promise<void> {
  return fs.rm(viewPath(root, boardId, id), { force: true })
}
