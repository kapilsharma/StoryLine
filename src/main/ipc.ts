import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import type { Card, Character, Note, TimelineUnit } from '@shared/types'
import type { AppSettings } from '@shared/config'
import type { EntityBodyKind, NewCardInput, ProjectSnapshot } from '@shared/ipc'
import type { ProjectChange } from '@shared/changes'
import { readConfig, removeRecent, touchRecent, writeConfig } from './appConfig'
import { createProject, defaultBoard, loadSnapshot } from './projectService'
import { uniqueSlug } from './data/slug'
import {
  deleteBoard,
  deleteCharacter,
  deleteNote,
  deleteTimelineUnit,
  ensureBoardDirs,
  listBoardIds,
  listCharacterIds,
  listNoteMetas,
  listTimeline,
  readBoard,
  readEntityBody,
  readNote,
  readProject,
  renameNoteFile,
  writeBoard,
  writeCharacter,
  writeEntityBody,
  writeNote,
  writeProject,
  writeTimelineUnit
} from './data/repository'
import { uniqueNoteUid } from './data/uid'
import { ProjectWatcher } from './data/watcher'

/** The single active project watcher; replaced when a new project is opened. */
let activeWatcher: ProjectWatcher | null = null

const today = (): string => new Date().toISOString().slice(0, 10)

function pushChange(window: BrowserWindow, change: ProjectChange): void {
  if (!window.isDestroyed()) window.webContents.send('project:change', change)
}

async function startWatching(root: string, window: BrowserWindow): Promise<void> {
  if (activeWatcher) await activeWatcher.stop()
  activeWatcher = new ProjectWatcher(root, (change) => pushChange(window, change))
  activeWatcher.start()
}

// ── Cascade helpers (per board) ────────────────────────────────────────────────

/** Remove a deleted character's cards/refs from its board. */
async function purgeCharacterFromBoard(root: string, boardId: string, id: string): Promise<void> {
  const { value: board } = await readBoard(root, boardId)
  await writeBoard(root, {
    ...board,
    cards: board.cards.filter((c) => c.rowId !== id),
    rowOrder: board.rowOrder.filter((r) => r !== id),
    rowGroupOrder: board.rowGroupOrder.filter((k) => k !== id),
    hiddenRows: board.hiddenRows.filter((r) => r !== id)
  })
}

/** Remove a deleted timeline unit's columns/cards from its board. */
async function purgeTimelineFromBoard(root: string, boardId: string, id: string): Promise<void> {
  const { value: board } = await readBoard(root, boardId)
  await writeBoard(root, {
    ...board,
    cards: board.cards.filter((c) => c.colStart !== id && c.colEnd !== id),
    colOrder: board.colOrder.filter((c) => c !== id),
    hiddenCols: board.hiddenCols.filter((c) => c !== id)
  })
}

/** Remove cards referencing a deleted note (by uid) from its board. */
async function purgeCardsByNoteUid(root: string, boardId: string, uid: string): Promise<void> {
  const { value: board } = await readBoard(root, boardId)
  const cards = board.cards.filter((c) => c.noteUid !== uid)
  if (cards.length !== board.cards.length) await writeBoard(root, { ...board, cards })
}

export function registerIpc(window: BrowserWindow): void {
  const snap = (root: string): Promise<ProjectSnapshot> => loadSnapshot(root, false)

  // ── App config ──
  ipcMain.handle('config:get', () => readConfig())
  ipcMain.handle('config:updateSettings', async (_e, settings: AppSettings) => {
    const config = await readConfig()
    return writeConfig({ ...config, settings })
  })

  // ── Project lifecycle ──
  ipcMain.handle('project:create', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a folder for the new project',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const dir = result.filePaths[0]
    await createProject(dir)
    await touchRecent({ name: basename(dir), path: dir, lastOpened: today() })
    return dir
  })

  ipcMain.handle('project:pick', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Open a ZN Story Line project folder',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('project:open', async (_e, root: string) => {
    const snapshot = await loadSnapshot(root, true)
    await touchRecent({ name: snapshot.project.name, path: root, lastOpened: snapshot.project.lastOpened })
    await startWatching(root, window)
    return snapshot
  })

  ipcMain.handle('project:reload', (_e, root: string) => snap(root))
  ipcMain.handle('project:removeRecent', (_e, root: string) => removeRecent(root))

  ipcMain.handle('project:saveMeta', async (_e, root: string, name: string, timelineLabel: string) => {
    const { value: project, mtimeMs } = await readProject(root)
    await writeProject(root, { ...project, name, timelineLabel }, mtimeMs)
    return snap(root)
  })

  // ── Characters (per board) ──
  ipcMain.handle('character:save', async (_e, root: string, boardId: string, character: Character) => {
    let toSave = character
    if (!character.id) {
      const existing = await listCharacterIds(root, boardId)
      toSave = { ...character, id: uniqueSlug(character.name || 'character', existing) }
    }
    await writeCharacter(root, boardId, toSave)
    return snap(root)
  })

  ipcMain.handle('character:delete', async (_e, root: string, boardId: string, id: string) => {
    await deleteCharacter(root, boardId, id)
    await purgeCharacterFromBoard(root, boardId, id)
    return snap(root)
  })

  // ── Timeline (per board) ──
  ipcMain.handle('timeline:save', async (_e, root: string, boardId: string, unit: TimelineUnit) => {
    let toSave = unit
    if (!unit.id) {
      const units = await listTimeline(root, boardId)
      const order = unit.order || units.length + 1
      toSave = { ...unit, id: uniqueSlug(unit.label || 'unit', units.map((u) => u.id)), order }
    }
    await writeTimelineUnit(root, boardId, toSave)
    return snap(root)
  })

  ipcMain.handle('timeline:delete', async (_e, root: string, boardId: string, id: string) => {
    await deleteTimelineUnit(root, boardId, id)
    await purgeTimelineFromBoard(root, boardId, id)
    return snap(root)
  })

  ipcMain.handle('timeline:reorder', async (_e, root: string, boardId: string, orderedIds: string[]) => {
    const units = await listTimeline(root, boardId)
    await Promise.all(
      orderedIds.map(async (id, index) => {
        const unit = units.find((u) => u.id === id)
        if (unit && unit.order !== index + 1) await writeTimelineUnit(root, boardId, { ...unit, order: index + 1 })
      })
    )
    return snap(root)
  })

  // ── Notes (per board) ──
  ipcMain.handle('note:save', async (_e, root: string, boardId: string, note: Note) => {
    const metas = await listNoteMetas(root, boardId)
    let toSave = note
    if (!note.id) {
      toSave = { ...toSave, id: uniqueSlug(note.title || 'note', metas.map((n) => n.id)) }
    }
    if (!toSave.uid) {
      // Lazy uid assignment (e.g. first in-app write of an externally-created note).
      const uids = metas.map((n) => n.uid).filter((u): u is string => Boolean(u))
      toSave = { ...toSave, uid: uniqueNoteUid(uids) }
    }
    await writeNote(root, boardId, toSave)
    return snap(root)
  })

  ipcMain.handle('note:delete', async (_e, root: string, boardId: string, id: string) => {
    let uid: string | undefined
    try {
      uid = (await readNote(root, boardId, id)).value.uid
    } catch {
      // already gone
    }
    await deleteNote(root, boardId, id)
    if (uid) await purgeCardsByNoteUid(root, boardId, uid)
    return snap(root)
  })

  ipcMain.handle('note:get', async (_e, root: string, boardId: string, id: string) => {
    return (await readNote(root, boardId, id)).value
  })

  ipcMain.handle('note:rename', async (_e, root: string, boardId: string, oldId: string, newName: string) => {
    const metas = await listNoteMetas(root, boardId)
    const others = metas.map((n) => n.id).filter((nid) => nid !== oldId)
    const newId = uniqueSlug(newName || oldId, others)
    if (newId !== oldId) {
      await renameNoteFile(root, boardId, oldId, newId)
      // Fix filename-based `related:` links in the board's other notes (§6).
      for (const meta of metas) {
        if (meta.id === oldId) continue
        const { value: n } = await readNote(root, boardId, meta.id)
        if (n.related?.some((r) => r.file === `${oldId}.md`)) {
          const related = n.related.map((r) => (r.file === `${oldId}.md` ? { ...r, file: `${newId}.md` } : r))
          await writeNote(root, boardId, { ...n, related })
        }
      }
    }
    return snap(root)
  })

  // ── Boards ──
  ipcMain.handle('board:save', async (_e, root: string, board) => {
    await writeBoard(root, board)
    return snap(root)
  })

  ipcMain.handle('board:create', async (_e, root: string, name: string) => {
    const existing = await listBoardIds(root)
    const id = uniqueSlug(name || 'board', existing)
    await ensureBoardDirs(root, id)
    await writeBoard(root, defaultBoard(id, name.trim() || 'New Board'))
    const { value: project, mtimeMs } = await readProject(root)
    await writeProject(root, { ...project, boards: [...project.boards, id] }, mtimeMs)
    return snap(root)
  })

  ipcMain.handle('board:rename', async (_e, root: string, id: string, name: string) => {
    const { value: board } = await readBoard(root, id)
    await writeBoard(root, { ...board, name })
    return snap(root)
  })

  ipcMain.handle('board:delete', async (_e, root: string, id: string) => {
    await deleteBoard(root, id)
    const { value: project, mtimeMs } = await readProject(root)
    await writeProject(root, { ...project, boards: project.boards.filter((b) => b !== id) }, mtimeMs)
    return snap(root)
  })

  ipcMain.handle('board:reorder', async (_e, root: string, orderedIds: string[]) => {
    const { value: project, mtimeMs } = await readProject(root)
    const known = new Set(project.boards)
    // Keep only real board ids in the requested order, then append any the
    // caller omitted so no board is ever dropped from project.boards.
    const next = orderedIds.filter((id) => known.has(id))
    for (const id of project.boards) if (!next.includes(id)) next.push(id)
    await writeProject(root, { ...project, boards: next }, mtimeMs)
    return snap(root)
  })

  // ── Cards ──
  ipcMain.handle('card:create', async (_e, root: string, input: NewCardInput) => {
    const metas = await listNoteMetas(root, input.boardId)
    const noteId = uniqueSlug(input.title || 'note', metas.map((n) => n.id))
    const uid = uniqueNoteUid(metas.map((n) => n.uid).filter((u): u is string => Boolean(u)))
    await writeNote(root, input.boardId, {
      id: noteId,
      uid,
      title: input.title.trim() || 'Untitled',
      boards: [input.boardId],
      created: today(),
      body: '\n'
    })

    const { value: board } = await readBoard(root, input.boardId)
    const card: Card = {
      id: `card-${randomUUID().slice(0, 8)}`,
      noteUid: uid,
      rowId: input.rowId,
      colStart: input.colStart,
      colEnd: input.colEnd
    }
    await writeBoard(root, { ...board, cards: [...board.cards, card] })
    return snap(root)
  })

  ipcMain.handle('card:update', async (_e, root: string, boardId: string, card: Card) => {
    const { value: board } = await readBoard(root, boardId)
    await writeBoard(root, { ...board, cards: board.cards.map((c) => (c.id === card.id ? card : c)) })
    return snap(root)
  })

  ipcMain.handle('card:delete', async (_e, root: string, boardId: string, cardId: string) => {
    const { value: board } = await readBoard(root, boardId)
    await writeBoard(root, { ...board, cards: board.cards.filter((c) => c.id !== cardId) })
    return snap(root)
  })

  // ── Entity body (character / timeline markdown body) ──
  ipcMain.handle('entity:getBody', (_e, root: string, boardId: string, kind: EntityBodyKind, id: string) => {
    return readEntityBody(root, boardId, kind, id)
  })

  ipcMain.handle(
    'entity:saveBody',
    async (_e, root: string, boardId: string, kind: EntityBodyKind, id: string, body: string) => {
      await writeEntityBody(root, boardId, kind, id, body)
      return snap(root)
    }
  )
}

/** Stop watching on shutdown. */
export async function disposeIpc(): Promise<void> {
  if (activeWatcher) await activeWatcher.stop()
  activeWatcher = null
}
