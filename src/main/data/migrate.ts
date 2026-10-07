import { promises as fs } from 'fs'
import { basename, join } from 'path'
import { SCHEMA_VERSION, type Board, type Card } from '@shared/types'
import { exists } from './fsutil'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'
import { uniqueNoteUid } from './uid'
import { uniqueSlug } from './slug'

/**
 * Schema migrations over the on-disk project. Runs on open when the stamped
 * `schemaVersion` is behind the app. Each migration backs up first and is
 * written to be safe to re-run.
 */

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as T
}

/** Pre-v3 card shape (linked notes by filename before uids existed). */
interface LegacyCard {
  id: string
  rowId: string
  colStart: string
  colEnd: string
  noteFile?: string
}
interface LegacyBoard {
  id?: string
  name?: string
  cards?: LegacyCard[]
  rowOrder?: string[]
  colOrder?: string[]
  [key: string]: unknown
}

/** Read `.md` stems in a dir ([] if missing). */
async function mdStems(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md'))
  } catch {
    return []
  }
}

/**
 * Whether `root`'s stamped `schemaVersion` is behind the app's, without
 * running any migration. Used to warn before a bulk operation (grouped
 * "export all") would silently migrate a sibling project the user hasn't
 * opened themselves. `false` for an unreadable `project.json` — that's a
 * different failure `loadSnapshot` will surface on its own.
 */
export async function needsMigration(root: string): Promise<boolean> {
  let project: Record<string, unknown>
  try {
    project = await readJson(join(root, 'project.json'))
  } catch {
    return false
  }
  const version = typeof project.schemaVersion === 'number' ? (project.schemaVersion as number) : 1
  return version < SCHEMA_VERSION
}

export async function migrateIfNeeded(root: string): Promise<void> {
  const projectPath = join(root, 'project.json')
  let project: Record<string, unknown>
  try {
    project = await readJson(projectPath)
  } catch {
    return // not a readable project — loadSnapshot will surface the error
  }
  let version = typeof project.schemaVersion === 'number' ? (project.schemaVersion as number) : 1

  if (version < 2) {
    await migrateV1toV2(root, project)
    project = await readJson(projectPath)
    version = 2
  }
  if (version < 3) {
    await migrateV2toV3(root, project)
    project = await readJson(projectPath)
    version = 3
  }
  if (version < 4) {
    await migrateV3toV4(root, project)
  }
}

/**
 * v1 → v2: characters, timeline and notes move from project-global folders to
 * per-board folders (`boards/<id>/{board.json,characters,timeline,notes}`).
 * Each board gets the entities its cards/order reference; anything unreferenced
 * goes to the first board so nothing is lost.
 */
async function migrateV1toV2(root: string, project: Record<string, unknown>): Promise<void> {
  const boardsDir = join(root, 'boards')
  const oldChars = join(root, 'characters')
  const oldTimeline = join(root, 'timeline')
  const oldNotes = join(root, 'notes')

  // 1) Back up the original layout (once).
  const backup = join(root, '.zn-story-line-backup-v1')
  if (!(await exists(backup))) {
    await fs.mkdir(backup, { recursive: true })
    for (const item of ['project.json', 'characters', 'timeline', 'notes', 'boards']) {
      const src = join(root, item)
      if (await exists(src)) await fs.cp(src, join(backup, item), { recursive: true })
    }
  }

  // 2) Old flat board files (boards/*.json).
  let boardFiles: string[] = []
  try {
    boardFiles = (await fs.readdir(boardsDir)).filter((f) => f.endsWith('.json'))
  } catch {
    // no boards dir
  }

  const copyMd = async (srcDir: string, id: string, destDir: string): Promise<boolean> => {
    const src = join(srcDir, `${id}.md`)
    if (await exists(src)) {
      await fs.mkdir(destDir, { recursive: true })
      await fs.copyFile(src, join(destDir, `${id}.md`))
      return true
    }
    return false
  }

  const assignedChars = new Set<string>()
  const assignedTimeline = new Set<string>()
  const assignedNotes = new Set<string>()
  const boardIds: string[] = []

  for (const file of boardFiles) {
    const board = await readJson<LegacyBoard>(join(boardsDir, file))
    const id = board.id || basename(file, '.json')
    boardIds.push(id)
    const bDir = join(boardsDir, id)
    await fs.mkdir(bDir, { recursive: true })
    await fs.writeFile(join(bDir, 'board.json'), JSON.stringify(board, null, 2) + '\n')

    const cards = board.cards ?? []
    const charIds = new Set<string>([...(board.rowOrder ?? []), ...cards.map((c) => c.rowId)])
    const colIds = new Set<string>([
      ...(board.colOrder ?? []),
      ...cards.flatMap((c) => [c.colStart, c.colEnd])
    ])
    const noteIds = new Set<string>(cards.map((c) => basename(c.noteFile ?? '', '.md')).filter(Boolean))

    for (const cid of charIds) if (await copyMd(oldChars, cid, join(bDir, 'characters'))) assignedChars.add(cid)
    for (const tid of colIds) if (await copyMd(oldTimeline, tid, join(bDir, 'timeline'))) assignedTimeline.add(tid)
    for (const nid of noteIds) if (await copyMd(oldNotes, nid, join(bDir, 'notes'))) assignedNotes.add(nid)
  }

  // Ensure at least one board exists.
  if (boardIds.length === 0) {
    const id = 'main'
    boardIds.push(id)
    const bDir = join(boardsDir, id)
    await fs.mkdir(bDir, { recursive: true })
    const board: Board = {
      id,
      name: 'Main Board',
      cards: [],
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      // Deliberately null, not []: this board is about to receive every
      // character from the old flat layout, and they must all stay rows.
      members: null,
      rowOrder: [],
      rowGroupOrder: [],
      colOrder: [],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1,
      views: []
    }
    await fs.writeFile(join(bDir, 'board.json'), JSON.stringify(board, null, 2) + '\n')
  }

  // 3) Unreferenced (standalone) entities → the first board.
  const firstDir = join(boardsDir, boardIds[0])
  for (const cid of await mdStems(oldChars)) if (!assignedChars.has(cid)) await copyMd(oldChars, cid, join(firstDir, 'characters'))
  for (const tid of await mdStems(oldTimeline)) if (!assignedTimeline.has(tid)) await copyMd(oldTimeline, tid, join(firstDir, 'timeline'))
  for (const nid of await mdStems(oldNotes)) if (!assignedNotes.has(nid)) await copyMd(oldNotes, nid, join(firstDir, 'notes'))

  // 4) Remove the old global folders and flat board files.
  await fs.rm(oldChars, { recursive: true, force: true })
  await fs.rm(oldTimeline, { recursive: true, force: true })
  await fs.rm(oldNotes, { recursive: true, force: true })
  for (const file of boardFiles) await fs.rm(join(boardsDir, file), { force: true })

  // 5) Stamp the new schema version.
  project.schemaVersion = 2
  project.boards = boardIds
  await fs.writeFile(join(root, 'project.json'), JSON.stringify(project, null, 2) + '\n')
}

/**
 * v2 → v3: give every note a stable `uid` in its frontmatter and switch card
 * links from filename (`noteFile`) to `noteUid`, so files can be renamed (even
 * externally) without breaking cards. `related:` links stay filename-based.
 */
async function migrateV2toV3(root: string, project: Record<string, unknown>): Promise<void> {
  const boardsDir = join(root, 'boards')

  // 1) Back up (once).
  const backup = join(root, '.zn-story-line-backup-v2')
  if (!(await exists(backup))) {
    await fs.mkdir(backup, { recursive: true })
    for (const item of ['project.json', 'boards']) {
      const src = join(root, item)
      if (await exists(src)) await fs.cp(src, join(backup, item), { recursive: true })
    }
  }

  let boardDirs: string[] = []
  try {
    const entries = await fs.readdir(boardsDir, { withFileTypes: true })
    boardDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  } catch {
    // no boards
  }

  for (const boardId of boardDirs) {
    const boardFile = join(boardsDir, boardId, 'board.json')
    if (!(await exists(boardFile))) continue
    const notesDir = join(boardsDir, boardId, 'notes')

    // Stamp a uid into every note that lacks one; build filename → uid.
    const idToUid = new Map<string, string>()
    const usedUids = new Set<string>()
    for (const noteId of await mdStems(notesDir)) {
      const path = join(notesDir, `${noteId}.md`)
      const { data, body } = parseFrontmatter(await fs.readFile(path, 'utf8'))
      let uid = typeof data.uid === 'string' && data.uid.trim() ? data.uid.trim() : ''
      if (!uid || usedUids.has(uid)) {
        uid = uniqueNoteUid(usedUids)
        await fs.writeFile(path, serializeFrontmatter({ uid, ...data }, body))
      }
      usedUids.add(uid)
      idToUid.set(noteId, uid)
    }

    // Rewrite card links: noteFile → noteUid (drop cards whose note is gone).
    const board = await readJson<LegacyBoard>(boardFile)
    const newCards: Card[] = []
    for (const c of board.cards ?? []) {
      const noteId = c.noteFile ? basename(c.noteFile, '.md') : ''
      const uid = idToUid.get(noteId)
      if (!uid) continue
      newCards.push({ id: c.id, noteUid: uid, rowId: c.rowId, colStart: c.colStart, colEnd: c.colEnd })
    }
    const { cards: _oldCards, ...restBoard } = board
    await fs.writeFile(boardFile, JSON.stringify({ ...restBoard, cards: newCards }, null, 2) + '\n')
  }

  project.schemaVersion = 3
  await fs.writeFile(join(root, 'project.json'), JSON.stringify(project, null, 2) + '\n')
}

/**
 * v3 → v4 (Issue #104): a column group stops being a string repeated on each
 * timeline unit and becomes an entity — `colgroups/<id>.md` — that units point at
 * with `parent`. That is what lets a group carry a note that survives a rename.
 *
 * The migrated tree has to *draw identically* to the old board, and the old
 * layout gathered every unit sharing a `group` label into one block at the
 * position of the first of them. So the same gathering is done here: blocks are
 * taken in order of first appearance, and a unit's new `order` is its place among
 * its siblings. Groups are created with an empty note.
 */
async function migrateV3toV4(root: string, project: Record<string, unknown>): Promise<void> {
  const boardsDir = join(root, 'boards')

  const backup = join(root, '.zn-story-line-backup-v3')
  if (!(await exists(backup))) {
    await fs.mkdir(backup, { recursive: true })
    for (const item of ['project.json', 'boards']) {
      const src = join(root, item)
      if (await exists(src)) await fs.cp(src, join(backup, item), { recursive: true })
    }
  }

  let boardDirs: string[] = []
  try {
    const entries = await fs.readdir(boardsDir, { withFileTypes: true })
    boardDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  } catch {
    // no boards
  }

  let anyGrouped = false

  for (const boardId of boardDirs) {
    const boardFile = join(boardsDir, boardId, 'board.json')
    if (!(await exists(boardFile))) continue
    const timelineDir = join(boardsDir, boardId, 'timeline')
    const groupsDir = join(boardsDir, boardId, 'colgroups')

    interface Parsed {
      id: string
      data: Record<string, unknown>
      body: string
      order: number
      group: string | null
    }
    const units: Parsed[] = []
    for (const id of await mdStems(timelineDir)) {
      const { data, body } = parseFrontmatter(await fs.readFile(join(timelineDir, `${id}.md`), 'utf8'))
      const group = typeof data.group === 'string' && data.group.trim() ? data.group.trim() : null
      units.push({ id, data, body, order: typeof data.order === 'number' ? data.order : 0, group })
    }
    units.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

    // Groups a previous, interrupted run already wrote are reused rather than duplicated.
    const nodeIdOf = new Map<string, string>()
    const takenIds = new Set<string>()
    for (const id of await mdStems(groupsDir)) {
      takenIds.add(id)
      const { data } = parseFrontmatter(await fs.readFile(join(groupsDir, `${id}.md`), 'utf8'))
      if (typeof data.label === 'string') nodeIdOf.set(data.label, id)
    }

    // Gather blocks the way the old layout did: by first appearance of a label.
    type Block = { group: string | null; members: Parsed[] }
    const blocks: Block[] = []
    const byGroup = new Map<string, Block>()
    for (const u of units) {
      if (u.group === null) {
        blocks.push({ group: null, members: [u] })
        continue
      }
      let block = byGroup.get(u.group)
      if (!block) {
        block = { group: u.group, members: [] }
        byGroup.set(u.group, block)
        blocks.push(block)
      }
      block.members.push(u)
    }

    const writeUnit = async (u: Parsed, order: number, parent: string | null): Promise<void> => {
      const { group: _retired, ...rest } = u.data
      const next: Record<string, unknown> = { ...rest, order }
      if (parent) next.parent = parent
      await fs.writeFile(join(timelineDir, `${u.id}.md`), serializeFrontmatter(next, u.body))
    }

    for (const [blockIndex, block] of blocks.entries()) {
      if (block.group === null) {
        await writeUnit(block.members[0], blockIndex + 1, null)
        continue
      }
      anyGrouped = true
      let nodeId = nodeIdOf.get(block.group)
      if (!nodeId) {
        nodeId = uniqueSlug(block.group, takenIds)
        takenIds.add(nodeId)
        nodeIdOf.set(block.group, nodeId)
        await fs.mkdir(groupsDir, { recursive: true })
        await fs.writeFile(
          join(groupsDir, `${nodeId}.md`),
          serializeFrontmatter(
            { id: nodeId, type: 'colgroup', label: block.group, order: blockIndex + 1 },
            ''
          )
        )
      }
      for (const [i, u] of block.members.entries()) await writeUnit(u, i + 1, nodeId)
    }

    // View state: collapsed groups were remembered by label, now by id.
    const board = await readJson<LegacyBoard>(boardFile)
    const collapsed = Array.isArray(board.collapsedColGroups)
      ? (board.collapsedColGroups as unknown[])
          .filter((l): l is string => typeof l === 'string')
          .map((label) => nodeIdOf.get(label))
          .filter((id): id is string => Boolean(id))
      : []
    await fs.writeFile(boardFile, JSON.stringify({ ...board, collapsedColGroups: collapsed }, null, 2) + '\n')
  }

  // Name the two levels the migration produced; the author renames them in Settings.
  if (anyGrouped && !Array.isArray(project.timelineLevelLabels)) {
    const leaf =
      typeof project.timelineLabel === 'string' && project.timelineLabel.trim()
        ? project.timelineLabel.trim()
        : 'Chapter'
    project.timelineLevelLabels = ['Group', leaf]
  }
  project.schemaVersion = 4
  await fs.writeFile(join(root, 'project.json'), JSON.stringify(project, null, 2) + '\n')
}
