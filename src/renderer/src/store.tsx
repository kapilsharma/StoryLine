import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { AppConfig, AppSettings } from '@shared/config'
import type { BoardData, EntityBodyKind, NewCardInput, ProjectSnapshot } from '@shared/ipc'
import type { Board, Card, Character, Note, TimelineUnit, View } from '@shared/types'
import { buildGraph, type FamilyGraph } from '@shared/graph'
import { api } from './api'
import { editorStyleVars } from './lib/markdown'

/** What the dedicated fullscreen editor is currently editing. */
export type EditorKind = 'note' | EntityBodyKind
export interface EditorTarget {
  kind: EditorKind
  boardId: string
  id: string
}

interface StoreValue {
  config: AppConfig | null
  snapshot: ProjectSnapshot | null
  loading: boolean
  error: string | null
  /** Dismiss the current error (the toast's close button). */
  clearError: () => void
  /**
   * True in a published static export: the UI stays interactive, but anything
   * backed by a file on disk is refused by the api layer. Components use this to
   * suppress auto-save and hide actions that make no sense off the desktop.
   */
  readOnly: boolean

  /** All boards (metadata) for the tab strip / picker. */
  boards: Board[]
  activeBoardId: string | null
  activeBoard: BoardData | null
  setActiveBoard: (id: string) => void

  /**
   * The active board's cast as people-and-unions, for the Family tab. Derived
   * from the snapshot and memoised — never rebuilt per frame. Null with no board.
   */
  graph: FamilyGraph | null
  /** The active board's saved family trees, in tab order. */
  views: View[]
  activeViewId: string | null
  activeView: View | null
  setActiveView: (id: string) => void

  newProject: () => Promise<void>
  openPicker: () => Promise<void>
  openByPath: (root: string) => Promise<void>
  removeRecent: (root: string) => Promise<void>
  closeProject: () => void
  saveProjectMeta: (name: string, timelineLabel: string) => Promise<void>
  saveFamilyColours: (families: Record<string, string>) => Promise<void>
  updateSettings: (settings: AppSettings) => Promise<void>

  // Per-board mutations operate on the active board.
  /**
   * Create or update a character. A *new* character is not added to the board
   * grid unless `addToBoard` is set — membership is opt-in, so someone entered
   * for the family tree stays off the plot.
   */
  saveCharacter: (character: Character, addToBoard?: boolean) => Promise<void>
  deleteCharacter: (id: string) => Promise<void>
  /** Renames the character's file and retargets every reference to its old id. */
  renameCharacter: (id: string, newName: string) => Promise<void>
  /** Rewrites the children's `father`/`mother` — children are never stored. */
  setChildren: (parentId: string, childIds: string[]) => Promise<void>
  saveTimelineUnit: (unit: TimelineUnit) => Promise<void>
  deleteTimelineUnit: (id: string) => Promise<void>
  reorderTimeline: (orderedIds: string[]) => Promise<void>
  saveNote: (note: Note) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  /** Fetch a note's full content (body is lazy-loaded) from the active board. */
  getNote: (id: string) => Promise<Note>
  renameNote: (oldId: string, newName: string) => Promise<void>
  getEntityBody: (kind: EntityBodyKind, id: string) => Promise<string>
  saveEntityBody: (kind: EntityBodyKind, id: string, body: string) => Promise<void>

  saveBoard: (board: Board) => Promise<void>
  createBoard: (name: string) => Promise<void>
  renameBoard: (id: string, name: string) => Promise<void>
  deleteBoard: (id: string) => Promise<void>
  reorderBoards: (orderedIds: string[]) => Promise<void>

  createCard: (input: NewCardInput) => Promise<void>
  updateCard: (boardId: string, card: Card) => Promise<void>
  deleteCard: (boardId: string, cardId: string) => Promise<void>

  saveView: (view: View) => Promise<void>
  createView: (name: string, rootCharacterId?: string | null) => Promise<void>
  duplicateView: (id: string, name: string) => Promise<void>
  renameView: (id: string, name: string) => Promise<void>
  deleteView: (id: string) => Promise<void>
  reorderViews: (orderedIds: string[]) => Promise<void>

  // Dedicated fullscreen editor
  editorTarget: EditorTarget | null
  openEditor: (kind: EditorKind, id: string) => void
  closeEditor: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

export interface StoreProviderProps {
  children: ReactNode
  /** See {@link StoreValue.readOnly}. */
  readOnly?: boolean
  /**
   * Open this project on mount instead of showing the dashboard. Used by the
   * static build, where the folder holds exactly one project and there is no
   * picker to show.
   */
  bootRoot?: string
}

export function StoreProvider({ children, readOnly = false, bootRoot }: StoreProviderProps): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null)
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rootRef = useRef<string | null>(null)
  rootRef.current = snapshot?.root ?? null

  const boards = useMemo(() => (snapshot?.boards ?? []).map((bd) => bd.board), [snapshot])
  const activeBoard = useMemo(
    () => snapshot?.boards.find((bd) => bd.board.id === activeBoardId) ?? null,
    [snapshot, activeBoardId]
  )
  const activeBoardRef = useRef<string | null>(null)
  activeBoardRef.current = activeBoardId

  // Keep the active board valid as boards come and go.
  useEffect(() => {
    if (!snapshot || snapshot.boards.length === 0) {
      setActiveBoardId(null)
    } else if (!snapshot.boards.some((bd) => bd.board.id === activeBoardId)) {
      setActiveBoardId(snapshot.boards[0].board.id)
    }
  }, [snapshot, activeBoardId])

  const views = useMemo(() => activeBoard?.views ?? [], [activeBoard])
  const activeView = useMemo(() => views.find((v) => v.id === activeViewId) ?? null, [views, activeViewId])

  // Keep the active view valid as views (and boards) come and go.
  useEffect(() => {
    if (!views.length) setActiveViewId(null)
    else if (!views.some((v) => v.id === activeViewId)) setActiveViewId(views[0].id)
  }, [views, activeViewId])

  /**
   * The family graph is derived, not stored — rebuilt only when the active
   * board's characters change. Depending on the array identity rather than the
   * whole snapshot keeps a note or card edit from re-laying-out the tree.
   */
  const characters = activeBoard?.characters
  const graph = useMemo<FamilyGraph | null>(
    () => (characters ? buildGraph(characters) : null),
    [characters]
  )

  useEffect(() => {
    api.getConfig().then(setConfig).catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = config?.settings.theme ?? 'light'
  }, [config?.settings.theme])

  // Apply the markdown preview colours/sizes as CSS variables on :root. Colours
  // are theme-specific (Issue 14), so re-apply when the theme changes too.
  useEffect(() => {
    const vars = editorStyleVars(config?.settings.editorStyles, config?.settings.theme ?? 'light')
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v)
  }, [config?.settings.editorStyles, config?.settings.theme])

  // Live reload: debounce filesystem changes into a single project re-read.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = api.onProjectChange(() => {
      if (!rootRef.current) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const root = rootRef.current
        if (root) api.reloadProject(root).then(setSnapshot).catch((e) => setError(String(e)))
      }, 150)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  const run = useCallback(async (fn: () => Promise<void>): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  /** Mutation that returns the fresh snapshot; applies it. */
  const mutate = useCallback(
    (fn: (root: string) => Promise<ProjectSnapshot>): Promise<void> =>
      run(async () => {
        const root = rootRef.current
        if (!root) return
        setSnapshot(await fn(root))
      }),
    [run]
  )

  /** Mutation that also needs the active board id. */
  const mutateBoard = useCallback(
    (fn: (root: string, boardId: string) => Promise<ProjectSnapshot>): Promise<void> =>
      run(async () => {
        const root = rootRef.current
        const boardId = activeBoardRef.current
        if (!root || !boardId) return
        setSnapshot(await fn(root, boardId))
      }),
    [run]
  )

  const clearError = useCallback(() => setError(null), [])

  const openByPath = useCallback(
    (root: string) =>
      run(async () => {
        setSnapshot(await api.openProject(root))
        setConfig(await api.getConfig())
      }),
    [run]
  )

  // Static build: open the bundled project immediately. Guarded by a ref because
  // StrictMode double-invokes effects in development.
  const booted = useRef(false)
  useEffect(() => {
    if (!bootRoot || booted.current) return
    booted.current = true
    void openByPath(bootRoot)
  }, [bootRoot, openByPath])

  const newProject = useCallback(
    () =>
      run(async () => {
        const path = await api.createProject()
        if (path) {
          setSnapshot(await api.openProject(path))
          setConfig(await api.getConfig())
        }
      }),
    [run]
  )

  const openPicker = useCallback(
    () =>
      run(async () => {
        const path = await api.pickProject()
        if (path) {
          setSnapshot(await api.openProject(path))
          setConfig(await api.getConfig())
        }
      }),
    [run]
  )

  const removeRecent = useCallback(
    (root: string) => run(async () => setConfig(await api.removeRecent(root))),
    [run]
  )

  const closeProject = useCallback(() => setSnapshot(null), [])

  const updateSettings = useCallback(
    (settings: AppSettings) => run(async () => setConfig(await api.updateSettings(settings))),
    [run]
  )

  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null)
  const openEditor = useCallback((kind: EditorKind, id: string) => {
    const boardId = activeBoardRef.current
    if (boardId) setEditorTarget({ kind, boardId, id })
  }, [])
  const closeEditor = useCallback(() => setEditorTarget(null), [])

  const getNote = useCallback(async (id: string): Promise<Note> => {
    const root = rootRef.current
    const boardId = activeBoardRef.current
    if (!root || !boardId) throw new Error('No active board')
    return api.getNote(root, boardId, id)
  }, [])

  const getEntityBody = useCallback(async (kind: EntityBodyKind, id: string): Promise<string> => {
    const root = rootRef.current
    const boardId = activeBoardRef.current
    if (!root || !boardId) throw new Error('No active board')
    return api.getEntityBody(root, boardId, kind, id)
  }, [])

  const value = useMemo<StoreValue>(
    () => ({
      config,
      snapshot,
      loading,
      error,
      clearError,
      readOnly,
      boards,
      activeBoardId,
      activeBoard,
      setActiveBoard: setActiveBoardId,
      graph,
      views,
      activeViewId,
      activeView,
      setActiveView: setActiveViewId,
      newProject,
      openPicker,
      openByPath,
      removeRecent,
      closeProject,
      updateSettings,
      saveProjectMeta: (name, label) => mutate((root) => api.saveProjectMeta(root, name, label)),
      saveFamilyColours: (families) => mutate((root) => api.saveFamilyColours(root, families)),
      saveCharacter: (c, addToBoard) => mutateBoard((root, b) => api.saveCharacter(root, b, c, addToBoard)),
      deleteCharacter: (id) => mutateBoard((root, b) => api.deleteCharacter(root, b, id)),
      renameCharacter: (id, newName) => mutateBoard((root, b) => api.renameCharacter(root, b, id, newName)),
      setChildren: (parentId, childIds) =>
        mutateBoard((root, b) => api.setChildren(root, b, parentId, childIds)),
      saveTimelineUnit: (u) => mutateBoard((root, b) => api.saveTimelineUnit(root, b, u)),
      deleteTimelineUnit: (id) => mutateBoard((root, b) => api.deleteTimelineUnit(root, b, id)),
      reorderTimeline: (ids) => mutateBoard((root, b) => api.reorderTimeline(root, b, ids)),
      saveNote: (n) => mutateBoard((root, b) => api.saveNote(root, b, n)),
      deleteNote: (id) => mutateBoard((root, b) => api.deleteNote(root, b, id)),
      getNote,
      renameNote: (oldId, newName) => mutateBoard((root, b) => api.renameNote(root, b, oldId, newName)),
      getEntityBody,
      saveEntityBody: (kind, id, body) => mutateBoard((root, b) => api.saveEntityBody(root, b, kind, id, body)),
      saveBoard: (b) => mutate((root) => api.saveBoard(root, b)),
      createBoard: (name) => mutate((root) => api.createBoard(root, name)),
      renameBoard: (id, name) => mutate((root) => api.renameBoard(root, id, name)),
      deleteBoard: (id) => mutate((root) => api.deleteBoard(root, id)),
      reorderBoards: (ids) => mutate((root) => api.reorderBoards(root, ids)),
      createCard: (input) => mutate((root) => api.createCard(root, input)),
      updateCard: (boardId, card) => mutate((root) => api.updateCard(root, boardId, card)),
      deleteCard: (boardId, cardId) => mutate((root) => api.deleteCard(root, boardId, cardId)),
      saveView: (v) => mutateBoard((root, b) => api.saveView(root, b, v)),
      createView: (name, rootCharacterId) =>
        mutateBoard((root, b) => api.createView(root, b, name, rootCharacterId ?? null)),
      duplicateView: (id, name) => mutateBoard((root, b) => api.duplicateView(root, b, id, name)),
      renameView: (id, name) => mutateBoard((root, b) => api.renameView(root, b, id, name)),
      deleteView: (id) => mutateBoard((root, b) => api.deleteView(root, b, id)),
      reorderViews: (ids) => mutateBoard((root, b) => api.reorderViews(root, b, ids)),
      editorTarget,
      openEditor,
      closeEditor
    }),
    [config, snapshot, loading, error, clearError, readOnly, boards, activeBoardId, activeBoard, graph, views, activeViewId, activeView, newProject, openPicker, openByPath, removeRecent, closeProject, updateSettings, mutate, mutateBoard, getNote, getEntityBody, editorTarget, openEditor, closeEditor]
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
