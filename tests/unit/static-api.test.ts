import { describe, it, expect } from 'vitest'
import { SNAPSHOT_GLOBAL, entityBodyKey, EXPORT_FORMAT_VERSION, type ExportBundle } from '@shared/export'
import { DEFAULT_SETTINGS } from '@shared/config'
import { SCHEMA_VERSION, defaultView, type Board, type View } from '@shared/types'
import {
  createStaticApi,
  MissingSnapshotError,
  ReadOnlyError,
  readBundle,
  STATIC_ROOT
} from '../../src/web/staticApi'

const board: Board = {
  id: 'main',
  name: 'Main Board',
  cards: [{ id: 'card-1', noteUid: 'n_abc12345', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1' }],
  hiddenRows: [],
  hiddenCols: [],
  presets: [],
  rowOrder: ['aeri'],
  rowGroupOrder: ['aeri'],
  colOrder: ['ch1'],
  collapsedRowGroups: [],
  collapsedColGroups: [],
  zoom: 1,
  views: ['everyone']
}

const view: View = { ...defaultView('everyone', 'Everyone'), root: 'aeri' }

const bundle: ExportBundle = {
  formatVersion: EXPORT_FORMAT_VERSION,
  generatedAt: '2026-08-10T00:00:00.000Z',
  appVersion: '9.9.9',
  project: {
    schemaVersion: SCHEMA_VERSION,
    name: 'My Novel',
    timelineLabel: 'Chapter',
    boards: ['main'],
    created: '2026-08-01',
    lastOpened: '2026-08-10',
    families: { Aeri: '#22c55e' }
  },
  boards: [
    {
      board,
      characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
      timeline: [{ id: 'ch1', label: 'Chapter 1', order: 1 }],
      notes: [
        {
          id: 'the-discovery',
          uid: 'n_abc12345',
          title: 'The discovery',
          body: 'Aeri finds the fault in the numbers.'
        }
      ],
      views: [view],
      problems: []
    }
  ],
  entityBodies: { [entityBodyKey('main', 'character', 'aeri')]: '## Notes\n\nQuiet, precise.' },
  settings: { ...DEFAULT_SETTINGS }
}

describe('readBundle', () => {
  it('reads the bundle off the injected global', () => {
    expect(readBundle({ [SNAPSHOT_GLOBAL]: bundle })).toBe(bundle)
  })

  it('explains itself when snapshot.js is missing from the upload', () => {
    expect(() => readBundle({})).toThrow(MissingSnapshotError)
    expect(() => readBundle({ [SNAPSHOT_GLOBAL]: null })).toThrow(/snapshot\.js/)
  })
})

describe('static api — reads', () => {
  it('serves the project snapshot without touching a filesystem', async () => {
    const api = createStaticApi(bundle)
    const snap = await api.openProject(STATIC_ROOT)
    expect(snap.root).toBe(STATIC_ROOT)
    expect(snap.project.name).toBe('My Novel')
    expect(snap.boards[0].board.cards).toHaveLength(1)
  })

  it('strips note bodies from the snapshot, matching the desktop contract', async () => {
    const api = createStaticApi(bundle)
    const snap = await api.reloadProject(STATIC_ROOT)
    expect(snap.boards[0].notes[0].body).toBe('')
  })

  it('serves the full note body through getNote', async () => {
    const api = createStaticApi(bundle)
    const note = await api.getNote(STATIC_ROOT, 'main', 'the-discovery')
    expect(note.body).toBe('Aeri finds the fault in the numbers.')
  })

  it('serves entity bodies, and empty string for one that was not exported', async () => {
    const api = createStaticApi(bundle)
    expect(await api.getEntityBody(STATIC_ROOT, 'main', 'character', 'aeri')).toContain('Quiet, precise.')
    expect(await api.getEntityBody(STATIC_ROOT, 'main', 'timeline', 'ch1')).toBe('')
  })

  it('reports no recents — they are never exported', async () => {
    expect((await createStaticApi(bundle).getConfig()).recents).toEqual([])
  })

  it('has no watcher to subscribe to, and unsubscribing is safe', () => {
    const unsubscribe = createStaticApi(bundle).onProjectChange(() => {})
    expect(() => unsubscribe()).not.toThrow()
  })
})

describe('static api — allowed in-session changes', () => {
  it('keeps appearance settings, so a visitor can switch theme', async () => {
    const api = createStaticApi(bundle)
    const next = { ...DEFAULT_SETTINGS, theme: 'dark' as const }
    expect((await api.updateSettings(next)).settings.theme).toBe('dark')
    expect((await api.getConfig()).settings.theme).toBe('dark')
  })

  it('keeps board view state — zoom, collapse, hide — via saveBoard', async () => {
    const api = createStaticApi(bundle)
    const snap = await api.saveBoard(STATIC_ROOT, {
      ...board,
      zoom: 0.6,
      collapsedRowGroups: ['Family'],
      hiddenCols: ['ch1']
    })
    expect(snap.boards[0].board.zoom).toBe(0.6)
    expect(snap.boards[0].board.collapsedRowGroups).toEqual(['Family'])
    // And it persists for the rest of the session.
    expect((await api.reloadProject(STATIC_ROOT)).boards[0].board.hiddenCols).toEqual(['ch1'])
  })

  it('keeps family-tree view state — camera, arrangement, routes — via saveView', async () => {
    const api = createStaticApi(bundle)
    const snap = await api.saveView(STATIC_ROOT, 'main', {
      ...view,
      zoom: 0.5,
      panX: 40,
      arranged: true,
      overrides: { aeri: { x: 10, y: 20 } }
    })
    expect(snap.boards[0].views[0].zoom).toBe(0.5)
    expect(snap.boards[0].views[0].overrides).toEqual({ aeri: { x: 10, y: 20 } })
    // And it persists for the rest of the session.
    expect((await api.reloadProject(STATIC_ROOT)).boards[0].views[0].panX).toBe(40)
  })

  it('does not mutate the bundle it was given', async () => {
    const api = createStaticApi(bundle)
    await api.saveBoard(STATIC_ROOT, { ...board, zoom: 0.25 })
    await api.saveView(STATIC_ROOT, 'main', { ...view, zoom: 0.25 })
    expect(bundle.boards[0].board.zoom).toBe(1)
    expect(bundle.boards[0].views[0].zoom).toBe(1)
    expect(bundle.boards[0].notes[0].body).toBe('Aeri finds the fault in the numbers.')
  })
})

describe('static api — bundles from before v0.6.0', () => {
  it('loads a board with no views or problems rather than crashing', async () => {
    const { views: _views, problems: _problems, ...legacyBoard } = bundle.boards[0]
    const legacy = { ...bundle, boards: [legacyBoard] } as ExportBundle
    const snap = await createStaticApi(legacy).openProject(STATIC_ROOT)
    expect(snap.boards[0].views).toEqual([])
    expect(snap.boards[0].problems).toEqual([])
  })
})

describe('static api — refused writes', () => {
  const api = createStaticApi(bundle)
  const note = bundle.boards[0].notes[0]

  // Every call that would touch a file on disk. Listed exhaustively so a new
  // AppApi method can't quietly default to "writable" in a published export.
  const writes: Array<[string, () => Promise<unknown>]> = [
    ['createProject', () => api.createProject()],
    ['pickProject', () => api.pickProject()],
    ['saveProjectMeta', () => api.saveProjectMeta(STATIC_ROOT, 'Nope', 'Chapter')],
    ['saveFamilyColours', () => api.saveFamilyColours(STATIC_ROOT, { Aeri: '#000000' })],
    ['saveCharacter', () => api.saveCharacter(STATIC_ROOT, 'main', bundle.boards[0].characters[0])],
    ['deleteCharacter', () => api.deleteCharacter(STATIC_ROOT, 'main', 'aeri')],
    ['renameCharacter', () => api.renameCharacter(STATIC_ROOT, 'main', 'aeri', 'Nope')],
    ['setChildren', () => api.setChildren(STATIC_ROOT, 'main', 'aeri', [])],
    ['saveTimelineUnit', () => api.saveTimelineUnit(STATIC_ROOT, 'main', bundle.boards[0].timeline[0])],
    ['deleteTimelineUnit', () => api.deleteTimelineUnit(STATIC_ROOT, 'main', 'ch1')],
    ['reorderTimeline', () => api.reorderTimeline(STATIC_ROOT, 'main', ['ch1'])],
    ['saveNote', () => api.saveNote(STATIC_ROOT, 'main', note)],
    ['deleteNote', () => api.deleteNote(STATIC_ROOT, 'main', note.id)],
    ['renameNote', () => api.renameNote(STATIC_ROOT, 'main', note.id, 'renamed')],
    ['saveEntityBody', () => api.saveEntityBody(STATIC_ROOT, 'main', 'character', 'aeri', 'x')],
    ['createBoard', () => api.createBoard(STATIC_ROOT, 'New')],
    ['renameBoard', () => api.renameBoard(STATIC_ROOT, 'main', 'New')],
    ['deleteBoard', () => api.deleteBoard(STATIC_ROOT, 'main')],
    ['reorderBoards', () => api.reorderBoards(STATIC_ROOT, ['main'])],
    ['createView', () => api.createView(STATIC_ROOT, 'main', 'New', null)],
    ['duplicateView', () => api.duplicateView(STATIC_ROOT, 'main', 'everyone', 'Copy')],
    ['renameView', () => api.renameView(STATIC_ROOT, 'main', 'everyone', 'New')],
    ['deleteView', () => api.deleteView(STATIC_ROOT, 'main', 'everyone')],
    ['reorderViews', () => api.reorderViews(STATIC_ROOT, 'main', ['everyone'])],
    ['createCard', () => api.createCard(STATIC_ROOT, { boardId: 'main', title: 'x', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1' })],
    ['updateCard', () => api.updateCard(STATIC_ROOT, 'main', board.cards[0])],
    ['deleteCard', () => api.deleteCard(STATIC_ROOT, 'main', 'card-1')]
  ]

  it.each(writes)('refuses %s', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ReadOnlyError)
  })

  it('explains why, in words a reader will understand', async () => {
    await expect(api.deleteCard(STATIC_ROOT, 'main', 'card-1')).rejects.toThrow(/read-only/i)
    await expect(api.deleteCard(STATIC_ROOT, 'main', 'card-1')).rejects.toThrow(/not saved/i)
  })

  it('leaves the data untouched after a refused write', async () => {
    await api.deleteCard(STATIC_ROOT, 'main', 'card-1').catch(() => {})
    expect((await api.reloadProject(STATIC_ROOT)).boards[0].board.cards).toHaveLength(1)
  })
})
