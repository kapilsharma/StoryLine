import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { NotePopup } from './NotePopup'
import { BoardPicker } from './BoardPicker'

export function NotesBrowser(): JSX.Element {
  const { activeBoard, openEditor } = useStore()
  const notes = activeBoard?.notes ?? []

  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const allTags = useMemo(() => {
    const set = new Set<string>()
    notes.forEach((n) => n.tags?.forEach((t) => set.add(t)))
    return [...set].sort()
  }, [notes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes.filter((n) => {
      if (tagFilter && !(n.tags ?? []).includes(tagFilter)) return false
      if (q && !n.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [notes, query, tagFilter])

  const openNote = useMemo(() => notes.find((n) => n.id === openId) ?? null, [notes, openId])

  return (
    <div className="notes-browser">
      <BoardPicker />
      <div className="notes-toolbar">
        <input
          className="search"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tag-filter">
          <button
            className={`tag-chip${tagFilter === null ? ' active' : ''}`}
            onClick={() => setTagFilter(null)}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              className={`tag-chip${tagFilter === t ? ' active' : ''}`}
              onClick={() => setTagFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted placeholder">No notes match.</p>
      ) : (
        <ul className="note-grid">
          {filtered.map((n) => (
            <li key={n.id} className="note-card">
              <button className="note-card-main" onClick={() => setOpenId(n.id)}>
                <span className="note-card-title">{n.title}</span>
                {n.tags && n.tags.length > 0 && (
                  <span className="note-card-tags">
                    {n.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
                <span className="note-card-meta">
                  {n.created && <span>{n.created}</span>}
                </span>
              </button>
              <button className="link-btn note-card-edit" onClick={() => openEditor('note', n.id)}>
                Open in editor
              </button>
            </li>
          ))}
        </ul>
      )}

      {openNote && (
        <NotePopup note={openNote} onClose={() => setOpenId(null)} onOpenNote={setOpenId} />
      )}
    </div>
  )
}
