import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Board, Card } from '@shared/types'
import type { BoardData } from '@shared/ipc'
import { useStore } from '../../store'
import { usePrompt } from '../PromptModal'
import { NotePopup } from '../NotePopup'
import { CharacterNotePopup } from '../CharacterNotePopup'
import { useBoardUi } from './BoardUiContext'
import {
  buildBoardLayout,
  markerKey,
  noteForCard,
  orderedColumnIds,
  removeBoardMember,
  reorderRowBlocks,
  reorderRowMember
} from './grid-utils'

const MIME_MEMBER = 'application/x-znstoryline-row-member'
const MIME_BLOCK = 'application/x-znstoryline-row-block'

const HEADER_W = 170
const BASE_COL_W = 160
// Compact default row height — fits ~2 lines of card text. Rows with an
// expanded card grow to fit (see the per-row track heights below).
const COMPACT_ROW_H = 66
const GROUPHEAD_LINE_H = 30
const GROUP_H = 26
const COLHEAD_H = 44

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

export function BoardGrid({ data }: { data: BoardData }): JSX.Element {
  const { config, createCard, updateCard, deleteCard, saveBoard } = useStore()
  const ask = usePrompt()
  const board = data.board
  const characters = data.characters
  const timeline = data.timeline
  const notes = data.notes

  const [openNoteId, setOpenNoteId] = useState<string | null>(null)
  const [openCharId, setOpenCharId] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const { isExpanded, toggle: toggleExpand, registerCards } = useBoardUi()
  const scrollRef = useRef<HTMLDivElement>(null)

  const zoom = board.zoom || 1
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

  // Apply any live resize preview to the board before computing layout.
  const effectiveBoard = useMemo<Board>(() => {
    if (!preview) return board
    return {
      ...board,
      cards: board.cards.map((c) =>
        c.id === preview.cardId ? { ...c, colStart: preview.colStart, colEnd: preview.colEnd } : c
      )
    }
  }, [board, preview])

  const layout = useMemo(
    () => buildBoardLayout(effectiveBoard, characters, timeline, notes),
    [effectiveBoard, characters, timeline, notes]
  )
  const { cols, rows, fullCards, markers } = layout
  const fullOrder = useMemo(() => orderedColumnIds(timeline), [timeline])

  // unit id per slot (null for collapsed-group slots), for resize hit-testing.
  const unitIdBySlot = useMemo(
    () => cols.slots.map((s) => (s.kind === 'col' ? s.unit.id : null)),
    [cols]
  )

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

  const openNote = useMemo(() => notes.find((n) => n.id === openNoteId) ?? null, [notes, openNoteId])
  const openChar = useMemo(
    () => characters.find((c) => c.id === openCharId) ?? null,
    [characters, openCharId]
  )

  const headerRows = cols.hasGroups ? 2 : 1
  const colHeadRow = headerRows // 1-based grid row for the column-header line
  const dataRowBase = colHeadRow + 1

  // Rows containing an expanded card grow to fit; everything else stays compact.
  const expandedLines = useMemo(() => {
    const s = new Set<number>()
    for (const pc of fullCards) if (isExpanded(pc.card.id)) s.add(pc.lineIndex)
    return s
  }, [fullCards, isExpanded])

  const rowTracks = rows.lines
    .map((line) => {
      if (line.kind === 'groupHeader') return `${GROUPHEAD_LINE_H * zoom}px`
      if (line.kind === 'row' && expandedLines.has(line.index)) return `minmax(${rowH}px, auto)`
      return `${rowH}px`
    })
    .join(' ')

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `${HEADER_W}px repeat(${cols.slots.length}, ${colW}px)`,
    gridTemplateRows: `${cols.hasGroups ? `${GROUP_H}px ` : ''}${COLHEAD_H}px ${rowTracks}`,
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
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const next = Math.min(2, Math.max(0.5, zoom * (1 - e.deltaY * 0.0015)))
    void saveBoard({ ...board, zoom: Math.round(next * 100) / 100 })
  }

  // ── Create / move / resize ──
  const createAt = async (rowId: string, colId: string): Promise<void> => {
    const title = await ask({ title: 'New card', placeholder: 'Card title' })
    if (title && title.trim()) {
      createCard({ boardId: board.id, title: title.trim(), rowId, colStart: colId, colEnd: colId })
    }
  }

  const onCardDragStart = (e: React.DragEvent, card: Card): void => {
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
  }
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

  const beginResize = (e: React.PointerEvent, card: Card, edge: 'start' | 'end'): void => {
    e.preventDefault()
    e.stopPropagation()
    const grid = scrollRef.current
    if (!grid) return
    const slotAtX = (clientX: number): number => {
      const rect = grid.getBoundingClientRect()
      const x = clientX - rect.left + grid.scrollLeft - HEADER_W
      return Math.min(cols.slots.length - 1, Math.max(0, Math.floor(x / colW)))
    }
    const onMove = (ev: PointerEvent): void => {
      const unitId = unitIdBySlot[slotAtX(ev.clientX)]
      if (!unitId) return
      setPreview(
        edge === 'end'
          ? { cardId: card.id, colStart: card.colStart, colEnd: unitId }
          : { cardId: card.id, colStart: unitId, colEnd: card.colEnd }
      )
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
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
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const empty = cols.slots.length === 0 || rows.lines.length === 0

  return (
    <div className="board-scroll" ref={scrollRef} onWheel={onWheel}>
      {empty ? (
        <p className="muted placeholder">
          Add at least one column (timeline unit) and one row (character) to start plotting.
        </p>
      ) : (
        <div className="board-grid" style={gridStyle}>
          {/* corner */}
          <div className="grid-corner" style={{ gridColumn: 1, gridRow: `1 / ${headerRows + 1}` }} />

          {/* column group headers (row 1) */}
          {cols.hasGroups &&
            cols.headers.map((h) => (
              <div
                key={`gh-${h.group}`}
                className="col-group-head"
                style={{ gridColumn: `${h.startIndex + 2} / ${h.startIndex + 2 + h.span}`, gridRow: 1 }}
                onClick={() => toggleColGroup(h.group)}
                title={h.collapsed ? 'Expand group' : 'Collapse group'}
              >
                <span className="chevron">{h.collapsed ? '▸' : '▾'}</span> {h.group}
              </div>
            ))}

          {/* column headers (row colHeadRow) */}
          {cols.slots.map((slot) =>
            slot.kind === 'col' ? (
              <div
                key={slot.unit.id}
                className="col-head"
                style={{ gridColumn: slot.index + 2, gridRow: colHeadRow }}
                title={slot.unit.summary}
                onContextMenu={(e) => {
                  e.preventDefault()
                  hideCol(slot.unit.id)
                }}
              >
                {slot.unit.label}
              </div>
            ) : (
              <div
                key={`cg-${slot.group}`}
                className="col-head collapsed"
                style={{ gridColumn: slot.index + 2, gridRow: colHeadRow }}
                onClick={() => toggleColGroup(slot.group)}
                title="Expand group"
              >
                {slot.members.length} cols
              </div>
            )
          )}

          {/* rows */}
          {rows.lines.map((line) => {
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
                      {line.group} ({line.members.length})
                    </span>
                  </div>
                  {cols.slots.map((slot) => {
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
            return (
              <Fragment key={char.id}>
                <div
                  className="row-head draggable"
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
                  <span className="swatch" style={{ background: char.colour }} />
                  {/* Only a character who has a note is clickable (issue #41),
                      and the 📝 marks which those are — so the board never
                      offers a click that opens nothing. */}
                  {char.hasNote ? (
                    <button
                      className="row-name row-note"
                      title={`Read ${char.name}’s note`}
                      onClick={() => setOpenCharId(char.id)}
                    >
                      <span className="row-note-name">{char.name}</span>
                      <span className="row-note-icon" aria-hidden="true">
                        📝
                      </span>
                    </button>
                  ) : (
                    <span className="row-name">{char.name}</span>
                  )}
                </div>

                <div
                  className="thread"
                  style={{
                    gridColumn: `2 / ${cols.slots.length + 2}`,
                    gridRow,
                    ['--thread' as string]: char.colour
                  }}
                />

                {cols.slots.map((slot) => {
                  if (slot.kind === 'colGroup') {
                    const count = markers.get(markerKey(line.index, slot.index))
                    return (
                      <div
                        key={slot.group}
                        className="cell collapsed-cell"
                        style={{ gridColumn: slot.index + 2, gridRow }}
                        onClick={() => toggleColGroup(slot.group)}
                      >
                        {count ? <span className="marker">{count}</span> : null}
                      </div>
                    )
                  }
                  return (
                    <div
                      key={slot.unit.id}
                      className="cell"
                      style={{ gridColumn: slot.index + 2, gridRow }}
                      onClick={() => createAt(char.id, slot.unit.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onCellDrop(e, char.id, slot.unit.id)}
                    />
                  )
                })}

                {fullCards
                  .filter((pc) => pc.lineIndex === line.index)
                  .map((pc) => {
                    const note = pc.note
                    const isExp = isExpanded(pc.card.id)
                    // Board cards show the title only (quick view); the full note
                    // lives in the popup. Expand reveals a long title in full.
                    const expandable = (note?.title?.length ?? 0) > 36
                    return (
                      <div
                        key={pc.card.id}
                        className={`board-card${isExp ? ' expanded' : ''}`}
                        draggable
                        onDragStart={(e) => onCardDragStart(e, pc.card)}
                        style={{
                          gridColumn: `${pc.startSlot + 2} / ${pc.endSlot + 3}`,
                          gridRow,
                          height: isExp ? 'auto' : `${cardH}px`,
                          ['--card-border' as string]: pc.colour
                        }}
                        onClick={() => note && setOpenNoteId(note.id)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setMenu({ cardId: pc.card.id, x: e.clientX, y: e.clientY })
                        }}
                      >
                        <span
                          className="resize-handle left"
                          onPointerDown={(e) => beginResize(e, pc.card, 'start')}
                        />
                        <div className="card-content">
                          <div className="card-title">
                            {/* A card whose note has a body opens onto more than
                                its title, so it says so up front (issue #46). */}
                            {note?.hasBody && (
                              <span className="card-note-icon" title="Has note details">
                                📝{' '}
                              </span>
                            )}
                            {note?.title ?? '(missing note)'}
                            {note?.related && note.related.length > 0 && (
                              <span className="link-icon"> 🔗</span>
                            )}
                          </div>
                        </div>
                        {expandable && (
                          <button
                            className="card-expand"
                            title={isExp ? 'Collapse card' : 'Expand card'}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpand(pc.card.id)
                            }}
                          >
                            {isExp ? '⤡' : '⤢'}
                          </button>
                        )}
                        <span
                          className="resize-handle right"
                          onPointerDown={(e) => beginResize(e, pc.card, 'end')}
                        />
                      </div>
                    )
                  })}
              </Fragment>
            )
          })}
        </div>
      )}

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            onClick={() => {
              const card = board.cards.find((c) => c.id === menu.cardId)
              const note = card && noteForCard(notes, card.noteUid)
              if (note) setOpenNoteId(note.id)
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

      {openNote && (
        <NotePopup note={openNote} onClose={() => setOpenNoteId(null)} onOpenNote={setOpenNoteId} />
      )}

      {openChar && (
        <CharacterNotePopup character={openChar} onClose={() => setOpenCharId(null)} />
      )}
    </div>
  )
}
