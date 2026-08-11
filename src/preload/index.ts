import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '@shared/ipc'
import type { ProjectChange } from '@shared/changes'

/**
 * The bridge between the renderer and the main-process services. Implements
 * the `AppApi` contract over `ipcRenderer.invoke` / `.on`.
 */
const api: AppApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateSettings: (settings) => ipcRenderer.invoke('config:updateSettings', settings),

  createProject: () => ipcRenderer.invoke('project:create'),
  pickProject: () => ipcRenderer.invoke('project:pick'),
  openProject: (root) => ipcRenderer.invoke('project:open', root),
  reloadProject: (root) => ipcRenderer.invoke('project:reload', root),
  removeRecent: (root) => ipcRenderer.invoke('project:removeRecent', root),
  saveProjectMeta: (root, name, timelineLabel) =>
    ipcRenderer.invoke('project:saveMeta', root, name, timelineLabel),
  saveFamilyColours: (root, families) => ipcRenderer.invoke('project:saveFamilies', root, families),

  saveCharacter: (root, boardId, character, addToBoard) =>
    ipcRenderer.invoke('character:save', root, boardId, character, addToBoard ?? false),
  deleteCharacter: (root, boardId, id) => ipcRenderer.invoke('character:delete', root, boardId, id),
  renameCharacter: (root, boardId, oldId, newName) =>
    ipcRenderer.invoke('character:rename', root, boardId, oldId, newName),
  setChildren: (root, boardId, parentId, childIds) =>
    ipcRenderer.invoke('character:setChildren', root, boardId, parentId, childIds),

  saveTimelineUnit: (root, boardId, unit) => ipcRenderer.invoke('timeline:save', root, boardId, unit),
  deleteTimelineUnit: (root, boardId, id) => ipcRenderer.invoke('timeline:delete', root, boardId, id),
  reorderTimeline: (root, boardId, orderedIds) =>
    ipcRenderer.invoke('timeline:reorder', root, boardId, orderedIds),

  saveNote: (root, boardId, note) => ipcRenderer.invoke('note:save', root, boardId, note),
  deleteNote: (root, boardId, id) => ipcRenderer.invoke('note:delete', root, boardId, id),
  getNote: (root, boardId, id) => ipcRenderer.invoke('note:get', root, boardId, id),
  renameNote: (root, boardId, oldId, newName) =>
    ipcRenderer.invoke('note:rename', root, boardId, oldId, newName),

  getEntityBody: (root, boardId, kind, id) => ipcRenderer.invoke('entity:getBody', root, boardId, kind, id),
  saveEntityBody: (root, boardId, kind, id, body) =>
    ipcRenderer.invoke('entity:saveBody', root, boardId, kind, id, body),

  saveBoard: (root, board) => ipcRenderer.invoke('board:save', root, board),
  createBoard: (root, name) => ipcRenderer.invoke('board:create', root, name),
  renameBoard: (root, id, name) => ipcRenderer.invoke('board:rename', root, id, name),
  deleteBoard: (root, id) => ipcRenderer.invoke('board:delete', root, id),
  reorderBoards: (root, orderedIds) => ipcRenderer.invoke('board:reorder', root, orderedIds),

  saveView: (root, boardId, view) => ipcRenderer.invoke('view:save', root, boardId, view),
  createView: (root, boardId, name, rootCharacterId, mode) =>
    ipcRenderer.invoke('view:create', root, boardId, name, rootCharacterId ?? null, mode ?? 'freeflow'),
  duplicateView: (root, boardId, id, name) =>
    ipcRenderer.invoke('view:duplicate', root, boardId, id, name),
  renameView: (root, boardId, id, name) => ipcRenderer.invoke('view:rename', root, boardId, id, name),
  deleteView: (root, boardId, id) => ipcRenderer.invoke('view:delete', root, boardId, id),
  reorderViews: (root, boardId, orderedIds) =>
    ipcRenderer.invoke('view:reorder', root, boardId, orderedIds),

  createCard: (root, input) => ipcRenderer.invoke('card:create', root, input),
  updateCard: (root, boardId, card) => ipcRenderer.invoke('card:update', root, boardId, card),
  deleteCard: (root, boardId, cardId) => ipcRenderer.invoke('card:delete', root, boardId, cardId),

  onProjectChange: (listener: (change: ProjectChange) => void) => {
    const handler = (_e: unknown, change: ProjectChange): void => listener(change)
    ipcRenderer.on('project:change', handler)
    return () => ipcRenderer.removeListener('project:change', handler)
  }
}

export type Api = AppApi

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error('Failed to expose preload API:', error)
}
