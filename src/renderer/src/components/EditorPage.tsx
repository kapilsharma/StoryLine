import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import type { EntityBodyKind } from '@shared/ipc'
import { useStore, type EditorTarget } from '../store'
import { renderMarkdown } from '../lib/markdown'

const parseTags = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean)

/**
 * Dedicated fullscreen markdown editor (Feature 12). Edits a note (title, tags,
 * body) or a character/timeline body, with a live preview. Preview side follows
 * the `previewPosition` setting. Auto-saves; Close returns to the prior view.
 */
export function EditorPage({ target }: { target: EditorTarget }): JSX.Element {
  const { kind, id } = target
  const { closeEditor, activeBoard, config, getNote, saveNote, getEntityBody, saveEntityBody } = useStore()
  const previewOnLeft = (config?.settings.previewPosition ?? 'left') === 'left'

  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)
  const noteRef = useRef<Note | null>(null)
  const dirty = useRef(false)

  // Load the content for this target (component is keyed on the target, so this
  // runs once per open).
  useEffect(() => {
    let cancelled = false
    if (kind === 'note') {
      getNote(id)
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
      getEntityBody(kind, id)
        .then((b) => !cancelled && (setBody(b), setLoaded(true)))
        .catch(() => !cancelled && setLoaded(true))
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced auto-save.
  useEffect(() => {
    if (!dirty.current || !loaded) return
    const timer = setTimeout(() => {
      if (kind === 'note' && noteRef.current) {
        saveNote({ ...noteRef.current, title: title.trim() || noteRef.current.title, tags: parseTags(tags), body })
      } else if (kind !== 'note') {
        saveEntityBody(kind as EntityBodyKind, id, body)
      }
    }, 900)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, tags, body])

  const html = useMemo(() => renderMarkdown(body), [body])

  const displayName =
    kind === 'note'
      ? title
      : kind === 'character'
        ? (activeBoard?.characters.find((c) => c.id === id)?.name ?? id)
        : (activeBoard?.timeline.find((t) => t.id === id)?.label ?? id)

  const editorPane = (
    <div className="editor-pane">
      <textarea
        className="editor-textarea"
        value={body}
        onChange={(e) => {
          dirty.current = true
          setBody(e.target.value)
        }}
        placeholder={loaded ? 'Write in Markdown…' : 'Loading…'}
        autoFocus
      />
    </div>
  )
  const previewPane = (
    <div className="editor-pane">
      <div className="editor-preview markdown" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )

  return (
    <div className="editor-page">
      <header className="editor-page-head">
        <button className="btn" onClick={closeEditor}>
          ‹ Close
        </button>
        {kind === 'note' ? (
          <input
            className="editor-title-input"
            value={title}
            placeholder="Title"
            onChange={(e) => {
              dirty.current = true
              setTitle(e.target.value)
            }}
          />
        ) : (
          <h1 className="editor-title-static">{displayName}</h1>
        )}
        <span className="muted small autosave-hint">Auto-saves</span>
      </header>

      {kind === 'note' ? (
        <input
          className="editor-tags-input"
          value={tags}
          placeholder="tags, comma separated"
          onChange={(e) => {
            dirty.current = true
            setTags(e.target.value)
          }}
        />
      ) : (
        <p className="muted small editor-frontmatter-hint">
          Editing the notes/research body. Fields (name, colour, etc.) are edited in the{' '}
          {kind === 'character' ? 'Characters' : 'Timeline'} tab.
        </p>
      )}

      <div className="editor-split">
        {previewOnLeft ? (
          <>
            {previewPane}
            {editorPane}
          </>
        ) : (
          <>
            {editorPane}
            {previewPane}
          </>
        )}
      </div>
    </div>
  )
}
