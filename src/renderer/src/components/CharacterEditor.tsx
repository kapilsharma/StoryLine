import { useMemo, useState } from 'react'
import type { Character } from '@shared/types'
import { viewMembers } from '@shared/selection'
import { boardMembers } from './board/grid-utils'
import { useStore } from '../store'
import { BoardPicker } from './BoardPicker'
import { CharacterForm } from './CharacterForm'

/**
 * Where a character turns up. Derived live from the board's `members` and each
 * tree's membership — nothing extra is stored, so the counts cannot drift out of
 * step with the board and the Family tab.
 */
type Where = 'all' | 'board' | 'tree' | 'reference'

const FILTERS: Array<{ key: Where; label: string; hint: string }> = [
  { key: 'all', label: 'All', hint: 'Every character in this board’s folder' },
  { key: 'board', label: 'On board', hint: 'A row on the board grid' },
  { key: 'tree', label: 'On a tree', hint: 'Drawn by at least one family tree' },
  {
    key: 'reference',
    label: 'Reference only',
    hint: 'On neither the board nor a tree — context you have entered but not placed yet'
  }
]

export function CharacterEditor(): JSX.Element {
  const { activeBoard, graph, views, deleteCharacter, openEditor } = useStore()
  const characters = activeBoard?.characters ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [where, setWhere] = useState<Where>('all')
  const [query, setQuery] = useState('')

  /** Ids on the board grid, and ids drawn by at least one tree. */
  const placement = useMemo(() => {
    const onBoard = new Set(
      activeBoard ? boardMembers(activeBoard.board, characters).map((c) => c.id) : []
    )
    const onTree = new Set<string>()
    if (graph) {
      for (const view of views) for (const id of viewMembers(graph, view)) onTree.add(id)
    }
    return { onBoard, onTree }
  }, [activeBoard, characters, graph, views])

  const counts = useMemo(() => {
    const n = { all: characters.length, board: 0, tree: 0, reference: 0 }
    for (const c of characters) {
      const b = placement.onBoard.has(c.id)
      const t = placement.onTree.has(c.id)
      if (b) n.board++
      if (t) n.tree++
      if (!b && !t) n.reference++
    }
    return n
  }, [characters, placement])

  const matches = (c: Character): boolean => {
    const b = placement.onBoard.has(c.id)
    const t = placement.onTree.has(c.id)
    if (where === 'board' && !b) return false
    if (where === 'tree' && !t) return false
    if (where === 'reference' && (b || t)) return false
    const q = query.trim().toLowerCase()
    return !q || c.name.toLowerCase().includes(q)
  }

  const shown = characters.filter(matches)
  const selected = characters.find((c) => c.id === selectedId) ?? null

  const startCreate = (): void => {
    setCreating(true)
    setSelectedId(null)
  }

  const select = (id: string): void => {
    setCreating(false)
    setSelectedId(id)
  }

  const onDelete = async (): Promise<void> => {
    if (!selected) return
    if (!confirm(`Delete "${selected.name}"? This also removes its cards from this board.`)) return
    await deleteCharacter(selected.id)
    setSelectedId(null)
  }

  const editing = creating || selected != null

  /** Why the list is empty — "no characters" and "none match" are different. */
  const emptyMessage =
    characters.length === 0
      ? 'No characters yet.'
      : where === 'reference'
        ? 'Every character is on the board or a tree.'
        : 'No character matches this filter.'

  return (
    <div className="board-scoped-tab">
      <BoardPicker />
      <div className="editor-layout">
        <aside className="entity-list">
          <div className="entity-list-head">
            <h2>Characters</h2>
            <button className="btn small" onClick={startCreate}>
              + Add
            </button>
          </div>

          <input
            className="search"
            value={query}
            placeholder="Search characters…"
            onChange={(e) => setQuery(e.target.value)}
          />

          {/* Adding a character no longer puts them on a board or a tree, so the
              list grows past what either shows. These say where each one landed. */}
          <div className="tag-filter">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`tag-chip${where === f.key ? ' active' : ''}`}
                title={f.hint}
                onClick={() => setWhere(f.key)}
              >
                {f.label} ({counts[f.key]})
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="muted small">{emptyMessage}</p>
          ) : (
            <ul>
              {shown.map((c) => (
                <li key={c.id}>
                  <button
                    className={`entity-row${c.id === selectedId ? ' active' : ''}`}
                    onClick={() => select(c.id)}
                  >
                    <span className="swatch" style={{ background: c.colour }} />
                    <span>{c.name}</span>
                    {/* Only worth marking the ones that are nowhere yet. */}
                    {!placement.onBoard.has(c.id) && !placement.onTree.has(c.id) && (
                      <span className="muted small" title="Not on the board or any tree">
                        ref
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="entity-form">
          {!editing ? (
            <p className="muted">Select a character or add a new one.</p>
          ) : (
            <CharacterForm
              key={selected?.id ?? 'new'}
              initial={selected}
              onSaved={() => {
                if (creating) {
                  setCreating(false)
                  setSelectedId(null)
                }
              }}
              onDelete={selected ? onDelete : undefined}
              onOpenInEditor={selected ? () => openEditor('character', selected.id) : undefined}
            />
          )}
        </section>
      </div>
    </div>
  )
}
