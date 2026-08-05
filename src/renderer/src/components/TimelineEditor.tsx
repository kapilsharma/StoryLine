import { useState } from 'react'
import { useStore } from '../store'
import { moveBefore } from '../lib/reorder'
import { pluralize } from '../lib/text'
import { BoardPicker } from './BoardPicker'
import { TimelineForm } from './TimelineForm'

const MIME_TIMELINE = 'application/x-znstoryline-timeline'

export function TimelineEditor(): JSX.Element {
  const { snapshot, activeBoard, deleteTimelineUnit, reorderTimeline, openEditor } = useStore()
  const units = activeBoard?.timeline ?? []
  const label = snapshot?.project.timelineLabel ?? 'Unit'

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const selected = units.find((u) => u.id === selectedId) ?? null

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
    if (!confirm(`Delete "${selected.label}"? This also removes its column and cards from all boards.`))
      return
    await deleteTimelineUnit(selected.id)
    setSelectedId(null)
  }

  const move = async (id: string, dir: -1 | 1): Promise<void> => {
    const ids = units.map((u) => u.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await reorderTimeline(ids)
  }

  const onDrop = (draggedId: string, targetId: string): void => {
    const ids = units.map((u) => u.id)
    const next = moveBefore(ids, draggedId, targetId)
    if (next !== ids) void reorderTimeline(next)
  }

  const editing = creating || selected != null

  return (
    <div className="board-scoped-tab">
      <BoardPicker />
      <div className="editor-layout">
        <aside className="entity-list">
          <div className="entity-list-head">
            <h2>{pluralize(label)}</h2>
            <button className="btn small" onClick={startCreate}>
              + Add {label.toLowerCase()}
            </button>
          </div>
          {units.length === 0 ? (
            <p className="muted small">No {pluralize(label.toLowerCase())} yet.</p>
          ) : (
            <ul>
              {units.map((u, i) => (
                <li
                  key={u.id}
                  className="ordered-row draggable"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(MIME_TIMELINE, u.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const dragged = e.dataTransfer.getData(MIME_TIMELINE)
                    if (dragged) onDrop(dragged, u.id)
                  }}
                >
                  <button
                    className={`entity-row${u.id === selectedId ? ' active' : ''}`}
                    onClick={() => select(u.id)}
                  >
                    <span className="order-num">{i + 1}</span>
                    <span>{u.label}</span>
                  </button>
                  <div className="reorder-btns">
                    <button className="icon-btn" disabled={i === 0} onClick={() => move(u.id, -1)}>
                      ↑
                    </button>
                    <button
                      className="icon-btn"
                      disabled={i === units.length - 1}
                      onClick={() => move(u.id, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="entity-form">
          {!editing ? (
            <p className="muted">Select a {label.toLowerCase()} or add a new one.</p>
          ) : (
            <TimelineForm
              key={selected?.id ?? 'new'}
              initial={selected}
              onSaved={() => {
                if (creating) {
                  setCreating(false)
                  setSelectedId(null)
                }
              }}
              onDelete={selected ? onDelete : undefined}
              onOpenInEditor={selected ? () => openEditor('timeline', selected.id) : undefined}
            />
          )}
        </section>
      </div>
    </div>
  )
}
