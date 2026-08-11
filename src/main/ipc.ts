import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import type { Card, Character, Note, TimelineUnit, View } from '@shared/types'
import { defaultView } from '@shared/types'
import type { AppSettings } from '@shared/config'
import type { EntityBodyKind, NewCardInput, ProjectSnapshot } from '@shared/ipc'
import type { ProjectChange } from '@shared/changes'
import { assignFamilyColours, familiesIn } from '@shared/families'
import { buildGraph } from '@shared/graph'
import { filterSelection } from '@shared/selection'
import { readConfig, removeRecent, touchRecent, writeConfig } from './appConfig'
import { createProject, defaultBoard, loadSnapshot } from './projectService'
import { uniqueSlug } from './data/slug'
import { applyChildren, clearReferencesTo, retargetReferences, syncSpouses } from './data/relations'
import {
  deleteBoard,
  deleteCharacter,
  deleteNote,
  deleteTimelineUnit,
  deleteView,
  ensureBoardDirs,
  listBoardIds,
  listCharacters,
  listNoteMetas,
  listTimeline,
  listViews,
  readBoard,
  readEntityBody,
  readNote,
  readProject,
  readView,
  renameCharacterFile,
  renameNoteFile,
  writeBoard,
  writeCharacter,
  writeEntityBody,
  writeNote,
  writeProject,
  writeTimelineUnit,
  writeView
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
    members: board.members ? board.members.filter((m) => m !== id) : null,
    cards: board.cards.filter((c) => c.rowId !== id),
    rowOrder: board.rowOrder.filter((r) => r !== id),
    rowGroupOrder: board.rowGroupOrder.filter((k) => k !== id),
    hiddenRows: board.hiddenRows.filter((r) => r !== id)
  })
}

/**
 * Drop a deleted character from every tree on the board — membership, stored
 * position and hidden list. `layoutTree` would ignore the stale ids anyway, but
 * leaving them means the view file slowly fills with references to people who no
 * longer exist, and "+ Add person" counts would drift.
 */
async function purgeCharacterFromViews(root: string, boardId: string, id: string): Promise<void> {
  const { value: board } = await readBoard(root, boardId)
  for (const view of await listViews(root, boardId, board.views)) {
    const inMembers = view.members?.includes(id) ?? false
    const inOverrides = id in (view.overrides ?? {})
    const inHidden = view.hidden.includes(id)
    if (!inMembers && !inOverrides && !inHidden) continue

    const overrides = { ...view.overrides }
    delete overrides[id]
    await writeView(root, boardId, {
      ...view,
      members: view.members ? view.members.filter((m) => m !== id) : null,
      hidden: view.hidden.filter((h) => h !== id),
      overrides
    })
  }
}

/** Point every tree on the board at a renamed character id. */
async function retargetCharacterInViews(
  root: string,
  boardId: string,
  oldId: string,
  newId: string
): Promise<void> {
  const { value: board } = await readBoard(root, boardId)
  for (const view of await listViews(root, boardId, board.views)) {
    const touches =
      view.root === oldId ||
      (view.members?.includes(oldId) ?? false) ||
      view.hidden.includes(oldId) ||
      view.collapsed.includes(oldId) ||
      oldId in (view.overrides ?? {})
    if (!touches) continue

    const overrides = { ...view.overrides }
    if (oldId in overrides) {
      overrides[newId] = overrides[oldId]
      delete overrides[oldId]
    }
    const swap = (list: string[]): string[] => list.map((x) => (x === oldId ? newId : x))
    await writeView(root, boardId, {
      ...view,
      root: view.root === oldId ? newId : view.root,
      members: view.members ? swap(view.members) : null,
      hidden: swap(view.hidden),
      collapsed: swap(view.collapsed),
      overrides
    })
  }
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

/**
 * Point the board's own character references at a renamed id. The board file
 * keys rows by character id in four places, and missing any of them silently
 * drops the row's cards and its position in the order.
 */
async function retargetCharacterOnBoard(
  root: string,
  boardId: string,
  oldId: string,
  newId: string
): Promise<void> {
  const { value: board } = await readBoard(root, boardId)
  const swap = (id: string): string => (id === oldId ? newId : id)
  await writeBoard(root, {
    ...board,
    members: board.members ? board.members.map(swap) : null,
    cards: board.cards.map((c) => (c.rowId === oldId ? { ...c, rowId: newId } : c)),
    rowOrder: board.rowOrder.map(swap),
    rowGroupOrder: board.rowGroupOrder.map(swap),
    hiddenRows: board.hiddenRows.map(swap)
  })
}

// ── Family-tree helpers ───────────────────────────────────────────────────────

/** Write a batch of characters. Used by the relation-fixup helpers. */
async function writeAll(root: string, boardId: string, characters: Character[]): Promise<void> {
  for (const c of characters) await writeCharacter(root, boardId, c)
}

/**
 * Make the load-time family colour assignment durable. Loading must never write,
 * so the colour a new family picks up is committed on the next character save.
 */
async function persistFamilyColours(root: string, characters: Character[]): Promise<void> {
  const { value: project, mtimeMs } = await readProject(root)
  const families = assignFamilyColours(familiesIn(characters), project.families)
  const changed =
    Object.keys(families).length !== Object.keys(project.families).length ||
    Object.entries(families).some(([k, v]) => project.families[k] !== v)
  if (changed) await writeProject(root, { ...project, families }, mtimeMs)
}

/** Persist a board's view order (the view tab strip). */
async function writeViewOrder(root: string, boardId: string, views: string[]): Promise<void> {
  const { value: board, mtimeMs } = await readBoard(root, boardId)
  await writeBoard(root, { ...board, views }, mtimeMs)
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

  ipcMain.handle('project:saveFamilies', async (_e, root: string, families: Record<string, string>) => {
    const { value: project, mtimeMs } = await readProject(root)
    await writeProject(root, { ...project, families }, mtimeMs)
    return snap(root)
  })

  // ── Characters (per board) ──
  ipcMain.handle(
    'character:save',
    async (_e, root: string, boardId: string, character: Character, addToBoard = false) => {
      const all = await listCharacters(root, boardId)
      let toSave = character
      if (!character.id) {
        toSave = { ...character, id: uniqueSlug(character.name || 'character', all.map((c) => c.id)) }
      }
      // `spouse` is symmetric with no natural owner, so saving one side writes the
      // other. Parents need no such fixup — they live on the child.
      const partners = syncSpouses(all, toSave)
      await writeCharacter(root, boardId, toSave)
      await writeAll(root, boardId, partners)
      await persistFamilyColours(root, [...all.filter((c) => c.id !== toSave.id), toSave])

      // Creating a character does *not* put them on the board — that is the whole
      // point of opt-in membership. The board's own "+ Row" passes addToBoard,
      // because a character created there was created to be a row.
      if (addToBoard && !character.id) {
        const { value: board, mtimeMs } = await readBoard(root, boardId)
        if (board.members && !board.members.includes(toSave.id)) {
          await writeBoard(root, { ...board, members: [...board.members, toSave.id] }, mtimeMs)
        }
      }
      return snap(root)
    }
  )

  ipcMain.handle('character:delete', async (_e, root: string, boardId: string, id: string) => {
    const all = await listCharacters(root, boardId)
    await deleteCharacter(root, boardId, id)
    await purgeCharacterFromBoard(root, boardId, id)
    await purgeCharacterFromViews(root, boardId, id)
    // An intentional delete should not leave a ghost node on the tree, so inbound
    // family references are cleared rather than left dangling.
    await writeAll(root, boardId, clearReferencesTo(all, id))
    return snap(root)
  })

  ipcMain.handle(
    'character:rename',
    async (_e, root: string, boardId: string, oldId: string, newName: string) => {
      const all = await listCharacters(root, boardId)
      const current = all.find((c) => c.id === oldId)
      if (!current) throw new Error(`No character "${oldId}" on board "${boardId}"`)

      const newId = uniqueSlug(newName, all.filter((c) => c.id !== oldId).map((c) => c.id))
      if (newId === oldId) {
        await writeCharacter(root, boardId, { ...current, name: newName })
        return snap(root)
      }

      await renameCharacterFile(root, boardId, oldId, newId)
      await writeCharacter(root, boardId, { ...current, id: newId, name: newName })
      await writeAll(root, boardId, retargetReferences(all, oldId, newId))
      await retargetCharacterOnBoard(root, boardId, oldId, newId)
      await retargetCharacterInViews(root, boardId, oldId, newId)
      return snap(root)
    }
  )

  ipcMain.handle(
    'character:setChildren',
    async (_e, root: string, boardId: string, parentId: string, childIds: string[]) => {
      const all = await listCharacters(root, boardId)
      const parent = all.find((c) => c.id === parentId)
      if (!parent) throw new Error(`No character "${parentId}" on board "${boardId}"`)
      await writeAll(root, boardId, applyChildren(all, parent, childIds))
      return snap(root)
    }
  )

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

  // ── Family-tree views (per board) ──
  ipcMain.handle('view:save', async (_e, root: string, boardId: string, view: View) => {
    await writeView(root, boardId, view)
    return snap(root)
  })

  ipcMain.handle(
    'view:create',
    async (
      _e,
      root: string,
      boardId: string,
      name: string,
      rootCharacterId: string | null,
      mode?: 'freeflow' | 'timeline'
    ) => {
      const { value: board } = await readBoard(root, boardId)
      const id = uniqueSlug(name || 'view', board.views)
      const view: View = {
        ...defaultView(id, name),
        root: rootCharacterId ?? null,
        mode: mode === 'timeline' ? 'timeline' : 'freeflow'
      }
      // Seed membership from the filters, so a new tab opens with something on it
      // — but as a *stamped* list, so a character added later doesn't appear on
      // this tree uninvited. `defaultView` can't do this: it has no graph.
      const graph = buildGraph(await listCharacters(root, boardId))
      view.members = filterSelection(graph, view)
      await writeView(root, boardId, view)
      await writeViewOrder(root, boardId, [...board.views, id])
      return snap(root)
    }
  )

  // Duplicating copies the filters — that is the intended way to build a second
  // tree. The copy gets a fresh camera so it opens fitted to its own content
  // rather than inheriting a pan aimed at someone else's branch.
  ipcMain.handle(
    'view:duplicate',
    async (_e, root: string, boardId: string, id: string, name: string) => {
      const { value: board } = await readBoard(root, boardId)
      const existing = await listViews(root, boardId, board.views)
      const source = existing.find((v) => v.id === id)
      if (!source) throw new Error(`No view "${id}" on board "${boardId}"`)

      const newId = uniqueSlug(name || `${source.name} copy`, board.views)
      // Members come across too, not just the filters: duplicating a curated tree
      // should start from the same people. What is *not* copied is the camera and
      // the arrangement, so the copy opens fitted to itself.
      const graph = buildGraph(await listCharacters(root, boardId))
      await writeView(root, boardId, {
        ...defaultView(newId, name),
        members: source.members ? [...source.members] : filterSelection(graph, source),
        root: source.root,
        parentDepth: source.parentDepth,
        childDepth: source.childDepth,
        includeSpouseFamilies: source.includeSpouseFamilies,
        hidden: [...source.hidden],
        showGhosts: source.showGhosts
      })
      const views = [...board.views]
      const at = views.indexOf(id)
      views.splice(at === -1 ? views.length : at + 1, 0, newId)
      await writeViewOrder(root, boardId, views)
      return snap(root)
    }
  )

  ipcMain.handle('view:rename', async (_e, root: string, boardId: string, id: string, name: string) => {
    // The file keeps its id; only the label changes. Ids are references.
    const { value: view, mtimeMs } = await readView(root, boardId, id)
    await writeView(root, boardId, { ...view, name }, mtimeMs)
    return snap(root)
  })

  ipcMain.handle('view:delete', async (_e, root: string, boardId: string, id: string) => {
    await deleteView(root, boardId, id)
    const { value: board } = await readBoard(root, boardId)
    await writeViewOrder(root, boardId, board.views.filter((v) => v !== id))
    return snap(root)
  })

  ipcMain.handle('view:reorder', async (_e, root: string, boardId: string, orderedIds: string[]) => {
    const { value: board } = await readBoard(root, boardId)
    const known = new Set(board.views)
    // Keep only real view ids in the requested order, then append any the caller
    // omitted so no view is ever dropped from the strip.
    const next = orderedIds.filter((v) => known.has(v))
    for (const v of board.views) if (!next.includes(v)) next.push(v)
    await writeViewOrder(root, boardId, next)
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
