import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Board, Card, Character, ColumnGroup } from '@shared/types'
import {
  ROW_HEADER_W_DEFAULT,
  ROW_HEADER_W_MAX_FRACTION,
  ROW_HEADER_W_MIN
} from '@shared/types'
import type { BoardData } from '@shared/ipc'
import { cardStatuses, findCardStatus } from '@shared/cardStatus'
import { useStore } from '../../store'
import { usePrompt } from '../PromptModal'
import { useBoardUi } from './BoardUiContext'
import { CardHoverTipHost, showCardHoverTip, hideCardHoverTip } from './CardHoverTip'
import {
  buildBoardLayout,
  columnWindow,
  markerKey,
  noteForCard,
  orderedColumnIds,
  removeBoardMember,
  reorderRowBlocks,
  reorderRowMember,
  rowWindow,
  withFilters
} from './grid-utils'
import type { PlacedCard } from './grid-utils'

const MIME_MEMBER = 'application/x-znstoryline-row-member'
const MIME_BLOCK = 'application/x-znstoryline-row-block'

const BASE_COL_W = 160
// Compact default row height — fits ~2 lines of card text. Rows with an
// expanded card grow to fit (see the per-row track heights below).
const COMPACT_ROW_H = 66
const GROUPHEAD_LINE_H = 30
const GROUP_H = 26
const COLHEAD_H = 44
/** How long Ctrl+scroll must pause before the new zoom is written to disk (#129). */
const ZOOM_SAVE_DELAY = 150
/** Vertical gap between stacked cards, and above/below the stack (#66). */
const STACK_GAP = 6
/** Columns rendered beyond each edge of the viewport, so a scroll shows no gap (#150). */
const OVERSCAN_COLS = 6
/** Row lines rendered beyond each edge of the viewport (#157). */
const OVERSCAN_ROWS = 4

/**
 * Coalesce rapid pointer-move updates to at most one per animation frame (#152).
 *
 * A card resize or header drag fires `mousemove` many times a second; each one
 * sets state that re-runs the layout and re-renders the grid. Throttling to the
 * frame means the preview updates at most ~60fps and never queues more work than
 * a frame can do. The latest event always wins. On pointer-up call `flush` to
 * apply that last event synchronously (so the end state is exact, not a frame
 * stale, and doesn't depend on the pointer-up coordinates), or `cancel` to drop
 * a pending frame without applying it.
 */
function rafThrottle<E>(fn: (e: E) => void): {
  run: (e: E) => void
  flush: () => void
  cancel: () => void
} {
  let raf: number | null = null
  let last: E | null = null
  let pending = false
  const stop = (): void => {
    if (raf != null) {
      cancelAnimationFrame(raf)
      raf = null
    }
  }
  return {
    run(e: E): void {
      last = e
      pending = true
      if (raf != null) return
      raf = requestAnimationFrame(() => {
        raf = null
        if (pending) {
          pending = false
          fn(last as E)
        }
      })
    },
    flush(): void {
      stop()
      if (pending) {
        pending = false
        fn(last as E)
      }
    },
    cancel(): void {
      stop()
      pending = false
      last = null
    }
  }
}

/** Stable empty list, so a board without groups doesn't re-run the layout memo every render. */
const NO_GROUPS: ColumnGroup[] = []

interface ContextMenu {
  cardId: string
  x: number
  y: number
}

/** Right-click on a row header. Hiding and removing are different things. */
interface RowMenu {
  charId: string
  name: string
  x: number
  y: number
}

interface Preview {
  cardId: string
  colStart: string
  colEnd: string
}

/**
 * A character's name in the fixed first column (#80).
 *
 * The name wraps to two lines by default and the expand button opens it out in
 * full. Whether it *needs* expanding is measured rather than guessed from the
 * length: the column is resizable and the name shares the line with a swatch
 * and a 📝, so no character count predicts the wrap.
 */
function RowHeadName({
  char,
  expanded,
  headerW,
  zoom,
  onOpenNote,
  onToggle
}: {
  char: Character
  expanded: boolean
  headerW: number
  zoom: number
  onOpenNote: () => void
  onToggle: () => void
}): JSX.Element {
  const nameRef = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)

  useEffect(() => {
    // Only measure while clamped — expanded, the name fits by definition, and
    // re-measuring would drop the button needed to collapse it again.
    if (expanded) return
    const el = nameRef.current
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [expanded, char.name, char.hasNote, headerW, zoom])

  const name = (
    <span className="row-name-text" ref={nameRef}>
      {char.name}
    </span>
  )

  return (
    <>
      {/* Only a character who has a note is clickable (issue #41), and the 📝
          marks which those are — so the board never offers a click that opens
          nothing. */}
      {char.hasNote ? (
        <button className="row-name row-note" title={`Read ${char.name}’s note`} onClick={onOpenNote}>
          {name}
          <span className="row-note-icon" aria-hidden="true">
            📝
          </span>
        </button>
      ) : (
        <span className="row-name">{name}</span>
      )}
      {(clipped || expanded) && (
        <button
          className="row-expand"
          title={expanded ? 'Collapse name' : 'Show full name'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          {expanded ? '⤡' : '⤢'}
        </button>
      )}
    </>
  )
}

/**
 * One plotted card. Memoised (#133) so a re-render of the grid — a hover, a
 * collapse, another card expanding, a menu opening — doesn't re-diff every card
 * on the board. All props are either the stable `PlacedCard` from the layout
 * memo, primitives, or callbacks the grid keeps stable with `useCallback`, so a
 * card re-renders only when something about *that* card changed.
 */
interface BoardCardProps {
  pc: PlacedCard
  gridRow: number
  cardH: number
  lineDepth: number
  masked: boolean
  isExp: boolean
  expandable: boolean
  hoverText?: string
  statusIcon?: string
  statusLabel?: string
  noteId?: string
  title: string
  hasBody: boolean
  hasLinks: boolean
  onOpenNote: (noteId: string) => void
  onToggleReveal: (cardId: string) => void
  onToggleExpand: (cardId: string) => void
  onBeginResize: (e: React.PointerEvent, card: Card, edge: 'start' | 'end') => void
  onCardDragStart: (e: React.DragEvent, card: Card) => void
  onOpenMenu: (e: React.MouseEvent, cardId: string) => void
}

const BoardCard = memo(function BoardCard({
  pc,
  gridRow,
  cardH,
  lineDepth,
  masked,
  isExp,
  expandable,
  hoverText,
  statusIcon,
  statusLabel,
  noteId,
  title,
  hasBody,
  hasLinks,
  onOpenNote,
  onToggleReveal,
  onToggleExpand,
  onBeginResize,
  onCardDragStart,
  onOpenMenu
}: BoardCardProps): JSX.Element {
  const card = pc.card
  return (
    <div
      className={`board-card${isExp ? ' expanded' : ''}${masked ? ' masked' : ''}`}
      draggable
      onDragStart={(e) => {
        hideCardHoverTip()
        onCardDragStart(e, card)
      }}
      onMouseEnter={hoverText ? (e) => showCardHoverTip(e.currentTarget, hoverText) : undefined}
      onMouseLeave={hoverText ? hideCardHoverTip : undefined}
      onPointerDown={hoverText ? hideCardHoverTip : undefined}
      style={{
        gridColumn: `${pc.startSlot + 2} / ${pc.endSlot + 3}`,
        gridRow,
        height: isExp ? 'auto' : `${cardH}px`,
        ['--card-border' as string]: pc.colour,
        // Stacked rows lay their cards out from the top so the levels line up; a
        // lone card keeps centring (#66).
        ...(lineDepth > 1
          ? {
              alignSelf: 'start',
              marginTop: `${STACK_GAP + pc.stackIndex * (cardH + STACK_GAP)}px`
            }
          : {})
      }}
      onClick={() => {
        // In revision mode the first click is the reveal — opening the note would
        // give the answer away (#67).
        if (masked) {
          onToggleReveal(card.id)
          return
        }
        if (noteId) onOpenNote(noteId)
      }}
      onContextMenu={(e) => onOpenMenu(e, card.id)}
    >
      <span className="resize-handle left" onPointerDown={(e) => onBeginResize(e, card, 'start')} />
      <div className="card-content">
        <div className="card-title">
          {masked ? (
            <span className="card-masked" aria-label="Hidden — click to reveal">
              • • •
            </span>
          ) : (
            <>
              {/* Where the scene stands, leftmost so a glance down a row reads as
                  a progress bar (#108). */}
              {statusIcon && (
                <span className="card-status-icon" title={statusLabel}>
                  {statusIcon}{' '}
                </span>
              )}
              {/* A card whose note has a body opens onto more than its title, so
                  it says so up front (#46). */}
              {hasBody && (
                <span className="card-note-icon" title="Has note details">
                  📝{' '}
                </span>
              )}
              {title}
              {hasLinks && <span className="link-icon"> 🔗</span>}
            </>
          )}
        </div>
      </div>
      {/* Says "rest the mouse here" (#116) — in the corner, so it sits in one
          place on every card and a glance down a row finds the ones with a hint. */}
      {hoverText && (
        <span className="card-hover-icon" aria-label="Has hover text">
          ℹ️
        </span>
      )}
      {expandable && (
        <button
          className="card-expand"
          title={isExp ? 'Collapse card' : 'Expand card'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand(card.id)
          }}
        >
          {isExp ? '⤡' : '⤢'}
        </button>
      )}
      <span className="resize-handle right" onPointerDown={(e) => onBeginResize(e, card, 'end')} />
    </div>
  )
})

export function BoardGrid({ data }: { data: BoardData }): JSX.Element {
  const { snapshot, config, createCard, updateCard, deleteCard, saveBoard } = useStore()
  const statuses = snapshot ? cardStatuses(snapshot.project) : []
  const ask = usePrompt()
  const board = data.board
  const characters = data.characters
  const timeline = data.timeline
  const notes = data.notes
  const colGroups = data.colGroups ?? NO_GROUPS

  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  // Live width while the header column is being dragged; null when it isn't.
  const [headerDrag, setHeaderDrag] = useState<number | null>(null)
  const {
    isExpanded,
    toggle: toggleExpand,
    registerCards,
    isRowExpanded,
    toggleRow,
    openPanel,
    rowFilter,
    colFilter,
    revising,
    isRevealed,
    toggleRevealed,
    revealMany
  } = useBoardUi()
  // Both clicks that used to open a modal now open the side panel beside the
  // board (#83); `BoardsView` is what renders it. `openNote` is kept stable so
  // it can be a prop of the memoised card (#133).
  const openNote = useCallback((id: string): void => openPanel({ kind: 'note', id }), [openPanel])
  const openCharacterNote = (id: string): void => openPanel({ kind: 'character', id })
  const scrollRef = useRef<HTMLDivElement>(null)

  // Deferred zoom write (#129); see the zoom block below.
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The card hover tip (#111) now lives in an external store (CardHoverTip), so
  // showing or hiding a tip re-renders only the tip host, not the whole grid and
  // its thousands of cells (#133). Clear anything pending/shown on unmount.
  useEffect(
    () => () => {
      hideCardHoverTip()
      if (zoomTimer.current) clearTimeout(zoomTimer.current)
    },
    []
  )

  // Zoom writes are debounced (#129): a Ctrl+scroll gesture fires many wheel
  // events, and each saveBoard writes board.json and reloads the project. The new
  // zoom is shown at once from local state, and a single save is flushed once
  // scrolling pauses. `pendingZoom` is cleared by an effect only after the saved
  // board catches up, so the view never flickers back to the old value in between.
  const [pendingZoom, setPendingZoom] = useState<number | null>(null)
  const zoom = (pendingZoom ?? board.zoom) || 1
  const lastBoardId = useRef(board.id)
  useEffect(() => {
    // Switching boards (this component isn't remounted) must drop a pending zoom,
    // or the new board would render at the old board's in-flight value.
    if (lastBoardId.current !== board.id) {
      lastBoardId.current = board.id
      setPendingZoom(null)
    } else if (pendingZoom != null && board.zoom === pendingZoom) {
      // Saved board has caught up — hand the view back to the persisted value.
      setPendingZoom(null)
    }
  }, [board.id, board.zoom, pendingZoom])

  // The header column keeps the width the user dragged (#80). Unlike the data
  // columns it is deliberately not scaled by zoom: zoom is about how much of the
  // plot fits on screen, and the names have to stay readable either way.
  const headerW = headerDrag ?? board.rowHeaderWidth ?? ROW_HEADER_W_DEFAULT
  const colW = BASE_COL_W * zoom
  const rowH = COMPACT_ROW_H * zoom
  const cardH = Math.round(rowH - 16)

  // Tell the toolbar which cards exist on the active board (for expand-all).
  const cardIdsKey = board.cards.map((c) => c.id).join(',')
  useEffect(() => {
    registerCards(board.cards.map((c) => c.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIdsKey])
  // Card text scales with zoom so the amount of visible text is consistent
  // across zoom levels; base size is the user's setting.
  const cardFont = (config?.settings.cardFontSize ?? 13) * zoom

  // Apply the transient filters (#140), then any live resize preview, before
  // computing layout. Filtering goes first so the preview still edits the one
  // card by id; both just return the board unchanged when there's nothing to do.
  const effectiveBoard = useMemo<Board>(() => {
    const filtered = withFilters(board, rowFilter, colFilter)
    if (!preview) return filtered
    return {
      ...filtered,
      cards: filtered.cards.map((c) =>
        c.id === preview.cardId ? { ...c, colStart: preview.colStart, colEnd: preview.colEnd } : c
      )
    }
  }, [board, preview, rowFilter, colFilter])

  const layout = useMemo(
    () => buildBoardLayout(effectiveBoard, characters, timeline, notes, colGroups),
    [effectiveBoard, characters, timeline, notes, colGroups]
  )
  const { cols, rows, fullCards, markers, stackDepth } = layout
  const fullOrder = useMemo(() => orderedColumnIds(timeline, colGroups), [timeline, colGroups])

  // unit id per slot (null for collapsed-group slots), for resize hit-testing.
  const unitIdBySlot = useMemo(
    () => cols.slots.map((s) => (s.kind === 'col' ? s.unit.id : null)),
    [cols]
  )

  // ── Grid virtualization (columns #150, rows #157) ──────────────────────────
  // Only the cells near the viewport are rendered. The full `gridTemplate*` is
  // kept, so every track still exists and the scroll size and track positions
  // are unchanged — off-screen headers, cells and cards are simply left out.
  // Columns are a fixed width (arithmetic window); rows vary in height, so the
  // row window works off measured line offsets (see `lineTops` below).
  // The window is null until the container is measured — meaning "render
  // everything" — so the board is never shown missing columns before the first
  // measurement (and jsdom, which never lays out, always renders all).
  type Win = { first: number; last: number }
  const slotCount = cols.slots.length
  const [colWin, setColWin] = useState<Win | null>(null)
  const recomputeColWin = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const next = columnWindow(el.scrollLeft, el.clientWidth, headerW, colW, slotCount, OVERSCAN_COLS)
    setColWin((prev) => (prev && prev.first === next.first && prev.last === next.last ? prev : next))
  }, [colW, headerW, slotCount])

  // slot.index equals its position in cols.slots, so a slice is exactly the
  // slots whose index is in the window; a null window renders them all.
  const visibleSlots = useMemo(
    () => (colWin ? cols.slots.slice(colWin.first, colWin.last + 1) : cols.slots),
    [cols.slots, colWin]
  )
  /** True if a column span [startSlot, endSlot] touches the rendered window. */
  const inWindow = (startSlot: number, endSlot: number): boolean =>
    !colWin || (startSlot <= colWin.last && endSlot >= colWin.first)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  useEffect(() => {
    if (!rowMenu) return
    const close = (): void => setRowMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [rowMenu])

  // One header row per level of grouping actually in use, then the column labels.
  // A board that uses a single level has none of the former (Issue #104).
  const headerRows = cols.depth + 1
  const colHeadRow = headerRows // 1-based grid row for the column-header line
  const dataRowBase = colHeadRow + 1

  // Rows containing an expanded card grow to fit; everything else stays compact.
  const expandedLines = useMemo(() => {
    const s = new Set<number>()
    for (const pc of fullCards) if (isExpanded(pc.card.id)) s.add(pc.lineIndex)
    return s
  }, [fullCards, isExpanded])

  // ── Row virtualization (#157) ──────────────────────────────────────────────
  // Character ids whose row is auto-height right now (an expanded card or an
  // expanded name). These are the only rows whose height isn't known up front,
  // so they're the only ones that need measuring.
  const expandedRowIds = useMemo(() => {
    const s = new Set<string>()
    for (const line of rows.lines)
      if (line.kind === 'row' && (expandedLines.has(line.index) || isRowExpanded(line.char.id)))
        s.add(line.char.id)
    return s
  }, [rows.lines, expandedLines, isRowExpanded])

  const rowHeights = useRef(new Map<string, number>())
  const [measureTick, setMeasureTick] = useState(0)

  // Cumulative pixel top of each line in the grid's own coordinates: tops[0] is
  // the sticky header band's height, tops[i]/tops[i+1] bound line i, tops[n] is
  // the board's full height. Fixed-height lines are exact; an auto-height
  // (expanded) row uses its measured height, falling back to the compact height
  // until measured. The branch logic mirrors `rowTracks` below — keep them in
  // step (rowTracks emits the CSS tracks; this gives the window the numbers).
  const lineTops = useMemo(() => {
    const tops = new Array<number>(rows.lines.length + 1)
    tops[0] = cols.depth * GROUP_H + COLHEAD_H
    for (let i = 0; i < rows.lines.length; i++) {
      const line = rows.lines[i]
      let h: number
      if (line.kind === 'groupHeader') h = GROUPHEAD_LINE_H * zoom
      else if (line.kind === 'row' && expandedRowIds.has(line.char.id))
        h = rowHeights.current.get(line.char.id) ?? rowH
      else {
        const depth = line.kind === 'row' ? (stackDepth.get(line.index) ?? 1) : 1
        h = depth > 1 ? depth * cardH + (depth + 1) * STACK_GAP : rowH
      }
      tops[i + 1] = tops[i] + h
    }
    return tops
  }, [rows.lines, expandedRowIds, zoom, rowH, cardH, stackDepth, cols.depth, measureTick])

  const [rowWin, setRowWin] = useState<Win | null>(null)
  const recomputeRowWin = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const next = rowWindow(el.scrollTop, el.clientHeight, lineTops, OVERSCAN_ROWS)
    setRowWin((prev) => (prev && prev.first === next.first && prev.last === next.last ? prev : next))
  }, [lineTops])

  // line.index equals its position in rows.lines, so a slice is exactly the
  // lines whose index is in the window; a null window renders them all.
  const visibleLines = useMemo(
    () => (rowWin ? rows.lines.slice(rowWin.first, rowWin.last + 1) : rows.lines),
    [rows.lines, rowWin]
  )

  // Recompute both windows before paint, on the container's own resizes, and on
  // scroll (at most once per animation frame).
  const recompute = useCallback(() => {
    recomputeColWin()
    recomputeRowWin()
  }, [recomputeColWin, recomputeRowWin])

  useLayoutEffect(() => {
    recompute()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(el)
    return () => ro.disconnect()
  }, [recompute])

  const scrollRaf = useRef<number | null>(null)
  const onBoardScroll = (): void => {
    hideCardHoverTip()
    if (scrollRaf.current != null) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null
      recompute()
    })
  }
  useEffect(
    () => () => {
      if (scrollRaf.current != null) cancelAnimationFrame(scrollRaf.current)
    },
    []
  )

  // Measure the real height of the auto-height rows that are on screen and feed
  // it back into `lineTops` (#157). The set is small (only expanded rows) and a
  // row can only be expanded while it's visible, so its height is captured then
  // and kept even after it scrolls away. jsdom reports 0 and never ticks, so the
  // unmeasured fallback (render everything) stands in tests.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || expandedRowIds.size === 0) return
    let changed = false
    el.querySelectorAll<HTMLElement>('.row-head[data-rowid]').forEach((head) => {
      const id = head.dataset.rowid
      if (!id || !expandedRowIds.has(id)) return
      const h = head.getBoundingClientRect().height
      if (h > 0 && Math.abs((rowHeights.current.get(id) ?? -1) - h) > 0.5) {
        rowHeights.current.set(id, h)
        changed = true
      }
    })
    if (changed) setMeasureTick((t) => t + 1)
  }, [expandedRowIds, zoom, rowWin, colWin, measureTick])

  const rowTracks = rows.lines
    .map((line) => {
      if (line.kind === 'groupHeader') return `${GROUPHEAD_LINE_H * zoom}px`
      // A row grows to fit either an expanded card or an expanded header name.
      if (line.kind === 'row' && (expandedLines.has(line.index) || isRowExpanded(line.char.id)))
        return `minmax(${rowH}px, auto)`
      // A row holding overlapping cards grows to fit the whole stack (#66).
      const depth = line.kind === 'row' ? (stackDepth.get(line.index) ?? 1) : 1
      if (depth > 1) return `${depth * cardH + (depth + 1) * STACK_GAP}px`
      return `${rowH}px`
    })
    .join(' ')

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `${headerW}px repeat(${cols.slots.length}, ${colW}px)`,
    gridTemplateRows: `${`${GROUP_H}px `.repeat(cols.depth)}${COLHEAD_H}px ${rowTracks}`,
    ['--card-font' as string]: `${cardFont}px`
  }

  // ── Toggles ──
  const toggleColGroup = (group: string): void => {
    const set = board.collapsedColGroups.includes(group)
      ? board.collapsedColGroups.filter((g) => g !== group)
      : [...board.collapsedColGroups, group]
    void saveBoard({ ...board, collapsedColGroups: set })
  }
  const toggleRowGroup = (group: string): void => {
    const set = board.collapsedRowGroups.includes(group)
      ? board.collapsedRowGroups.filter((g) => g !== group)
      : [...board.collapsedRowGroups, group]
    void saveBoard({ ...board, collapsedRowGroups: set })
  }
  const hideRow = (id: string): void => {
    void saveBoard({ ...board, hiddenRows: [...board.hiddenRows, id] })
  }
  /**
   * Take a character off this board without deleting them. Their file — and any
   * family-tree relations — survive; only their row, cards and place in the order
   * go. On a pre-v0.6.0 board this is also the action that stamps `members`.
   */
  const removeRow = (id: string): void => {
    void saveBoard(removeBoardMember(board, characters, id))
  }
  const hideCol = (id: string): void => {
    void saveBoard({ ...board, hiddenCols: [...board.hiddenCols, id] })
  }

  // ── Reorder rows / groups (drag headers) ──
  const allowDrop = (e: React.DragEvent): void => e.preventDefault()
  const onMemberDrop = (e: React.DragEvent, targetId: string): void => {
    const id = e.dataTransfer.getData(MIME_MEMBER)
    if (id) void saveBoard({ ...board, rowOrder: reorderRowMember(board, characters, id, targetId) })
  }
  const onBlockDrop = (e: React.DragEvent, targetKey: string): void => {
    const key = e.dataTransfer.getData(MIME_BLOCK)
    if (key) void saveBoard({ ...board, rowGroupOrder: reorderRowBlocks(board, characters, key, targetKey) })
  }

  // ── Zoom ──
  const onWheel = (e: React.WheelEvent): void => {
    // A zoom resizes the card under the tip, so the tip would point at nothing.
    hideCardHoverTip()
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const next = Math.round(Math.min(2, Math.max(0.5, zoom * (1 - e.deltaY * 0.0015))) * 100) / 100
    setPendingZoom(next) // immediate visual update; the write is deferred below
    if (zoomTimer.current) clearTimeout(zoomTimer.current)
    zoomTimer.current = setTimeout(() => {
      zoomTimer.current = null
      void saveBoard({ ...board, zoom: next })
    }, ZOOM_SAVE_DELAY)
  }

  // ── Create / move / resize ──
  /**
   * Reveal a whole row or column at once, or put it back (#67).
   *
   * "Reveal" flips to "hide" once everything in the group is already showing, so
   * one control does both and you can re-hide a column to try it again.
   */
  const revealGroup = (ids: string[]): void => {
    if (ids.length === 0) return
    revealMany(ids, !ids.every((id) => isRevealed(id)))
  }
  const revealRow = (lineIndex: number): void =>
    revealGroup(fullCards.filter((pc) => pc.lineIndex === lineIndex).map((pc) => pc.card.id))
  const revealColumn = (slotIndex: number): void =>
    revealGroup(
      fullCards
        .filter((pc) => pc.startSlot <= slotIndex && pc.endSlot >= slotIndex)
        .map((pc) => pc.card.id)
    )

  const createAt = async (rowId: string, colId: string): Promise<void> => {
    const title = await ask({ title: 'New card', placeholder: 'Card title' })
    if (title && title.trim()) {
      createCard({ boardId: board.id, title: title.trim(), rowId, colStart: colId, colEnd: colId })
    }
  }

  // Stable for the memoised card (#133) — it closes over nothing that changes.
  const onCardDragStart = useCallback((e: React.DragEvent, card: Card): void => {
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  // Stable context-menu opener for the memoised card (#133).
  const openCardMenu = useCallback((e: React.MouseEvent, cardId: string): void => {
    e.preventDefault()
    hideCardHoverTip()
    setMenu({ cardId, x: e.clientX, y: e.clientY })
  }, [])
  const onCellDrop = (e: React.DragEvent, rowId: string, colId: string): void => {
    e.preventDefault()
    const cardId = e.dataTransfer.getData('text/plain')
    const card = board.cards.find((c) => c.id === cardId)
    if (!card) return
    const a = fullOrder.indexOf(card.colStart)
    const b = fullOrder.indexOf(card.colEnd)
    const width = Math.abs(b - a)
    const startPos = fullOrder.indexOf(colId)
    const endPos = Math.min(fullOrder.length - 1, startPos + width)
    updateCard(board.id, { ...card, rowId, colStart: colId, colEnd: fullOrder[endPos] })
  }

  // Empty-cell click and drop are delegated to the grid container (#133): read
  // the cell under the event from its data attributes rather than binding a
  // handler to each of the board's thousands of cells. Collapsed cells keep
  // their own handler, so the `:not(.collapsed-cell)` guard skips them here.
  const cellFromEvent = (e: React.SyntheticEvent): { row: string; col: string } | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.cell:not(.collapsed-cell)')
    const row = el?.dataset.row
    const col = el?.dataset.col
    return row && col ? { row, col } : null
  }
  const onGridClick = (e: React.MouseEvent): void => {
    const hit = cellFromEvent(e)
    if (hit) void createAt(hit.row, hit.col)
  }
  const onGridDragOver = (e: React.DragEvent): void => {
    if (cellFromEvent(e)) e.preventDefault()
  }
  const onGridDrop = (e: React.DragEvent): void => {
    const hit = cellFromEvent(e)
    if (hit) onCellDrop(e, hit.row, hit.col)
  }

  // Wrapped so the memoised card (#133) keeps a stable handler across the common
  // re-renders (hover, expand, menu). Its deps only move on zoom/layout/data
  // changes — cases where the cards re-render anyway.
  const beginResize = useCallback(
    (e: React.PointerEvent, card: Card, edge: 'start' | 'end'): void => {
      e.preventDefault()
      e.stopPropagation()
      const grid = scrollRef.current
      if (!grid) return
      const slotAtX = (clientX: number): number => {
        const rect = grid.getBoundingClientRect()
        const x = clientX - rect.left + grid.scrollLeft - headerW
        return Math.min(cols.slots.length - 1, Math.max(0, Math.floor(x / colW)))
      }
      const applyMove = (ev: PointerEvent): void => {
        const unitId = unitIdBySlot[slotAtX(ev.clientX)]
        if (!unitId) return
        setPreview(
          edge === 'end'
            ? { cardId: card.id, colStart: card.colStart, colEnd: unitId }
            : { cardId: card.id, colStart: unitId, colEnd: card.colEnd }
        )
      }
      const move = rafThrottle(applyMove)
      const onUp = (): void => {
        move.flush() // apply the last move now, so the commit isn't a frame stale
        window.removeEventListener('pointermove', move.run)
        window.removeEventListener('pointerup', onUp)
        setPreview((p) => {
          if (p && p.cardId === card.id) {
            const a = fullOrder.indexOf(p.colStart)
            const b = fullOrder.indexOf(p.colEnd)
            updateCard(board.id, {
              ...card,
              colStart: fullOrder[Math.min(a, b)],
              colEnd: fullOrder[Math.max(a, b)]
            })
          }
          return null
        })
      }
      window.addEventListener('pointermove', move.run)
      window.addEventListener('pointerup', onUp)
    },
    [headerW, colW, cols.slots.length, unitIdBySlot, fullOrder, updateCard, board.id]
  )

  /**
   * Drag the corner's right edge to widen or narrow the row headers (#80).
   *
   * The maximum is half the *visible* board rather than a fixed px, so however
   * small the window is the plot itself always keeps half of it. Only the final
   * width is saved — the drag itself just previews.
   */
  const beginHeaderResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const scroll = scrollRef.current
    if (!scroll) return
    const startX = e.clientX
    const startW = board.rowHeaderWidth ?? ROW_HEADER_W_DEFAULT
    // Floored, not rounded: half is a ceiling, so overshooting it by a pixel on
    // an odd-width window would be wrong in the one direction that matters.
    const maxW = Math.max(ROW_HEADER_W_MIN, Math.floor(scroll.clientWidth * ROW_HEADER_W_MAX_FRACTION))
    const applyMove = (ev: PointerEvent): void => {
      setHeaderDrag(Math.min(maxW, Math.max(ROW_HEADER_W_MIN, startW + ev.clientX - startX)))
    }
    const move = rafThrottle(applyMove)
    const onUp = (): void => {
      move.flush() // apply the last move now, so the saved width isn't a frame stale
      window.removeEventListener('pointermove', move.run)
      window.removeEventListener('pointerup', onUp)
      setHeaderDrag((w) => {
        if (w != null && w !== startW) void saveBoard({ ...board, rowHeaderWidth: w })
        return null
      })
    }
    window.addEventListener('pointermove', move.run)
    window.addEventListener('pointerup', onUp)
  }

  const resetHeaderWidth = (): void => {
    if ((board.rowHeaderWidth ?? ROW_HEADER_W_DEFAULT) !== ROW_HEADER_W_DEFAULT) {
      void saveBoard({ ...board, rowHeaderWidth: ROW_HEADER_W_DEFAULT })
    }
  }

  const empty = cols.slots.length === 0 || rows.lines.length === 0

  return (
    <div className="board-scroll" ref={scrollRef} onWheel={onWheel} onScroll={onBoardScroll}>
      {empty ? (
        <p className="muted placeholder">
          Add at least one column (timeline unit) and one row (character) to start plotting.
        </p>
      ) : (
        <div
          className="board-grid"
          style={gridStyle}
          onClick={onGridClick}
          onDragOver={onGridDragOver}
          onDrop={onGridDrop}
        >
          {/* corner */}
          <div className="grid-corner" style={{ gridColumn: 1, gridRow: `1 / ${headerRows + 1}` }} />

          {/* Grab rail for the header column's width (#80). It spans the whole
              boundary rather than sitting in the corner: the edge is as tall as
              the board, and a strip only as tall as one header cell is a target
              you have to already know about to find. The rail itself ignores the
              pointer so the row headers under it stay clickable. */}
          <div
            className="header-resize-rail"
            style={{ gridColumn: 1, gridRow: `1 / ${dataRowBase + rows.lines.length}` }}
          >
            <span
              className="header-resize"
              title="Drag to resize the row headers · double-click to reset"
              onPointerDown={beginHeaderResize}
              onDoubleClick={resetHeaderWidth}
            />
          </div>

          {/* column group headers: one row per level in use (Issue #104). The
              chevron collapses; the label opens the group's note — on a board
              that is the plotting surface, a group's note is read from here. */}
          {cols.headersByDepth.flatMap((row, depth) =>
            row
              .filter((h) => inWindow(h.startIndex, h.startIndex + h.span - 1))
              .map((h) => (
              <div
                key={`gh-${h.node.id}`}
                className={`col-group-head depth-${Math.min(depth, 2)}`}
                style={{
                  gridColumn: `${h.startIndex + 2} / ${h.startIndex + 2 + h.span}`,
                  gridRow: depth + 1,
                  // Each row sticks below the ones above it, not on top of them.
                  top: depth * GROUP_H
                }}
              >
                <button
                  className="chevron"
                  title={h.collapsed ? 'Expand' : 'Collapse'}
                  aria-label={`${h.collapsed ? 'Expand' : 'Collapse'} ${h.node.label}`}
                  onClick={() => toggleColGroup(h.node.id)}
                >
                  {h.collapsed ? '▸' : '▾'}
                </button>
                <button
                  className="col-group-label"
                  title={`Open the note for ${h.node.label}`}
                  onClick={() => openPanel({ kind: 'colgroup', id: h.node.id })}
                >
                  {h.node.label}
                  {h.node.hasNote && (
                    <span className="row-note-icon" aria-hidden="true">
                      {' '}
                      📝
                    </span>
                  )}
                </button>
              </div>
            ))
          )}

          {/* column headers (row colHeadRow) */}
          {visibleSlots.map((slot) =>
            slot.kind === 'col' ? (
              <div
                key={slot.unit.id}
                className="col-head"
                style={{ gridColumn: slot.index + 2, gridRow: colHeadRow, top: cols.depth * GROUP_H }}
                title={
                  revising
                    ? `Reveal or re-hide every card in ${slot.unit.label}`
                    : slot.unit.summary
                }
                onClick={() => {
                  if (!revising) return
                  revealColumn(slot.index)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  hideCol(slot.unit.id)
                }}
              >
                {/* A column with a note says so, and the label opens it — as a
                    character's name does on the row axis (#41). Not in revision
                    mode, where the click is the reveal and a note would give the
                    answer away (#67). */}
                {slot.unit.hasNote && !revising ? (
                  <button
                    className="col-name col-note"
                    title={`Read the note for ${slot.unit.label}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      openPanel({ kind: 'timeline', id: slot.unit.id })
                    }}
                  >
                    {slot.unit.label}
                    <span className="row-note-icon" aria-hidden="true">
                      {' '}
                      📝
                    </span>
                  </button>
                ) : (
                  slot.unit.label
                )}
              </div>
            ) : (
              <div
                key={`cg-${slot.node.id}`}
                className="col-head collapsed"
                style={{ gridColumn: slot.index + 2, gridRow: colHeadRow, top: cols.depth * GROUP_H }}
                onClick={() => toggleColGroup(slot.node.id)}
                title={`Expand ${slot.node.label}`}
              >
                {slot.members.length} cols
              </div>
            )
          )}

          {/* rows (only the lines in the vertical window, #157) */}
          {visibleLines.map((line) => {
            const gridRow = dataRowBase + line.index

            if (line.kind === 'groupHeader') {
              return (
                <div
                  key={`rgh-${line.group}`}
                  className="row-group-head draggable"
                  style={{ gridColumn: `1 / ${cols.slots.length + 2}`, gridRow }}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(MIME_BLOCK, line.group)}
                  onDragOver={allowDrop}
                  onDrop={(e) => onBlockDrop(e, line.group)}
                  onClick={() => toggleRowGroup(line.group)}
                  title="Click to collapse · drag to reorder group"
                >
                  <span className="row-group-label">
                    <span className="chevron">▾</span> {line.group}
                  </span>
                </div>
              )
            }

            if (line.kind === 'groupRow') {
              return (
                <Fragment key={`rgr-${line.group}`}>
                  <div
                    className="row-head collapsed draggable"
                    style={{ gridColumn: 1, gridRow }}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData(MIME_BLOCK, line.group)}
                    onDragOver={allowDrop}
                    onDrop={(e) => onBlockDrop(e, line.group)}
                    onClick={() => toggleRowGroup(line.group)}
                    title="Click to expand · drag to reorder group"
                  >
                    <span className="chevron">▸</span>
                    <span className="row-name">
                      {/* Clamped like a character name, so a long group label
                          reads over two lines instead of one (#80). */}
                      <span className="row-name-text">
                        {line.group} ({line.members.length})
                      </span>
                    </span>
                  </div>
                  {visibleSlots.map((slot) => {
                    const count = markers.get(markerKey(line.index, slot.index))
                    return (
                      <div
                        key={`gr-${line.group}-${slot.index}`}
                        className="cell collapsed-cell"
                        style={{ gridColumn: slot.index + 2, gridRow }}
                        onClick={() => toggleRowGroup(line.group)}
                      >
                        {count ? <span className="marker">{count}</span> : null}
                      </div>
                    )
                  })}
                </Fragment>
              )
            }

            // normal character row
            const char = line.char
            const rowExpanded = isRowExpanded(char.id)
            return (
              <Fragment key={char.id}>
                <div
                  className={`row-head draggable${rowExpanded ? ' expanded' : ''}`}
                  data-rowid={char.id}
                  style={{ gridColumn: 1, gridRow }}
                  draggable
                  onDragStart={(e) =>
                    line.group != null
                      ? e.dataTransfer.setData(MIME_MEMBER, char.id)
                      : e.dataTransfer.setData(MIME_BLOCK, char.id)
                  }
                  onDragOver={allowDrop}
                  onDrop={(e) => {
                    if (line.group != null) onMemberDrop(e, char.id)
                    else onBlockDrop(e, char.id)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setRowMenu({ charId: char.id, name: char.name, x: e.clientX, y: e.clientY })
                  }}
                  title="Drag to reorder · right-click for row options"
                >
                  <span
                    className="swatch"
                    style={{ background: char.colour }}
                    title={revising ? `Reveal or re-hide ${char.name}'s cards` : undefined}
                    onClick={() => revising && revealRow(line.index)}
                  />
                  <RowHeadName
                    char={char}
                    expanded={rowExpanded}
                    headerW={headerW}
                    zoom={zoom}
                    onOpenNote={() => openCharacterNote(char.id)}
                    onToggle={() => toggleRow(char.id)}
                  />
                </div>

                <div
                  className="thread"
                  style={{
                    gridColumn: `2 / ${cols.slots.length + 2}`,
                    gridRow,
                    ['--thread' as string]: char.colour
                  }}
                />

                {visibleSlots.map((slot) => {
                  if (slot.kind === 'colGroup') {
                    const count = markers.get(markerKey(line.index, slot.index))
                    return (
                      <div
                        key={slot.node.id}
                        className="cell collapsed-cell"
                        style={{ gridColumn: slot.index + 2, gridRow }}
                        onClick={() => toggleColGroup(slot.node.id)}
                      >
                        {count ? <span className="marker">{count}</span> : null}
                      </div>
                    )
                  }
                  // No per-cell handlers (#133): click/drag are delegated to the
                  // grid container, which reads these data attributes. On a large
                  // board that removes ~3 listeners × thousands of cells.
                  return (
                    <div
                      key={slot.unit.id}
                      className="cell"
                      data-row={char.id}
                      data-col={slot.unit.id}
                      style={{ gridColumn: slot.index + 2, gridRow }}
                    />
                  )
                })}

                {fullCards
                  .filter((pc) => pc.lineIndex === line.index && inWindow(pc.startSlot, pc.endSlot))
                  .map((pc) => {
                    const note = pc.note
                    // A hidden card keeps its hint to itself too — it would give
                    // the answer away just as opening it would (#67).
                    const masked = revising && !isRevealed(pc.card.id)
                    const status = findCardStatus(statuses, note?.status)
                    return (
                      <BoardCard
                        key={pc.card.id}
                        pc={pc}
                        gridRow={gridRow}
                        cardH={cardH}
                        lineDepth={stackDepth.get(line.index) ?? 1}
                        masked={masked}
                        isExp={isExpanded(pc.card.id)}
                        // Board cards show the title only; expand reveals a long
                        // title in full.
                        expandable={(note?.title?.length ?? 0) > 36}
                        hoverText={masked ? undefined : note?.hover}
                        statusIcon={status?.icon}
                        statusLabel={status?.label}
                        noteId={note?.id}
                        title={note?.title ?? '(missing note)'}
                        hasBody={!!note?.hasBody}
                        hasLinks={!!note?.related && note.related.length > 0}
                        onOpenNote={openNote}
                        onToggleReveal={toggleRevealed}
                        onToggleExpand={toggleExpand}
                        onBeginResize={beginResize}
                        onCardDragStart={onCardDragStart}
                        onOpenMenu={openCardMenu}
                      />
                    )
                  })}
              </Fragment>
            )
          })}
        </div>
      )}

      <CardHoverTipHost />

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            onClick={() => {
              const card = board.cards.find((c) => c.id === menu.cardId)
              const note = card && noteForCard(notes, card.noteUid)
              if (note) openNote(note.id)
            }}
          >
            Open note
          </button>
          <button
            className="danger"
            onClick={() => {
              if (confirm('Delete this card? The note file is kept.')) deleteCard(board.id, menu.cardId)
            }}
          >
            Delete card
          </button>
        </div>
      )}

      {rowMenu && (
        <div className="context-menu" style={{ left: rowMenu.x, top: rowMenu.y }}>
          <button onClick={() => hideRow(rowMenu.charId)}>Hide row</button>
          <button
            className="danger"
            onClick={() => {
              // Not a delete, so no scary confirmation — but the cards do go, and
              // that is worth saying out loud before it happens.
              const hasCards = board.cards.some((c) => c.rowId === rowMenu.charId)
              if (
                !hasCards ||
                confirm(
                  `Take ${rowMenu.name} off this board? They stay in the project and on the family tree, but their cards on this board are removed.`
                )
              ) {
                removeRow(rowMenu.charId)
              }
            }}
          >
            Remove from this board
          </button>
        </div>
      )}

    </div>
  )
}
