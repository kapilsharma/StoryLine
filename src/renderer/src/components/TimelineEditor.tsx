import { useEffect, useMemo, useState } from 'react'
import type { TimelineUnit } from '@shared/types'
import { useStore } from '../store'
import { moveBefore } from '../lib/reorder'
import { pluralize } from '../lib/text'
import { BoardPicker } from './BoardPicker'

const MIME_TIMELINE = 'application/x-znstoryline-timeline'

interface FormState {
  id: string
  label: string
  summary: string
  group: string
  tags: string
}

const BLANK: FormState = { id: '', label: '', summary: '', group: '', tags: '' }

function toForm(u: TimelineUnit): FormState {
  return {
    id: u.id,
    label: u.label,
    summary: u.summary ?? '',
    group: u.group ?? '',
    tags: (u.tags ?? []).join(', ')
  }
}

export function TimelineEditor(): JSX.Element {
  const { snapshot, activeBoard, saveTimelineUnit, deleteTimelineUnit, reorderTimeline, openEditor } =
    useStore()
  const units = activeBoard?.timeline ?? []
  const label = snapshot?.project.timelineLabel ?? 'Unit'

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(BLANK)

  const selected = useMemo(() => units.find((u) => u.id === selectedId) ?? null, [units, selectedId])

  useEffect(() => {
    if (creating) return
    if (selected) setForm(toForm(selected))
  }, [selected, creating])

  const startCreate = (): void => {
    setCreating(true)
    setSelectedId(null)
    setForm({ ...BLANK })
  }

  const select = (id: string): void => {
    setCreating(false)
    setSelectedId(id)
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const onSave = async (): Promise<void> => {
    if (!form.label.trim()) return
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean)
    const unit: TimelineUnit = {
      id: form.id,
      label: form.label.trim(),
      order: selected?.order ?? 0,
      ...(form.summary.trim() ? { summary: form.summary.trim() } : {}),
      ...(form.group.trim() ? { group: form.group.trim() } : {}),
      ...(tags.length ? { tags } : {})
    }
    await saveTimelineUnit(unit)
    if (creating) {
      setCreating(false)
      setSelectedId(null)
      setForm(BLANK)
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!selected) return
    if (!confirm(`Delete "${selected.label}"? This also removes its column and cards from all boards.`))
      return
    await deleteTimelineUnit(selected.id)
    setSelectedId(null)
    setForm(BLANK)
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
          <>
            <div className="form-row">
              <label>Label</label>
              <input value={form.label} onChange={(e) => set('label', e.target.value)} autoFocus />
            </div>
            <div className="form-row">
              <label>Summary</label>
              <textarea
                rows={3}
                value={form.summary}
                onChange={(e) => set('summary', e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Group</label>
              <input
                value={form.group}
                placeholder="e.g. Chapter 1, Act 1 (groups columns on the board)"
                onChange={(e) => set('group', e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Tags</label>
              <input
                value={form.tags}
                placeholder="comma, separated"
                onChange={(e) => set('tags', e.target.value)}
              />
            </div>
            <div className="form-actions">
              <button className="btn primary" onClick={onSave} disabled={!form.label.trim()}>
                {creating ? 'Create' : 'Save'}
              </button>
              {selected && (
                <>
                  <button className="btn" onClick={() => openEditor('timeline', selected.id)}>
                    Open in editor
                  </button>
                  <button className="btn danger" onClick={onDelete}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>
      </div>
    </div>
  )
}
