import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import type { AppApi } from '@shared/ipc'
import type { AppConfig } from '@shared/config'
import { DEFAULT_EDITOR_STYLES } from '@shared/config'
import { StoreProvider } from '@renderer/store'
import { PromptProvider } from '@renderer/components/PromptModal'

export const baseConfig: AppConfig = {
  recents: [],
  settings: {
    editor: 'vscode',
    obsidianVault: null,
    theme: 'light',
    cardFontSize: 13,
    previewPosition: 'left',
    editorStyles: DEFAULT_EDITOR_STYLES
  }
}

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
    saveCharacter: vi.fn(),
    deleteCharacter: vi.fn(),
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
    createCard: vi.fn(),
    updateCard: vi.fn(),
    deleteCard: vi.fn(),
    onProjectChange: vi.fn().mockReturnValue(() => {}),
    ...overrides
  }
  ;(window as unknown as { api: AppApi }).api = api
  return api
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
