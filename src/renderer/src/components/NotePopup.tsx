import { useEffect, useMemo, useState } from 'react'
import type { Note } from '@shared/types'
import { cardStatuses } from '@shared/cardStatus'
import { useStore } from '../store'
import { CardStatusSelect } from './CardStatusSelect'
import { usePrompt } from './PromptModal'
import { MarkdownPreview } from './MarkdownPreview'

interface Props {
  note: Note
  onClose: () => void
  /** Navigate to a related note (by id). */
  onOpenNote: (id: string) => void
}

/**
 * Read-only preview of a note (Feature 12). Editing happens on the dedicated
 * fullscreen editor, opened via the Edit button.
 */
export function NotePopup({ note, onClose, onOpenNote }: Props): JSX.Element {
  const { snapshot, activeBoard, getNote, saveNote, renameNote, openEditor, readOnly } = useStore()
  const ask = usePrompt()
  const notes = activeBoard?.notes ?? []
  const statuses = snapshot ? cardStatuses(snapshot.project) : []

  const [body, setBody] = useState(note.body)
  const [status, setStatus] = useState(note.status)
  // Not remounted when a related link swaps the note, and the file can change
  // underneath (watcher), so follow the prop.
  useEffect(() => setStatus(note.status), [note.id, note.status])

  // The popup is otherwise read-only, but a status is one click, not an edit
  // session — so it saves at once. `note` is the body-less meta, so the save
  // starts from the full note or it would empty the body.
  const changeStatus = async (next: string | undefined): Promise<void> => {
    setStatus(next)
    const full = await getNote(note.id)
    await saveNote({ ...full, status: next })
  }

  // Body is lazy-loaded; fetch the full note for the preview.
  useEffect(() => {
    let cancelled = false
    getNote(note.id)
      .then((full) => !cancelled && setBody(full.body))
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])


  const related = useMemo(
    () =>
      (note.related ?? []).map((r) => {
        const id = r.file.replace(/\.md$/, '')
        return { id, comment: r.comment, exists: notes.some((n) => n.id === id), file: r.file }
      }),
    [note.related, notes]
  )

  const onRename = async (): Promise<void> => {
    const newName = await ask({ title: 'Rename note file', defaultValue: note.id, confirmLabel: 'Rename' })
    if (newName && newName.trim() && newName.trim() !== note.id) {
      await renameNote(note.id, newName.trim())
      onClose()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal note-popup" onClick={(e) => e.stopPropagation()}>
        <header className="note-popup-head">
          <h2>{note.title}</h2>
          <div className="note-popup-head-actions">
            <button className="btn small" onClick={() => openEditor('note', note.id)}>
              Edit
            </button>
            <button className="icon-btn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>

        <CardStatusSelect
          statuses={statuses}
          value={status}
          disabled={readOnly}
          onChange={(next) => void changeStatus(next)}
        />

        {note.tags && note.tags.length > 0 && (
          <div className="tag-row">
            {note.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}

        <MarkdownPreview markdown={body} className="note-body" onOpenNote={onOpenNote} />

        {related.length > 0 && (
          <div className="related-list">
            <h3>Related</h3>
            <ul>
              {related.map((r) => (
                <li key={r.file}>
                  {r.exists ? (
                    <button className="link-btn" onClick={() => onOpenNote(r.id)}>
                      {r.id}
                    </button>
                  ) : (
                    <span className="muted">{r.file} (missing)</span>
                  )}
                  {r.comment && <span className="related-comment"> — {r.comment}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="note-popup-foot">
          <span className="muted small autosave-hint">
            File: <code>{note.id}.md</code>
          </span>
          <button className="btn" onClick={onRename}>
            Rename file
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
