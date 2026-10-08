import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import { basename, join } from 'path'
import type { Card, Character, ColumnGroup, Note, TimelineUnit, View } from '@shared/types'
import { defaultView } from '@shared/types'
import type { AppSettings } from '@shared/config'
import type { DocExportOptions, EntityBodyKind, NewCardInput, ProjectSnapshot } from '@shared/ipc'
import type { ProjectChange } from '@shared/changes'
import type { ProjectMeta } from '@shared/project'
import { applyMeta } from '@shared/project'
import { buildMarkdownExport } from '@shared/exportMarkdown'
import type { SearchScope } from '@shared/search'
import type { AssetImport } from '@shared/assets'
import { assignFamilyColours, familiesIn } from '@shared/families'
import { buildGraph } from '@shared/graph'
import { filterSelection } from '@shared/selection'
import {
  buildColumnTree,
  canMoveUnder,
  collectColumnDescendants,
  nextOrder,
  planMove,
  planReorder,
  type ColumnPlacement,
  type ColumnRef
} from '@shared/columns'
import { readConfig, removeRecent, touchRecent, updateConfig } from './appConfig'
import { createProject, defaultBoard, loadSnapshot } from './projectService'
import { assembleStaticSite, buildExportBundle } from './data/exportBundle'
import { markdownToPdf } from './data/renderPdf'
import { ProjectNotInGroupError, resolveProjectGroup, type ResolvedProjectGroup } from './data/projectGroup'
import { needsMigration } from './data/migrate'
import { uniqueSlug } from './data/slug'
import { applyChildren, clearReferencesTo, retargetReferences, syncSpouses } from './data/relations'
import {
  deleteBoard,
  deleteCharacter,
  deleteColumnGroup,
  deleteNote,
  deleteTimelineUnit,
  deleteView,
  ensureBoardDirs,
  listBoardIds,
  listCharacters,
  listColumnGroups,
  listNoteMetas,
  listNotes,
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
  writeColumnGroup,
  writeEntityBody,
  writeNote,
  writeProject,
  writeAsset,
  writeTimelineUnit,
  writeView
} from './data/repository'
import { uniqueNoteUid } from './data/uid'
import { invalidateSearchIndex, searchProject } from './data/searchIndex'
import { ProjectWatcher } from './data/watcher'

/** The single active project watcher; replaced when a new project is opened. */
let activeWatcher: ProjectWatcher | null = null

const today = (): string => new Date().toISOString().slice(0, 10)

function pushChange(window: BrowserWindow, change: ProjectChange): void {
  // An external edit is the other way project content changes, so the search
  // index has to drop here too (Issue #59).
  invalidateSearchIndex()
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

/** Remove deleted timeline units' columns/cards, and deleted groups' collapse state, from their board. */
async function purgeTimelineFromBoard(
  root: string,
  boardId: string,
  unitIds: string[],
  groupIds: string[] = []
): Promise<void> {
  const gone = new Set(unitIds)
  const goneGroups = new Set(groupIds)
  const { value: board } = await readBoard(root, boardId)
  await writeBoard(root, {
    ...board,
    cards: board.cards.filter((c) => !gone.has(c.colStart) && !gone.has(c.colEnd)),
    colOrder: board.colOrder.filter((c) => !gone.has(c)),
    hiddenCols: board.hiddenCols.filter((c) => !gone.has(c)),
    collapsedColGroups: board.collapsedColGroups.filter((g) => !goneGroups.has(g))
  })
}

/**
 * Apply a set of placements (from `planMove` / `planReorder`) to the files they
 * name. Each is a read-modify-write of one group or column; the body of each file
 * is preserved by the writers.
 */
async function applyPlacements(
  root: string,
  boardId: string,
  placements: ColumnPlacement[]
): Promise<void> {
  if (placements.length === 0) return
  const [groups, units] = await Promise.all([listColumnGroups(root, boardId), listTimeline(root, boardId)])
  for (const { ref, parent, order } of placements) {
    if (ref.kind === 'node') {
      const g = groups.find((x) => x.id === ref.id)
      if (!g) continue
      const { parent: _old, ...rest } = g
      await writeColumnGroup(root, boardId, { ...rest, order, ...(parent !== null ? { parent } : {}) })
    } else {
      const u = units.find((x) => x.id === ref.id)
      if (!u) continue
      const { parent: _old, ...rest } = u
      await writeTimelineUnit(root, boardId, { ...rest, order, ...(parent !== null ? { parent } : {}) })
    }
  }
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
  // Every mutating handler funnels through here, which makes it the one place
  // the search index (Issue #59) has to be invalidated after an in-app write.
  const snap = (root: string): Promise<ProjectSnapshot> => {
    invalidateSearchIndex(root)
    return loadSnapshot(root, false)
  }

  // ── App config ──
  ipcMain.handle('config:get', () => readConfig())
  ipcMain.handle('config:updateSettings', async (_e, settings: AppSettings) => {
    return updateConfig((config) => ({ ...config, settings }))
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

  ipcMain.handle('project:saveMeta', async (_e, root: string, meta: ProjectMeta) => {
    const { value: project, mtimeMs } = await readProject(root)
    await writeProject(root, applyMeta(project, meta), mtimeMs)
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
    const [units, groups] = await Promise.all([listTimeline(root, boardId), listColumnGroups(root, boardId)])
    const tree = buildColumnTree(groups, units)
    // A parent that does not exist is no parent; a column must never be saved
    // pointing at nothing.
    const parent = unit.parent && tree.node(unit.parent) ? unit.parent : null
    const { parent: _p, ...rest } = unit
    let toSave: TimelineUnit = { ...rest, ...(parent ? { parent } : {}) }
    if (!unit.id) {
      toSave = {
        ...toSave,
        id: uniqueSlug(unit.label || 'unit', units.map((u) => u.id)),
        order: unit.order || nextOrder(tree, parent)
      }
    } else if (tree.parentOf({ kind: 'unit', id: unit.id }) !== parent) {
      // Moved to another parent through the form: it lands last there.
      toSave = { ...toSave, order: nextOrder(tree, parent) }
    }
    await writeTimelineUnit(root, boardId, toSave)
    return snap(root)
  })

  ipcMain.handle('timeline:delete', async (_e, root: string, boardId: string, id: string) => {
    await deleteTimelineUnit(root, boardId, id)
    await purgeTimelineFromBoard(root, boardId, [id])
    return snap(root)
  })

  // ── Column hierarchy (per board, Issue #104) ──
  ipcMain.handle('colgroup:save', async (_e, root: string, boardId: string, group: ColumnGroup) => {
    const label = group.label.trim()
    if (!label) throw new Error('A group needs a name.')
    const [groups, units] = await Promise.all([listColumnGroups(root, boardId), listTimeline(root, boardId)])
    const tree = buildColumnTree(groups, units)
    const parent = group.parent && tree.node(group.parent) ? group.parent : null
    const { parent: _p, hasNote: _h, ...rest } = group
    let toSave: ColumnGroup = { ...rest, type: 'colgroup', label, ...(parent ? { parent } : {}) }

    if (!group.id) {
      toSave = {
        ...toSave,
        id: uniqueSlug(label, groups.map((g) => g.id)),
        order: group.order || nextOrder(tree, parent)
      }
    } else {
      if (!canMoveUnder(tree, { kind: 'node', id: group.id }, parent)) {
        throw new Error('A group cannot be moved inside itself.')
      }
      // The id never changes, so renaming here leaves the note exactly where it was.
      if (tree.parentOf({ kind: 'node', id: group.id }) !== parent) {
        toSave = { ...toSave, order: nextOrder(tree, parent) }
      }
    }
    await writeColumnGroup(root, boardId, toSave)
    return snap(root)
  })

  ipcMain.handle('colgroup:delete', async (_e, root: string, boardId: string, id: string) => {
    const [groups, units] = await Promise.all([listColumnGroups(root, boardId), listTimeline(root, boardId)])
    const below = collectColumnDescendants(groups, units, id)
    const unitIds = below.flatMap((d) => (d.kind === 'unit' ? [d.unit.id] : []))
    const groupIds = [id, ...below.flatMap((d) => (d.kind === 'node' ? [d.node.id] : []))]
    for (const unitId of unitIds) await deleteTimelineUnit(root, boardId, unitId)
    for (const groupId of groupIds) await deleteColumnGroup(root, boardId, groupId)
    await purgeTimelineFromBoard(root, boardId, unitIds, groupIds)
    return snap(root)
  })

  ipcMain.handle(
    'columns:reorder',
    async (_e, root: string, boardId: string, parentId: string | null, order: ColumnRef[]) => {
      const [groups, units] = await Promise.all([listColumnGroups(root, boardId), listTimeline(root, boardId)])
      await applyPlacements(root, boardId, planReorder(buildColumnTree(groups, units), parentId, order))
      return snap(root)
    }
  )

  ipcMain.handle(
    'columns:move',
    async (
      _e,
      root: string,
      boardId: string,
      ref: ColumnRef,
      newParentId: string | null,
      index?: number
    ) => {
      const [groups, units] = await Promise.all([listColumnGroups(root, boardId), listTimeline(root, boardId)])
      const placements = planMove(buildColumnTree(groups, units), ref, newParentId, index)
      if (!placements) throw new Error('That move is not allowed — a group cannot go inside itself.')
      await applyPlacements(root, boardId, placements)
      return snap(root)
    }
  )

  ipcMain.handle(
    'colgroup:wrap',
    async (_e, root: string, boardId: string, unitId: string, label: string, moveNote: boolean) => {
      const [groups, units] = await Promise.all([listColumnGroups(root, boardId), listTimeline(root, boardId)])
      const unit = units.find((u) => u.id === unitId)
      if (!unit) throw new Error(`No column "${unitId}" on board "${boardId}"`)
      const tree = buildColumnTree(groups, units)
      const parent = tree.parentOf({ kind: 'unit', id: unitId })

      // The new group takes the column's slot, and the column becomes its first child.
      const name = label.trim() || unit.label
      const id = uniqueSlug(name, groups.map((g) => g.id))
      await writeColumnGroup(root, boardId, {
        id,
        type: 'colgroup',
        label: name,
        order: unit.order,
        ...(parent ? { parent } : {})
      })
      const { parent: _old, ...rest } = unit
      await writeTimelineUnit(root, boardId, { ...rest, order: 1, parent: id })

      if (moveNote && unit.hasNote) {
        const note = await readEntityBody(root, boardId, 'timeline', unitId)
        await writeEntityBody(root, boardId, 'colgroup', id, note)
        await writeEntityBody(root, boardId, 'timeline', unitId, '')
      }
      return snap(root)
    }
  )

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

  // ── Search (Issues #59, #60) ──
  ipcMain.handle('search:notes', (_e, root: string, query: string, scope: SearchScope) => {
    return searchProject(root, query, scope)
  })

  // ── Assets (Issue #61) ──
  ipcMain.handle('asset:import', async (_e, root: string, boardId: string, file: AssetImport) => {
    const ref = await writeAsset(root, boardId, file)
    // Assets are not part of the snapshot, but a note that now references one
    // will re-render — and the watcher ignores the assets folder.
    return ref
  })

  ipcMain.handle('asset:pick', async (_e, root: string, boardId: string) => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose an image to add',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] },
        { name: 'PDF', extensions: ['pdf'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const source = result.filePaths[0]
    const data = await fsp.readFile(source)
    return writeAsset(root, boardId, { name: basename(source), data: data.toString('base64') })
  })

  // ── Static site export (Issue #48; multi-project groups: Issue #101) ──
  ipcMain.handle('static:export', async (_e, root: string) => {
    // Resolved before the folder picker: a "not part of this group" warning
    // that leads to Cancel shouldn't first make the user pick a destination.
    let group: ResolvedProjectGroup | null
    try {
      group = await resolveProjectGroup(root)
    } catch (err) {
      if (!(err instanceof ProjectNotInGroupError)) throw err
      // A sibling folder can perfectly well hold unrelated projects the
      // group was never meant to include — unlike the CLI (no one to ask),
      // offer to export standalone instead of aborting outright.
      const choice = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: ['Cancel export', 'Export without the group'],
        defaultId: 0,
        cancelId: 0,
        message: "This project isn't listed in a nearby project group",
        detail: `${err.message}\n\nExporting without the group skips the sibling-project dropdown for this site.`
      })
      if (choice.response !== 1) return null
      group = null
    }

    // A group of just this one project is the same as no group, mirroring the
    // dropdown's own "1 member = nothing to switch to" rule (issue #86) — no
    // point asking Current vs All when there's nothing else to export.
    const currentFolder = basename(root)
    let members = [currentFolder]
    let allGroup: ResolvedProjectGroup | null = null
    if (group && group.file.projects.length > 1) {
      const choice = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: ['Cancel', 'Current project only', `All ${group.file.projects.length} projects`],
        defaultId: 1,
        cancelId: 0,
        message: `"${group.file.name}" lists ${group.file.projects.length} projects`,
        detail:
          `Export just "${currentFolder}", or every project in the group ` +
          `(${group.file.projects.join(', ')})?`
      })
      if (choice.response === 0) return null
      if (choice.response === 2) {
        members = group.file.projects
        allGroup = group
      }
    }

    // Building a sibling's export bundle reuses `loadSnapshot`, which migrates
    // it in place (with its own backup) exactly like opening it in the app
    // would — but here that could happen to a project the user never opened
    // themselves. Surface that before it happens rather than after.
    if (allGroup) {
      const activeGroup = allGroup
      const stale = await Promise.all(
        members.map(async (folder) => ({
          folder,
          stale: await needsMigration(join(activeGroup.groupRoot, folder))
        }))
      )
      const toMigrate = stale.filter((s) => s.stale).map((s) => s.folder)
      if (toMigrate.length > 0) {
        const choice = await dialog.showMessageBox(window, {
          type: 'warning',
          buttons: ['Cancel export', 'Migrate and export'],
          defaultId: 0,
          cancelId: 0,
          message: 'Some projects in this group are on an older file format',
          detail:
            `Exporting will upgrade these in place first, same as opening them in the app would ` +
            `(each gets its own backup folder first): ${toMigrate.join(', ')}.`
        })
        if (choice.response !== 1) return null
      }
    }

    const result = await dialog.showOpenDialog(window, {
      title: allGroup
        ? 'Choose a folder to export all sites into'
        : 'Choose a folder to export the static site into',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const outDir = result.filePaths[0]

    // The packaged app ships a prebuilt shell at this path (see `build:app` and
    // `electron-builder.yml`'s `out/**` inclusion, unpacked from app.asar so `fs.cp`
    // can read it as plain files); in a dev checkout it's whatever
    // `npm run build:web` last produced.
    const appPath = app.getAppPath()
    const shellDir = join(
      app.isPackaged ? appPath.replace(/app\.asar$/, 'app.asar.unpacked') : appPath,
      'out',
      'web'
    )
    await fsp.access(join(shellDir, 'index.html')).catch(() => {
      throw new Error(
        `No exportable web shell found at ${shellDir}. Run "npm run build:web" once, then try again.`
      )
    })

    const { settings } = await readConfig()
    // Refuses a non-empty folder it didn't create rather than silently wiping
    // whatever the user picked — same safety net as the CLI's default (no `--force`).
    const exportOne = async (
      projectRoot: string,
      memberOutDir: string
    ): Promise<{ files: number; bytes: number }> => {
      const bundle = await buildExportBundle(projectRoot, {
        settings,
        appVersion: app.getVersion(),
        generatedAt: new Date().toISOString()
      })
      const assembled = await assembleStaticSite({
        bundle,
        projectRoot,
        shellDir,
        outDir: memberOutDir,
        theme: settings.theme,
        group
      })
      return { files: assembled.files, bytes: assembled.bytes }
    }

    if (!allGroup) {
      const { files, bytes } = await exportOne(root, outDir)
      return { outDir, files, bytes }
    }

    // `buildExportBundle` reuses `loadSnapshot`, which stamps its argument as
    // the app's "currently open project" (for `zn-asset://` resolution) as a
    // side effect. Exporting every sibling in turn would otherwise leave that
    // pointed at whichever member exported last — restore it once the whole
    // group is done, success or failure.
    try {
      let totalFiles = 0
      let totalBytes = 0
      const exported: { folder: string; name: string }[] = []
      for (const folder of members) {
        const projectRoot = join(allGroup.groupRoot, folder)
        try {
          const { files, bytes } = await exportOne(projectRoot, join(outDir, folder))
          totalFiles += files
          totalBytes += bytes
          const name = allGroup.manifest.members.find((m) => m.folder === folder)?.name ?? folder
          exported.push({ folder, name })
        } catch (err) {
          // Abort the whole group rather than ship a partially-refreshed
          // dropdown — same posture as projectgroup.json's own validation.
          throw new Error(`Failed exporting "${folder}": ${(err as Error).message}`)
        }
      }
      return { outDir, files: totalFiles, bytes: totalBytes, projects: exported }
    } finally {
      await loadSnapshot(root).catch(() => {})
    }
  })

  // ── Document export (Issue #125) ──
  // One board flattened to a single Markdown/PDF file for reading or printing.
  // Nothing to do with `static:export` above — that publishes the whole project
  // as an interactive site; this is a linear read-through of one board.
  ipcMain.handle('doc:export', async (_e, root: string, boardId: string, options: DocExportOptions) => {
    const snapshot = await loadSnapshot(root)
    const boardData = snapshot.boards.find((bd) => bd.board.id === boardId)
    if (!boardData) throw new Error(`Unknown board: ${boardId}`)

    // Snapshot notes are metadata-only (bodies are lazy); the export needs them
    // whole, plus each column tier's own note when the Scenes section is on.
    const notes = await listNotes(root, boardId)
    const groupBodies: Record<string, string> = {}
    const unitBodies: Record<string, string> = {}
    if (options.scenes) {
      for (const group of boardData.colGroups) {
        groupBodies[group.id] = await readEntityBody(root, boardId, 'colgroup', group.id)
      }
      for (const unit of boardData.timeline) {
        unitBodies[unit.id] = await readEntityBody(root, boardId, 'timeline', unit.id)
      }
    }

    const markdown = buildMarkdownExport(
      {
        boardName: boardData.board.name,
        colGroups: boardData.colGroups,
        timeline: boardData.timeline,
        characters: boardData.characters,
        cards: boardData.board.cards,
        notes,
        groupBodies,
        unitBodies
      },
      options
    )

    const ext = options.format === 'pdf' ? 'pdf' : 'md'
    const safeName =
      boardData.board.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'export'
    const result = await dialog.showSaveDialog(window, {
      title: 'Export board',
      defaultPath: `${safeName}.${ext}`,
      filters:
        options.format === 'pdf'
          ? [{ name: 'PDF', extensions: ['pdf'] }]
          : [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return null

    if (options.format === 'pdf') {
      const pdf = await markdownToPdf(markdown, boardData.board.name)
      await fsp.writeFile(result.filePath, pdf)
      return { path: result.filePath, bytes: pdf.length }
    }
    await fsp.writeFile(result.filePath, markdown, 'utf8')
    return { path: result.filePath, bytes: Buffer.byteLength(markdown, 'utf8') }
  })
}

/** Stop watching on shutdown. */
export async function disposeIpc(): Promise<void> {
  if (activeWatcher) await activeWatcher.stop()
  activeWatcher = null
}
