import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import { useStore } from '../../store'
import { usePrompt } from '../PromptModal'
import { LiveMarkdownEditor } from '../LiveMarkdownEditor'
import type { PanelTarget } from './BoardUiContext'

interface Props {
  target: PanelTarget
  onClose: () => void
  /** Follow a `[[wiki-link]]` or a `related:` entry — stays in the panel. */
  onOpenNote: (noteId: string) => void
  /** The panel's share of the page, set by the caller's divider drag. */
  style?: React.CSSProperties
}

const parseTags = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean)

/**
 * The note beside the board (Issue #83).
 *
 * Replaces the modal that used to open over the grid. A popup was fine on a
 * board with six cards and unreadable on a board with sixty: the plot showed
 * through it, and the note you were reading sat in the middle of the thing it
 * was about. Here the note takes a draggable share of the page and the board
 * keeps the rest — infinite scroll means losing width costs nothing you cannot
 * scroll back to.
 *
 * Editing happens in place through {@link LiveMarkdownEditor}, so a typo spotted
 * while reading is fixed where it was spotted. The fullscreen editor is still one
 * button away for long stretches of writing.
 */
export function NoteSidePanel({ target, onClose, onOpenNote, style }: Props): JSX.Element {
  const {
    activeBoard,
    getNote,
    saveNote,
    renameNote,
    getEntityBody,
    saveEntityBody,
    openEditor,
    revealCharacter,
    readOnly
  } = useStore()
  const ask = usePrompt()

  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)
  const noteRef = useRef<Note | null>(null)
  const dirty = useRef(false)

  const character =
    target.kind === 'character'
      ? (activeBoard?.characters.find((c) => c.id === target.id) ?? null)
      : null

  // The panel is keyed on its target by the caller, so this runs once per open.
  useEffect(() => {
    let cancelled = false
    if (target.kind === 'note') {
      getNote(target.id)
        .then((n) => {
          if (cancelled) return
          noteRef.current = n
          setTitle(n.title)
          setTags((n.tags ?? []).join(', '))
          setBody(n.body)
          setLoaded(true)
        })
        .catch(() => !cancelled && setLoaded(true))
    } else {
      getEntityBody('character', target.id)
        .then((b) => !cancelled && (setBody(b), setLoaded(true)))
        .catch(() => !cancelled && setLoaded(true))
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced auto-save, the same 900ms the fullscreen editor uses. Skipped
  // entirely when read-only: a doomed save every second would only spam the
  // error toast.
  useEffect(() => {
    if (readOnly || !dirty.current || !loaded) return
    const timer = setTimeout(() => {
      if (target.kind === 'note' && noteRef.current) {
        saveNote({
          ...noteRef.current,
          title: title.trim() || noteRef.current.title,
          tags: parseTags(tags),
          body
        })
      } else if (target.kind === 'character') {
        saveEntityBody('character', target.id, body)
      }
    }, 900)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, tags, body])

  // Escape closes the panel — but only once no block is open for editing, since
  // the editor's own Escape (leave this block) stops the event getting here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const notes = activeBoard?.notes ?? []
  const related = useMemo(
    () =>
      (noteRef.current?.related ?? []).map((r) => {
        const id = r.file.replace(/\.md$/, '')
        return { id, comment: r.comment, exists: notes.some((n) => n.id === id), file: r.file }
      }),
    // Rebuilt when the loaded note changes, which `loaded` and the id track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, target.id, notes]
  )

  const onRename = async (): Promise<void> => {
    if (target.kind !== 'note') return
    const newName = await ask({
      title: 'Rename note file',
      defaultValue: target.id,
      confirmLabel: 'Rename'
    })
    if (newName && newName.trim() && newName.trim() !== target.id) {
      await renameNote(target.id, newName.trim())
      onClose()
    }
  }

  const filePath = target.kind === 'note' ? `${target.id}.md` : `characters/${target.id}.md`

  return (
    <aside className="note-panel" aria-label="Note" style={style}>
      <header className="note-panel-head">
        {target.kind === 'character' ? (
          <h2 className="note-panel-title">
            <span className="swatch" style={{ background: character?.colour }} />{' '}
            {character?.name ?? target.id}
          </h2>
        ) : readOnly ? (
          <h2 className="note-panel-title">{title}</h2>
        ) : (
          <input
            className="note-title-input"
            value={title}
            placeholder="Title"
            aria-label="Note title"
            onChange={(e) => {
              dirty.current = true
              setTitle(e.target.value)
            }}
          />
        )}
        <div className="note-popup-head-actions">
          <button
            className="btn small"
            onClick={() => openEditor(target.kind, target.id)}
            title="Open the fullscreen editor"
          >
            ⤢ Editor
          </button>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
      </header>

      {target.kind === 'note' ? (
        readOnly ? (
          (noteRef.current?.tags ?? []).length > 0 && (
            <div className="tag-row">
              {(noteRef.current?.tags ?? []).map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          )
        ) : (
          <input
            className="note-tags-input"
            value={tags}
            placeholder="tags, comma separated"
            aria-label="Tags"
            onChange={(e) => {
              dirty.current = true
              setTags(e.target.value)
            }}
          />
        )
      ) : (
        <p className="muted small note-panel-hint">
          {/* The note only. Name, colour and dates are the character form's job,
              and repeating them here would make the panel a second, worse one. */}
          Editing the note. Fields live on the{' '}
          <button className="link-btn" onClick={() => revealCharacter(target.id)}>
            Characters tab
          </button>
          .
        </p>
      )}

      <div className="note-panel-body">
        {!loaded ? (
          <p className="muted small">Loading…</p>
        ) : (
          <LiveMarkdownEditor
            value={body}
            readOnly={readOnly}
            onOpenNote={onOpenNote}
            onChange={(next) => {
              dirty.current = true
              setBody(next)
            }}
          />
        )}

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
      </div>

      <footer className="note-panel-foot">
        <span className="muted small autosave-hint">
          {readOnly ? 'Read-only' : 'Auto-saves'} · <code>{filePath}</code>
        </span>
        {target.kind === 'note' && !readOnly && (
          <button className="btn small" onClick={onRename}>
            Rename file
          </button>
        )}
      </footer>
    </aside>
  )
}
