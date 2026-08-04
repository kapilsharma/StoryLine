import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Ephemeral, per-session board view state shared between the board grid and the
 * tab-bar toolbar — currently which cards are expanded, plus expand/collapse-all.
 * Not persisted (expansion is a transient view action).
 */
interface BoardUiValue {
  isExpanded: (cardId: string) => boolean
  toggle: (cardId: string) => void
  /** Cards on the active board (registered by the grid) — drives expand-all. */
  cardIds: string[]
  registerCards: (ids: string[]) => void
  allExpanded: boolean
  setAll: (expand: boolean) => void
}

const BoardUiContext = createContext<BoardUiValue | null>(null)

export function BoardUiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [cardIds, setCardIds] = useState<string[]>([])

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

  const value = useMemo<BoardUiValue>(
    () => ({ isExpanded, toggle, cardIds, registerCards, allExpanded, setAll }),
    [isExpanded, toggle, cardIds, registerCards, allExpanded, setAll]
  )

  return <BoardUiContext.Provider value={value}>{children}</BoardUiContext.Provider>
}

export function useBoardUi(): BoardUiValue {
  const ctx = useContext(BoardUiContext)
  if (!ctx) throw new Error('useBoardUi must be used within BoardUiProvider')
  return ctx
}
