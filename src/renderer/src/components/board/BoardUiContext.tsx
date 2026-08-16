import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

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
  const [cardIds, setCardIds] = useState<string[]>([])
  const [revising, setRevisingState] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
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
