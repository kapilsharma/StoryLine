import { useEffect, useRef, useState } from 'react'
import { isEmptyEntityBody } from '@shared/entityBody'
import { useStore } from '../store'
import { MarkdownPreview } from './MarkdownPreview'

/**
 * The notes column of the Characters tab (issue #33) — the markdown body of the
 * selected character's file, previewed in place with an Edit toggle.
 *
 * A character whose body is empty (or only the old `## Notes` / `## Research`
 * skeleton) has no note yet and offers "Add note" instead of a blank preview.
 * Starting one clears the skeleton, so the first save takes it off disk.
 *
 * Editing swaps the preview for a plain textarea rather than splitting the
 * column: half a window is too narrow to read a live preview beside the source.
 * The fullscreen editor (Open in editor, in the properties column) is still
 * there for side-by-side work.
 */
export function CharacterNotes({ characterId }: { characterId: string }): JSX.Element {
  const { getEntityBody, saveEntityBody, readOnly } = useStore()

  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const dirty = useRef(false)

  // Bodies are not part of the snapshot, so fetch on mount. The component is
  // keyed on the character, so this runs once per selection.
  useEffect(() => {
    let cancelled = false
    getEntityBody('character', characterId)
      .then((b) => !cancelled && (setBody(b), setLoaded(true)))
      .catch(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced auto-save, as on the fullscreen editor. Skipped when read-only (a
  // published site), where the save would be refused anyway.
  useEffect(() => {
    if (readOnly || !dirty.current || !loaded) return
    const timer = setTimeout(() => {
      void saveEntityBody('character', characterId, body)
    }, 900)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body])

  const empty = isEmptyEntityBody(body)

  const startNote = (): void => {
    // Drop a skeleton-only body rather than editing around it.
    if (body !== '') {
      dirty.current = true
      setBody('')
    }
    setEditing(true)
  }

  const finishEditing = (): void => {
    if (!readOnly && dirty.current) void saveEntityBody('character', characterId, body)
    setEditing(false)
  }

  return (
    <>
      <div className="character-notes-head">
        <h2>Notes</h2>
        {!readOnly &&
          loaded &&
          (editing ? (
            <button className="btn small primary" onClick={finishEditing}>
              Done
            </button>
          ) : (
            // "Edit note", not "Edit": the properties column beside it already
            // offers "Open in editor" for the same file.
            !empty && (
              <button className="btn small" onClick={() => setEditing(true)}>
                Edit note
              </button>
            )
          ))}
      </div>

      {!loaded ? (
        <p className="muted small">Loading…</p>
      ) : editing ? (
        <>
          <textarea
            className="character-notes-textarea"
            value={body}
            onChange={(e) => {
              dirty.current = true
              setBody(e.target.value)
            }}
            placeholder="Write in Markdown…"
            autoFocus
          />
          <p className="muted small autosave-hint">Auto-saves</p>
        </>
      ) : empty ? (
        <div className="character-notes-empty">
          <p className="muted small">No note for this character yet.</p>
          {!readOnly && (
            <button className="btn" onClick={startNote}>
              Add note
            </button>
          )}
        </div>
      ) : (
        <MarkdownPreview markdown={body} className="character-notes-body" />
      )}
    </>
  )
}
