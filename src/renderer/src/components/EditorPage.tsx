import { useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import type { EntityBodyKind } from '@shared/ipc'
import { useStore, type EditorTarget } from '../store'
import { MarkdownPreview } from './MarkdownPreview'
import { useAssetInsert } from './useAssetInsert'
import {
  HEADING_LEVELS,
  INLINE_TOOLS,
  headingLevelAt,
  insertAt,
  setHeading,
  toggleInline,
  type HeadingLevel,
  type MdSelection
} from '../lib/mdFormat'

const parseTags = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean)

/**
 * Dedicated fullscreen markdown editor (Feature 12). Edits a note (title, tags,
 * body) or a character/timeline body, with a live preview. Preview side follows
 * the `previewPosition` setting. Auto-saves; Close returns to the prior view.
 */
export function EditorPage({ target }: { target: EditorTarget }): JSX.Element {
  const { kind, id } = target
  const {
    closeEditor,
    activeBoard,
    config,
    getNote,
    saveNote,
    getEntityBody,
    saveEntityBody,
    readOnly
  } = useStore()
  const previewOnLeft = (config?.settings.previewPosition ?? 'left') === 'left'
  const assets = useAssetInsert()

  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)
  // Caret position, mirrored into state only so the heading dropdown can show
  // the level of the line you are on. The textarea itself stays uncontrolled
  // where the selection is concerned.
  const [caret, setCaret] = useState(0)
  const noteRef = useRef<Note | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
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

  // Debounced auto-save. Skipped entirely when read-only: you can still type and
  // watch the preview, but firing a doomed save every second would just spam the
  // error toast.
  useEffect(() => {
    if (readOnly || !dirty.current || !loaded) return
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


  const displayName =
    kind === 'note'
      ? title
      : kind === 'character'
        ? (activeBoard?.characters.find((c) => c.id === id)?.name ?? id)
        : (activeBoard?.timeline.find((t) => t.id === id)?.label ?? id)

  /** Where the textarea's selection is right now, falling back to the end. */
  const selection = (): MdSelection => {
    const el = textareaRef.current
    return {
      text: body,
      start: el ? el.selectionStart : body.length,
      end: el ? el.selectionEnd : body.length
    }
  }

  /**
   * Run one of the pure edits from `lib/mdFormat` over the current selection and
   * write the result back, restoring focus and the selection the edit asks for
   * once React has re-rendered — otherwise clicking a toolbar button would leave
   * the caret at the end of the note.
   */
  const applyEdit = (edit: (sel: MdSelection) => MdSelection): void => {
    const next = edit(selection())
    dirty.current = true
    setBody(next.text)
    setCaret(next.start)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.start, next.end)
    })
  }

  /** Put markdown for an imported asset into the text at the caret (Issue #61). */
  const insertMarkdown = (markdown: string): void => applyEdit((sel) => insertAt(sel, markdown))

  const editorPane = (
    <div className="editor-pane">
      {!readOnly && (
        <div className="editor-tools">
          {/* Formatting shortcuts for people who don't write Markdown by hand
              (Issue #72). Underline is deliberately absent — Markdown has none;
              highlight is the equivalent emphasis the preview supports. */}
          <select
            className="editor-heading-select"
            aria-label="Heading level"
            value={String(headingLevelAt(body, caret))}
            onChange={(e) => {
              const level = Number(e.target.value) as HeadingLevel
              applyEdit((sel) => setHeading(sel, level))
            }}
          >
            {HEADING_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level === 0 ? 'Normal text' : `Heading ${level}`}
              </option>
            ))}
          </select>
          {INLINE_TOOLS.map(({ format, label, title }) => (
            <button
              key={format}
              className={`btn small md-tool md-tool-${format}`}
              title={title}
              aria-label={title.split('  ')[0]}
              onClick={() => applyEdit((sel) => toggleInline(sel, format))}
            >
              {label}
            </button>
          ))}
          <button
            className="btn small"
            onClick={async () => {
              const markdown = await assets.pick()
              if (markdown) insertMarkdown(markdown)
            }}
            title="Add an image or PDF — it is copied into this board's assets folder"
          >
            + Image
          </button>
          <span className="muted small">…or paste / drop a file into the text.</span>
        </div>
      )}
      {assets.error && <p className="small error">{assets.error}</p>}
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={body}
        onChange={(e) => {
          dirty.current = true
          setBody(e.target.value)
          setCaret(e.target.selectionStart)
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files)
          if (files.length === 0 || readOnly) return
          e.preventDefault()
          void assets.importFiles(files, insertMarkdown)
        }}
        onDragOver={(e) => {
          if (!readOnly && e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (readOnly || e.dataTransfer.files.length === 0) return
          e.preventDefault()
          void assets.importFiles(e.dataTransfer.files, insertMarkdown)
        }}
        placeholder={loaded ? 'Write in Markdown…' : 'Loading…'}
        autoFocus
      />
    </div>
  )
  const previewPane = (
    <div className="editor-pane">
      <MarkdownPreview markdown={body} className="editor-preview" />
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
        <span className="muted small autosave-hint">
          {readOnly ? 'Read-only — changes are not saved' : 'Auto-saves'}
        </span>
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
