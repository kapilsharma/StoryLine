import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { MarkdownPreview } from './MarkdownPreview'

interface Props {
  /** A single column, or a group of them (Issue #104). */
  kind: 'timeline' | 'colgroup'
  id: string
  label: string
  onClose: () => void
}

/**
 * Read-only preview of the note on a column or group header, opened from the
 * board — the same job `CharacterNotePopup` does for a row header, for the other
 * axis. "Edit" goes to the fullscreen editor, as it does for a card's note.
 */
export function ColumnNotePopup({ kind, id, label, onClose }: Props): JSX.Element {
  const { getEntityBody, openEditor, readOnly } = useStore()

  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    getEntityBody(kind, id)
      .then((b) => !cancelled && (setBody(b), setLoaded(true)))
      .catch(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onEdit = (): void => {
    openEditor(kind, id)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal note-popup" onClick={(e) => e.stopPropagation()}>
        <header className="note-popup-head">
          <h2>{label}</h2>
          <div className="note-popup-head-actions">
            {!readOnly && (
              <button className="btn small" onClick={onEdit}>
                Edit
              </button>
            )}
            <button className="icon-btn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>

        {!loaded ? (
          <p className="muted small">Loading…</p>
        ) : (
          <MarkdownPreview markdown={body} className="note-body" />
        )}

        <footer className="note-popup-foot">
          <span className="muted small autosave-hint">
            File: <code>{kind === 'timeline' ? 'timeline' : 'colgroups'}/{id}.md</code>
          </span>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
