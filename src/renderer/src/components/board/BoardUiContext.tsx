import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** What the side panel is showing: a card's note, or a row's character note. */
export type PanelTarget = { kind: 'note'; id: string } | { kind: 'character'; id: string }

/**
 * Ephemeral, per-session board view state shared between the board grid and the
 * tab-bar toolbar — which cards are expanded, and revision mode (Issue #67).
 * Not persisted: both are transient ways of *looking* at a board, not content.
 */
interface BoardUiValue {
  isExpanded: (cardId: string) => boolean
  toggle: (cardId: string) => void
  /** Cards on the active board (registered by the grid) — drives expand-all. */
  cardIds: string[]
  registerCards: (ids: string[]) => void
  allExpanded: boolean
  setAll: (expand: boolean) => void

  // ── Row headers (Issue #80) ──
  /**
   * True when this character's row header shows its whole name instead of the
   * two-line default. Keyed by character id, and separate from card expansion:
   * a long name and a long card title are different problems, fixed one at a
   * time by the control next to each.
   */
  isRowExpanded: (charId: string) => boolean
  toggleRow: (charId: string) => void

  // ── Note side panel (Issue #83) ──
  /**
   * The note open beside the board, or null. Lives here rather than in the grid
   * because the panel is laid out *next to* the grid, by `BoardsView`, while the
   * click that opens it happens on a card or a row header inside it.
   */
  panel: PanelTarget | null
  openPanel: (target: PanelTarget) => void
  closePanel: () => void

  // ── Revision mode (Issue #67) ──
  /**
   * When on, card titles are masked until revealed. Turns a board into a prompt
   * sheet: hide the Steps column, try to recall it, then click to check.
   */
  revising: boolean
  setRevising: (on: boolean) => void
  /** True when this card's title should be shown despite revision mode. */
  isRevealed: (cardId: string) => boolean
  /** Reveal (or re-hide) a single card. */
  toggleRevealed: (cardId: string) => void
  /** Reveal or re-hide a specific set — used for a whole row or column. */
  revealMany: (cardIds: string[], reveal: boolean) => void
  /** Reveal or re-hide everything on the board. */
  revealAll: (reveal: boolean) => void
}

const BoardUiContext = createContext<BoardUiValue | null>(null)

export function BoardUiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [cardIds, setCardIds] = useState<string[]>([])
  const [revising, setRevisingState] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<PanelTarget | null>(null)

  const openPanel = useCallback((target: PanelTarget) => setPanel(target), [])
  const closePanel = useCallback(() => setPanel(null), [])

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const isRowExpanded = useCallback((id: string) => expandedRows.has(id), [expandedRows])

  const toggleRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const registerCards = useCallback((ids: string[]) => {
    setCardIds((prev) => (prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids))
  }, [])

  const setAll = useCallback((expand: boolean) => {
    setExpanded(expand ? new Set(cardIds) : new Set())
  }, [cardIds])

  const allExpanded = cardIds.length > 0 && cardIds.every((id) => expanded.has(id))

  // Turning revision mode on starts everything hidden — otherwise the first
  // thing you see on entering a drill is the answers.
  const setRevising = useCallback((on: boolean) => {
    setRevisingState(on)
    setRevealed(new Set())
  }, [])

  const isRevealed = useCallback((id: string) => revealed.has(id), [revealed])

  const toggleRevealed = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const revealMany = useCallback((ids: string[], reveal: boolean) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      for (const id of ids) reveal ? next.add(id) : next.delete(id)
      return next
    })
  }, [])

  const revealAll = useCallback(
    (reveal: boolean) => setRevealed(reveal ? new Set(cardIds) : new Set()),
    [cardIds]
  )

  const value = useMemo<BoardUiValue>(
    () => ({
      isExpanded,
      toggle,
      cardIds,
      registerCards,
      allExpanded,
      setAll,
      isRowExpanded,
      toggleRow,
      panel,
      openPanel,
      closePanel,
      revising,
      setRevising,
      isRevealed,
      toggleRevealed,
      revealMany,
      revealAll
    }),
    [
      isExpanded,
      toggle,
      cardIds,
      registerCards,
      allExpanded,
      setAll,
      isRowExpanded,
      toggleRow,
      panel,
      openPanel,
      closePanel,
      revising,
      setRevising,
      isRevealed,
      toggleRevealed,
      revealMany,
      revealAll
    ]
  )

  return <BoardUiContext.Provider value={value}>{children}</BoardUiContext.Provider>
}

export function useBoardUi(): BoardUiValue {
  const ctx = useContext(BoardUiContext)
  if (!ctx) throw new Error('useBoardUi must be used within BoardUiProvider')
  return ctx
}
