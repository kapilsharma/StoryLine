import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { MarkdownPreview } from './MarkdownPreview'
import { useAssetInsert } from './useAssetInsert'
import {
  splitBlocks,
  sourceOffsetForVisible,
  type MdBlock
} from '../lib/mdBlocks'
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

interface Props {
  /** The whole markdown source. */
  value: string
  /** Called with the whole source on every change — the caller owns saving. */
  onChange: (next: string) => void
  /** No editing at all: a published export, or a project opened read-only. */
  readOnly?: boolean
  /** Where a `[[wiki-link]]` should navigate to. */
  onOpenNote?: (noteId: string) => void
  /** Shown in place of the text when the note is empty. */
  placeholder?: string
}

/**
 * The region of the source currently open as text.
 *
 * `value.slice(start, end) === text` is the invariant the whole component rests
 * on: everything outside `[start, end)` is rendered, everything inside is the
 * textarea, and a change replaces exactly that slice. Because the blank lines
 * between blocks belong to no block, the blocks either side keep their offsets
 * while this one is edited — no matter how much text is typed into it.
 */
interface EditRegion {
  start: number
  end: number
  text: string
  /**
   * Separator to insert before the text on the next change, then forgotten. A
   * block appended at the end needs a blank line before it, but only once there
   * is something to append — clicking below the note and typing nothing must not
   * rewrite the file.
   */
  gap: string
}

/**
 * Obsidian-style live preview (Issue #83): one surface where the note is
 * rendered and the block you click becomes its own source, in place.
 *
 * The alternative — the fullscreen editor's source-beside-preview split — is
 * still there for long writing sessions. This is for the board's side panel,
 * where the whole point is that reading and fixing a line are the same gesture.
 *
 * **Why blocks rather than a character-level editor.** Editing raw markdown for
 * the block under the caret and rendering everything else is exactly what
 * Obsidian does, and it means the rendering path is the same `renderMarkdown`
 * the read-only preview uses — no second markdown implementation to keep in
 * step. The cut points come from `lib/mdBlocks`, which is pure and tested.
 */
export function LiveMarkdownEditor({
  value,
  onChange,
  readOnly = false,
  onOpenNote,
  placeholder = 'Click here to start writing…'
}: Props): JSX.Element {
  const [region, setRegion] = useState<EditRegion | null>(null)
  // Caret offset inside the open block, mirrored into state only so the heading
  // dropdown can show the level of the line you are on.
  const [caret, setCaret] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // The whole rendered note, so a footnote reference can find its definition in
  // a *different* block's preview (#64 still has to work here).
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // Where to put the caret when a block opens — set before the state change that
  // mounts the textarea, applied by the focus effect below.
  const pendingCaret = useRef(0)
  // Bumped once per *opening*, and nothing else. The focus effect keys on this
  // rather than on the region: an appended block's offsets shift when its blank
  // line is inserted, and re-running there would throw the caret back to the
  // start of the line mid-word.
  const [opened, setOpened] = useState(0)
  const assets = useAssetInsert()

  const blocks = useMemo(() => splitBlocks(value), [value])
  const editing = region !== null && !readOnly
  const before = editing ? blocks.filter((b) => b.end <= region.start) : blocks
  const after = editing ? blocks.filter((b) => b.start >= region.end) : []

  /** Replace the open region's text, keeping the invariant intact. */
  const write = (text: string): void => {
    if (!region) return
    onChange(value.slice(0, region.start) + region.gap + text + value.slice(region.end))
    const start = region.start + region.gap.length
    setRegion({ start, end: start + text.length, text, gap: '' })
  }

  const openBlock = (block: MdBlock, at: number): void => {
    if (readOnly) return
    pendingCaret.current = Math.max(0, Math.min(block.text.length, at))
    setRegion({ start: block.start, end: block.end, text: block.text, gap: '' })
    setOpened((n) => n + 1)
  }

  /** Open an empty block at the end — clicking the space under the note. */
  const openAppend = (): void => {
    if (readOnly) return
    pendingCaret.current = 0
    setOpened((n) => n + 1)
    // A blank note is replaced outright, so stray whitespace does not survive as
    // an invisible first paragraph.
    if (value.trim() === '') {
      setRegion({ start: 0, end: value.length, text: '', gap: '' })
      return
    }
    const gap = /\n[ \t]*\n[ \t]*$/.test(value) ? '' : value.endsWith('\n') ? '\n' : '\n\n'
    setRegion({ start: value.length, end: value.length, text: '', gap })
  }

  const close = (): void => setRegion(null)

  // Focus the block that just opened and drop the caret where it was clicked.
  useEffect(() => {
    if (!region) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const at = Math.min(pendingCaret.current, el.value.length)
    el.setSelectionRange(at, at)
    setCaret(at)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])

  // Grow the textarea to its content, so the block occupies the same space as
  // the paragraph it replaced instead of scrolling inside a fixed box.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [region?.text])

  /** Run a pure `mdFormat` edit over the textarea's selection. */
  const applyFormat = (edit: (sel: MdSelection) => MdSelection): void => {
    const el = textareaRef.current
    if (!el || !region) return
    const next = edit({ text: region.text, start: el.selectionStart, end: el.selectionEnd })
    write(next.text)
    setCaret(next.start)
    requestAnimationFrame(() => {
      const live = textareaRef.current
      if (!live) return
      live.focus()
      live.setSelectionRange(next.start, next.end)
    })
  }

  /** Move to the block above or below, so the panel behaves like one editor. */
  const step = (direction: -1 | 1): void => {
    if (direction < 0) {
      const prev = before[before.length - 1]
      if (prev) openBlock(prev, prev.text.length)
      return
    }
    const next = after[0]
    next ? openBlock(next, 0) : openAppend()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length

    // Escape leaves the block, not the panel — hence the stopPropagation. A
    // second Escape, with nothing open, is the panel's to handle.
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'ArrowUp' && atStart) {
      e.preventDefault()
      step(-1)
      return
    }
    if (e.key === 'ArrowDown' && atEnd) {
      e.preventDefault()
      step(1)
    }
  }

  /**
   * Where in the block's source the click landed.
   *
   * Chromium collapses the selection at the click point before the click
   * handler runs, so the rendered offset is there to be read; mapping it back to
   * the source is `sourceOffsetForVisible`'s approximate job. When there is no
   * usable selection (a click on the block's padding, or jsdom) the caret goes
   * to the end of the block, which is where someone adding to a paragraph wants
   * it anyway.
   */
  const caretForClick = (root: HTMLElement, source: string): number => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return source.length
    const visible = visibleOffsetIn(root, sel.anchorNode, sel.anchorOffset)
    return visible === null ? source.length : sourceOffsetForVisible(source, visible)
  }

  const onBlockClick = (e: MouseEvent<HTMLDivElement>, block: MdBlock): void => {
    if (readOnly) return
    // Links navigate (wiki-links, footnote jumps, images) — they are not an
    // invitation to edit.
    if ((e.target as HTMLElement).closest('a')) return
    // A drag that selected text was a copy, not a click into the source.
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    openBlock(block, caretForClick(e.currentTarget, block.text))
  }

  const renderBlock = (block: MdBlock): JSX.Element => (
    <div
      key={block.start}
      className={`live-md-block${readOnly ? '' : ' editable'}`}
      onClick={readOnly ? undefined : (e) => onBlockClick(e, block)}
    >
      <MarkdownPreview markdown={block.text} onOpenNote={onOpenNote} scrollRoot={bodyRef} />
    </div>
  )

  const insertMarkdown = (markdown: string): void => applyFormat((sel) => insertAt(sel, markdown))

  return (
    <div className="live-md">
      {!readOnly && (
        <div className="editor-tools live-md-tools">
          {/* Disabled until a block is open: these act on a selection, and there
              is no selection to act on while everything is rendered. */}
          <select
            className="editor-heading-select"
            aria-label="Heading level"
            disabled={!editing}
            value={String(editing ? headingLevelAt(region.text, caret) : 0)}
            onChange={(e) => {
              const level = Number(e.target.value) as HeadingLevel
              applyFormat((sel) => setHeading(sel, level))
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
              disabled={!editing}
              // Keep the caret: a button that takes focus would leave the format
              // with no selection to apply itself to.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFormat((sel) => toggleInline(sel, format))}
            >
              {label}
            </button>
          ))}
          <button
            className="btn small"
            disabled={!editing}
            onMouseDown={(e) => e.preventDefault()}
            onClick={async () => {
              const markdown = await assets.pick()
              if (markdown) insertMarkdown(markdown)
            }}
            title="Add an image or PDF — it is copied into this board's assets folder"
          >
            + Image
          </button>
          <span className="muted small live-md-hint">
            {editing ? 'Esc to render this block' : 'Click any line to edit it'}
          </span>
        </div>
      )}

      {assets.error && <p className="small error">{assets.error}</p>}

      <div className="live-md-body" ref={bodyRef}>
        {before.map(renderBlock)}

        {editing && (
          <textarea
            ref={textareaRef}
            className="live-md-source"
            value={region.text}
            aria-label="Block source"
            onChange={(e) => {
              write(e.target.value)
              setCaret(e.target.selectionStart)
            }}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files)
              if (files.length === 0) return
              e.preventDefault()
              void assets.importFiles(files, insertMarkdown)
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault()
            }}
            onDrop={(e) => {
              if (e.dataTransfer.files.length === 0) return
              e.preventDefault()
              void assets.importFiles(e.dataTransfer.files, insertMarkdown)
            }}
          />
        )}

        {after.map(renderBlock)}

        {blocks.length === 0 && !editing && (
          <p className="muted live-md-empty" onClick={openAppend}>
            {readOnly ? 'No note yet.' : placeholder}
          </p>
        )}
      </div>

      {/* The room below the last block: clicking it starts a new one, the way
          clicking under the text in any editor does. */}
      {!readOnly && blocks.length > 0 && (
        <div className="live-md-tail" onClick={openAppend} aria-hidden="true" />
      )}
    </div>
  )
}

/**
 * How many rendered characters precede `offset` in `node`, counted within
 * `root`. Null when the selection is not anchored in a text node under `root` —
 * there is nothing useful to map in that case.
 */
function visibleOffsetIn(root: HTMLElement, node: Node, offset: number): number | null {
  if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    if (current === node) return total + offset
    total += (current.textContent ?? '').length
    current = walker.nextNode()
  }
  return null
}
