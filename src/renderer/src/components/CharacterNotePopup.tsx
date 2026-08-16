import { useEffect, useState } from 'react'
import type { Character } from '@shared/types'
import { useStore } from '../store'
import { MarkdownPreview } from './MarkdownPreview'

interface Props {
  character: Character
  onClose: () => void
}

/**
 * Read-only preview of a character's note, opened from the board's row header
 * (issue #41). Deliberately the note and nothing else — the character's
 * properties are a click away on the Characters tab, and repeating them here
 * would make the popup a second, worse character form.
 *
 * Editing is not offered in place: "Edit" closes the popup and reveals the
 * character on the Characters tab, which is where the note editor built in
 * issue #33 lives.
 */
export function CharacterNotePopup({ character, onClose }: Props): JSX.Element {
  const { getEntityBody, revealCharacter, readOnly } = useStore()

  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Character bodies are not part of the snapshot; only `hasNote` is, which is
  // what made the row clickable in the first place. Fetch the prose itself here.
  useEffect(() => {
    let cancelled = false
    getEntityBody('character', character.id)
      .then((b) => !cancelled && (setBody(b), setLoaded(true)))
      .catch(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id])


  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onEdit = (): void => {
    revealCharacter(character.id)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal note-popup" onClick={(e) => e.stopPropagation()}>
        <header className="note-popup-head">
          <h2>
            <span className="swatch" style={{ background: character.colour }} /> {character.name}
          </h2>
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
            File: <code>characters/{character.id}.md</code>
          </span>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
