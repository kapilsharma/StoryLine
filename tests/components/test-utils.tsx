import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import type { AppApi, BoardData, ProjectSnapshot } from '@shared/ipc'
import type { AppConfig } from '@shared/config'
import type { Board, Character, Note, Project, TimelineUnit } from '@shared/types'
import { SCHEMA_VERSION } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/config'
import { StoreProvider } from '@renderer/store'
import { PromptProvider } from '@renderer/components/PromptModal'

export const baseConfig: AppConfig = { recents: [], settings: { ...DEFAULT_SETTINGS } }

/** Build a fully-stubbed AppApi; override individual methods per test. */
export function makeApi(overrides: Partial<AppApi> = {}): AppApi {
  const api: AppApi = {
    getConfig: vi.fn().mockResolvedValue(baseConfig),
    updateSettings: vi.fn().mockResolvedValue(baseConfig),
    createProject: vi.fn().mockResolvedValue(null),
    pickProject: vi.fn().mockResolvedValue(null),
    openProject: vi.fn(),
    reloadProject: vi.fn(),
    removeRecent: vi.fn().mockResolvedValue(baseConfig),
    saveProjectMeta: vi.fn(),
    saveFamilyColours: vi.fn(),
    saveCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
    renameCharacter: vi.fn(),
    setChildren: vi.fn(),
    saveTimelineUnit: vi.fn(),
    deleteTimelineUnit: vi.fn(),
    reorderTimeline: vi.fn(),
    saveNote: vi.fn(),
    deleteNote: vi.fn(),
    getNote: vi.fn(),
    renameNote: vi.fn(),
    getEntityBody: vi.fn().mockResolvedValue(''),
    saveEntityBody: vi.fn(),
    saveBoard: vi.fn(),
    createBoard: vi.fn(),
    renameBoard: vi.fn(),
    deleteBoard: vi.fn(),
    reorderBoards: vi.fn(),
    saveView: vi.fn(),
    createView: vi.fn(),
    duplicateView: vi.fn(),
    renameView: vi.fn(),
    deleteView: vi.fn(),
    reorderViews: vi.fn(),
    searchNotes: vi.fn().mockResolvedValue([]),
    importAsset: vi.fn(),
    pickAsset: vi.fn().mockResolvedValue(null),
    createCard: vi.fn(),
    updateCard: vi.fn(),
    deleteCard: vi.fn(),
    onProjectChange: vi.fn().mockReturnValue(() => {}),
    ...overrides
  }
  ;(window as unknown as { api: AppApi }).api = api
  return api
}

/**
 * Build a `ProjectSnapshot` with sensible defaults.
 *
 * Exists so a test can state only what it cares about — a project kind, a couple
 * of notes — instead of restating the whole shape. Board and project fields are
 * deep-merged one level, which is enough for every current caller.
 */
export function makeSnapshot(
  over: {
    project?: Partial<Project>
    board?: Partial<Board>
    characters?: Character[]
    timeline?: TimelineUnit[]
    notes?: Note[]
    boards?: BoardData[]
  } = {}
): ProjectSnapshot {
  const board: Board = {
    id: 'main',
    name: 'Main Board',
    cards: [],
    hiddenRows: [],
    hiddenCols: [],
    presets: [],
    rowOrder: [],
    rowGroupOrder: [],
    colOrder: [],
    collapsedRowGroups: [],
    collapsedColGroups: [],
    zoom: 1,
    members: null,
    views: [],
    ...over.board
  }

  return {
    root: '/project',
    project: {
      schemaVersion: SCHEMA_VERSION,
      name: 'My Novel',
      timelineLabel: 'Chapter',
      boards: [board.id],
      created: '2026-08-01',
      lastOpened: '2026-08-10',
      families: {},
      ...over.project
    },
    boards: over.boards ?? [
      {
        board,
        characters: over.characters ?? [],
        timeline: over.timeline ?? [],
        notes: over.notes ?? [],
        views: [],
        problems: []
      }
    ]
  }
}

/** A board-data block, for a multi-board snapshot. */
export function makeBoardData(
  id: string,
  over: { name?: string; characters?: Character[]; timeline?: TimelineUnit[]; notes?: Note[] } = {}
): BoardData {
  return {
    board: {
      id,
      name: over.name ?? id,
      cards: [],
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      members: null,
      rowOrder: [],
      rowGroupOrder: [],
      colOrder: [],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1,
      views: []
    },
    characters: over.characters ?? [],
    timeline: over.timeline ?? [],
    notes: over.notes ?? [],
    views: [],
    problems: []
  }
}

/** Render a component inside the app's providers. */
export function renderWithProviders(
  ui: ReactElement,
  { readOnly, bootRoot }: { readOnly?: boolean; bootRoot?: string } = {}
): ReturnType<typeof render> {
  return render(
    <StoreProvider readOnly={readOnly} bootRoot={bootRoot}>
      <PromptProvider>{ui}</PromptProvider>
    </StoreProvider>
  )
}
