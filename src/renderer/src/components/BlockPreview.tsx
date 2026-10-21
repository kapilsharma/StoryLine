import { memo, useEffect, useMemo, useRef } from 'react'
import { desktopAssetResolver, staticAssetResolver } from '@shared/assets'
import { useStore } from '../store'
import { markBrokenWikiLinks, renderFootnotes } from '../lib/markdown'
import { blockIndexAt } from '../lib/mdBlocks'
import { previewParts, renderBlock } from '../lib/blockPreview'
import { usePreviewClick } from './MarkdownPreview'

interface Props {
  markdown: string
  /** Source offset of the caret — its block is highlighted and kept in view. */
  caret: number
  /** Class on the wrapper; `markdown` is always added. */
  className?: string
  onOpenNote?: (noteId: string) => void
}

/** One rendered block. Memoised: a caret move re-renders only the two whose `active` flips. */
const PreviewBlock = memo(function PreviewBlock({
  html,
  active
}: {
  html: string
  active: boolean
}): JSX.Element {
  return (
    <div
      className={active ? 'preview-block active' : 'preview-block'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

/**
 * The fullscreen editor's preview, rendered block by block so the paragraph
 * under the caret can be highlighted and scrolled into view (Issue #201) —
 * like VS Code's markdown preview.
 *
 * Each block's HTML is cached by its source text, so typing re-renders one
 * paragraph rather than the whole draft. Asset URLs, wiki-links and footnote
 * jumps behave as in {@link MarkdownPreview}; see `lib/blockPreview` for how
 * footnotes and reference links still work across blocks.
 */
export function BlockPreview({ markdown, caret, className, onOpenNote }: Props): JSX.Element {
  const { activeBoard, activeBoardId, readOnly } = useStore()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const onClick = usePreviewClick(onOpenNote)

  const parts = useMemo(() => previewParts(markdown), [markdown])
  const known = useMemo(
    () => new Set((activeBoard?.notes ?? []).map((n) => n.id)),
    [activeBoard?.notes]
  )
  const options = useMemo(
    () => ({
      boardId: activeBoardId ?? undefined,
      resolveAsset: readOnly ? staticAssetResolver : desktopAssetResolver
    }),
    [activeBoardId, readOnly]
  )
  // Rendered HTML by block text. A fresh cache whenever anything other than the
  // text could change a block's output.
  const cache = useMemo(() => new Map<string, string>(), [options, known, parts.linkDefs])

  const rendered = useMemo(() => {
    const seen = new Map<string, number>()
    const out = parts.blocks.map((block) => {
      let html = cache.get(block.text)
      if (html === undefined) {
        html = markBrokenWikiLinks(renderBlock(block.text, parts.linkDefs, options), known)
        cache.set(block.text, html)
      }
      // Keyed by text (plus which repeat it is), so inserting a paragraph mounts
      // one element instead of shifting every later block's content.
      const n = seen.get(block.text) ?? 0
      seen.set(block.text, n + 1)
      return { key: `${n}:${block.text}`, html }
    })
    // Drop the text of blocks that no longer exist — every edit leaves one behind.
    if (cache.size > 2 * parts.blocks.length + 16) {
      const live = new Set(parts.blocks.map((b) => b.text))
      for (const text of cache.keys()) if (!live.has(text)) cache.delete(text)
    }
    return out
  }, [parts, cache, options, known])

  const footnotes = useMemo(
    () => markBrokenWikiLinks(renderFootnotes(parts.footnotes), known),
    [parts.footnotes, known]
  )

  // On a blank line between paragraphs this is the one before it, so the
  // highlight does not flicker off while pressing Enter.
  const active = blockIndexAt(parts.blocks, caret)

  // Only when the caret reaches a *different* block: typing within one, or the
  // author scrolling the preview by hand, never makes it jump.
  useEffect(() => {
    if (active < 0) return
    const el = rootRef.current?.children[active]
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  return (
    <div
      ref={rootRef}
      className={className ? `${className} markdown` : 'markdown'}
      onClick={onClick}
    >
      {rendered.map(({ key, html }, i) => (
        <PreviewBlock key={key} html={html} active={i === active} />
      ))}
      {footnotes && <div dangerouslySetInnerHTML={{ __html: footnotes }} />}
    </div>
  )
}
