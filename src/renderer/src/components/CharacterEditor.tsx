import { useState } from 'react'
import { useStore } from '../store'
import { BoardPicker } from './BoardPicker'
import { CharacterForm } from './CharacterForm'

export function CharacterEditor(): JSX.Element {
  const { activeBoard, deleteCharacter, openEditor } = useStore()
  const characters = activeBoard?.characters ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

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
          {characters.length === 0 ? (
            <p className="muted small">No characters yet.</p>
          ) : (
            <ul>
              {characters.map((c) => (
                <li key={c.id}>
                  <button
                    className={`entity-row${c.id === selectedId ? ' active' : ''}`}
                    onClick={() => select(c.id)}
                  >
                    <span className="swatch" style={{ background: c.colour }} />
                    <span>{c.name}</span>
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
