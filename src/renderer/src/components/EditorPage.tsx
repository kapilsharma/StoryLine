import { useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import type { EntityBodyKind } from '@shared/ipc'
import { isAllowedAsset, type AssetRef } from '@shared/assets'
import { useStore, type EditorTarget } from '../store'
import { MarkdownPreview } from './MarkdownPreview'

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
    readOnly,
    importAsset,
    pickAsset
  } = useStore()
  const previewOnLeft = (config?.settings.previewPosition ?? 'left') === 'left'

  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)
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

  /**
   * Put an imported asset into the text at the caret (Issue #61).
   *
   * A PDF gets a link rather than an image embed, because an `<img>` pointing at
   * a PDF renders as a broken image in every browser.
   */
  const insertAsset = (ref: AssetRef): void => {
    const isImage = !ref.file.toLowerCase().endsWith('.pdf')
    const snippet = `${isImage ? '!' : ''}[${ref.file}](${ref.markdownPath})`
    const el = textareaRef.current
    const at = el ? el.selectionStart : body.length
    const next = body.slice(0, at) + snippet + body.slice(el ? el.selectionEnd : body.length)
    dirty.current = true
    setBody(next)
    // Put the caret after what was just inserted, once React has re-rendered.
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.selectionStart = el.selectionEnd = at + snippet.length
    })
  }

  /** Import every acceptable file out of a paste or drop. */
  const importFiles = async (files: FileList | File[]): Promise<void> => {
    for (const file of Array.from(files)) {
      if (!isAllowedAsset(file.name)) continue
      try {
        const buffer = await file.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buffer)
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        insertAsset(await importAsset({ name: file.name, data: btoa(binary) }))
      } catch (err) {
        setAssetError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const editorPane = (
    <div className="editor-pane">
      {!readOnly && (
        <div className="editor-tools">
          <button
            className="btn small"
            onClick={async () => {
              try {
                const ref = await pickAsset()
                if (ref) insertAsset(ref)
              } catch (err) {
                setAssetError(err instanceof Error ? err.message : String(err))
              }
            }}
            title="Add an image or PDF — it is copied into this board's assets folder"
          >
            + Image
          </button>
          <span className="muted small">…or paste / drop a file into the text.</span>
        </div>
      )}
      {assetError && <p className="small error">{assetError}</p>}
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={body}
        onChange={(e) => {
          dirty.current = true
          setBody(e.target.value)
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files)
          if (files.length === 0 || readOnly) return
          e.preventDefault()
          void importFiles(files)
        }}
        onDragOver={(e) => {
          if (!readOnly && e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (readOnly || e.dataTransfer.files.length === 0) return
          e.preventDefault()
          void importFiles(e.dataTransfer.files)
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
