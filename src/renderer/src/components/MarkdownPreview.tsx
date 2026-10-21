import { useCallback, useMemo, type MouseEvent, type RefObject } from 'react'
import { desktopAssetResolver, staticAssetResolver } from '@shared/assets'
import { useStore } from '../store'
import { markBrokenWikiLinks, renderMarkdown } from '../lib/markdown'

interface Props {
  markdown: string
  /** Class on the wrapper; `markdown` is always added. */
  className?: string
  /**
   * Called when a `[[wiki-link]]` resolves to a note on this board (Issue #65).
   * Without it, wiki-links render but do nothing — which is right for a preview
   * with nowhere to navigate to.
   */
  onOpenNote?: (noteId: string) => void
  /**
   * Where to look for a footnote's other half. Defaults to this preview, which is
   * right when it holds the whole note — but the live-preview editor (#83)
   * renders one preview *per block*, so a reference and its definition are in
   * different ones and the search has to cover both.
   */
  scrollRoot?: RefObject<HTMLElement | null>
}

/**
 * The one place rendered markdown reaches the DOM.
 *
 * Centralised because three things have to happen consistently everywhere a
 * note is shown, and doing them at four separate call sites is how they drift:
 *
 *  - **Asset URLs** (#61) are rewritten for the current host — the `zn-asset://`
 *    protocol on the desktop, a plain relative path in a published export.
 *  - **Wiki-links** (#65) are intercepted so they navigate in-app rather than
 *    trying to load a URL, and are marked broken when the note does not exist.
 *  - **Footnote jumps** (#64) scroll within the preview instead of pushing a
 *    hash onto the location, which inside a modal would do nothing useful.
 */
export function MarkdownPreview({
  markdown,
  className,
  onOpenNote,
  scrollRoot
}: Props): JSX.Element {
  const { activeBoard, activeBoardId, readOnly } = useStore()

  const html = useMemo(() => {
    const rendered = renderMarkdown(markdown, {
      boardId: activeBoardId ?? undefined,
      resolveAsset: readOnly ? staticAssetResolver : desktopAssetResolver
    })
    // Mark links whose target is not a note on this board. Done here rather than
    // in the markdown layer because it depends on which board is open.
    return markBrokenWikiLinks(rendered, new Set((activeBoard?.notes ?? []).map((n) => n.id)))
  }, [markdown, activeBoardId, activeBoard?.notes, readOnly])

  const onClick = usePreviewClick(onOpenNote, scrollRoot)

  return (
    <div
      className={className ? `${className} markdown` : 'markdown'}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Click handling for rendered markdown: wiki-links navigate in-app (#65) and
 * footnote links scroll within the preview (#64). Shared with the fullscreen
 * editor's block-by-block preview (#201) so the two cannot drift.
 */
export function usePreviewClick(
  onOpenNote?: (noteId: string) => void,
  scrollRoot?: RefObject<HTMLElement | null>
): (e: MouseEvent<HTMLDivElement>) => void {
  return useCallback(
    (e: MouseEvent<HTMLDivElement>): void => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return

      const noteId = anchor.getAttribute('data-note-id')
      if (noteId !== null) {
        e.preventDefault()
        if (!anchor.classList.contains('broken')) onOpenNote?.(noteId)
        return
      }

      // Footnote reference ↔ definition, both directions.
      const href = anchor.getAttribute('href') ?? ''
      if (href.startsWith('#fn')) {
        e.preventDefault()
        const root = scrollRoot?.current ?? e.currentTarget
        const target = root.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    },
    [onOpenNote, scrollRoot]
  )
}
