import { useEffect, useRef, useState } from 'react'
import type { Board } from '@shared/types'
import { clampNotePanelFraction, NOTE_PANEL_FRACTION_DEFAULT } from '@shared/config'
import { useStore } from '../../store'
import { usePrompt } from '../PromptModal'
import { moveAfter, moveBefore } from '../../lib/reorder'
import { Modal } from '../Modal'
import { CharacterForm } from '../CharacterForm'
import { TimelineForm } from '../TimelineForm'
import { NotePopup } from '../NotePopup'
import { CharacterNotePopup } from '../CharacterNotePopup'
import { BoardGrid } from './BoardGrid'
import { NoteSidePanel } from './NoteSidePanel'
import { useBoardUi } from './BoardUiContext'
import { addBoardMember, nonMembers } from './grid-utils'
import { rowLabel, timelineLabel } from '@shared/project'

const MIME_BOARD = 'application/x-znstoryline-board'

export function BoardsView(): JSX.Element {
  const {
    snapshot,
    boards,
    activeBoardId,
    activeBoard,
    setActiveBoard,
    createBoard,
    renameBoard,
    deleteBoard,
    reorderBoards,
    saveBoard,
    config,
    updateSettings
  } = useStore()
  const ask = usePrompt()
  const { panel, openPanel, closePanel } = useBoardUi()
  const characters = activeBoard?.characters ?? []
  const timeline = activeBoard?.timeline ?? []
  const board = activeBoard?.board ?? null
  // What this project calls its two axes (#62).
  const rowWord = snapshot ? rowLabel(snapshot.project) : 'Character'
  const colWord = snapshot ? timelineLabel(snapshot.project) : 'Chapter'

  const [tabMenu, setTabMenu] = useState<{ boardId: string; x: number; y: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [addModal, setAddModal] = useState<null | 'row' | 'column'>(null)
  // Live share of the page while the panel divider is being dragged; null when
  // it isn't, and the saved setting applies.
  const [panelDrag, setPanelDrag] = useState<number | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const panelFraction = panelDrag ?? clampNotePanelFraction(config?.settings.notePanelFraction)
  // Which of the two views a note opens in (#83) — the reader's choice, made in
  // Settings, defaulting to the popup this app has always had.
  const asPanel = config?.settings.boardNoteView === 'panel'
  const openNote = panel?.kind === 'note' ? (activeBoard?.notes.find((n) => n.id === panel.id) ?? null) : null
  const openChar =
    panel?.kind === 'character'
      ? (activeBoard?.characters.find((c) => c.id === panel.id) ?? null)
      : null

  // A note belongs to the board it was opened from — carrying it across to the
  // next tab would show a note that board does not have.
  useEffect(() => {
    closePanel()
  }, [activeBoardId, closePanel])

  /**
   * Drag the divider to change the split (#83). Only the final fraction is
   * saved; the drag itself just previews, the same way the row-header rail
   * works (#80).
   */
  const beginPanelResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    const el = mainRef.current
    const settings = config?.settings
    if (!el || !settings) return
    const rect = el.getBoundingClientRect()
    const onMove = (ev: PointerEvent): void => {
      setPanelDrag(clampNotePanelFraction((rect.right - ev.clientX) / rect.width))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setPanelDrag((f) => {
        if (f != null && f !== settings.notePanelFraction) {
          void updateSettings({ ...settings, notePanelFraction: f })
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const resetPanelWidth = (): void => {
    const settings = config?.settings
    if (settings && settings.notePanelFraction !== NOTE_PANEL_FRACTION_DEFAULT) {
      void updateSettings({ ...settings, notePanelFraction: NOTE_PANEL_FRACTION_DEFAULT })
    }
  }

  const onTabDrop = (draggedId: string, targetId: string, e: React.DragEvent): void => {
    setDragId(null)
    if (!draggedId || draggedId === targetId) return
    const ids = boards.map((b) => b.id)
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > rect.left + rect.width / 2
    const next = after ? moveAfter(ids, draggedId, targetId) : moveBefore(ids, draggedId, targetId)
    if (next.some((id, i) => id !== ids[i])) void reorderBoards(next)
  }

  // Dismiss the tab context menu on any outside click.
  useEffect(() => {
    if (!tabMenu) return
    const close = (): void => setTabMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [tabMenu])

  const onAddBoard = async (): Promise<void> => {
    const name = await ask({ title: 'New board', placeholder: 'Board name' })
    if (name && name.trim()) createBoard(name.trim())
  }
  const onRenameBoard = async (b: Board): Promise<void> => {
    const name = await ask({ title: 'Rename board', defaultValue: b.name, confirmLabel: 'Rename' })
    if (name && name.trim() && name.trim() !== b.name) renameBoard(b.id, name.trim())
  }
  const onDeleteBoard = (b: Board): void => {
    if (confirm(`Delete board "${b.name}"? Card placements are lost; notes are kept.`)) {
      deleteBoard(b.id)
    }
  }

  // The board's quick-add buttons open the full character/timeline form in a
  // modal (the same forms the Characters/Timeline tabs use).
  const onAddColumn = (): void => setAddModal('column')
  const onAddRow = (): void => setAddModal('row')

  const applyPreset = (presetName: string): void => {
    if (!board) return
    const preset = board.presets.find((p) => p.name === presetName)
    if (preset) saveBoard({ ...board, hiddenRows: [...preset.hiddenRows], hiddenCols: [...preset.hiddenCols] })
  }
  const savePreset = async (): Promise<void> => {
    if (!board) return
    const name = await ask({ title: 'Save preset', placeholder: 'Preset name', confirmLabel: 'Save' })
    if (!name || !name.trim()) return
    const presets = board.presets.filter((p) => p.name !== name.trim())
    presets.push({ name: name.trim(), hiddenRows: [...board.hiddenRows], hiddenCols: [...board.hiddenCols] })
    saveBoard({ ...board, presets })
  }

  /**
   * Characters in this board's folder that are not on its grid — someone entered
   * for the family tree, or taken off the board earlier. Empty on a pre-v0.6.0
   * board, where every character is already a row.
   */
  const offBoard = board ? nonMembers(board, characters) : []
  const addCharacterToBoard = (id: string): void => {
    if (board) void saveBoard(addBoardMember(board, characters, id))
  }

  const unhideRow = (id: string): void => {
    if (board) void saveBoard({ ...board, hiddenRows: board.hiddenRows.filter((r) => r !== id) })
  }
  const unhideCol = (id: string): void => {
    if (board) void saveBoard({ ...board, hiddenCols: board.hiddenCols.filter((c) => c !== id) })
  }

  const hiddenRowNames = board
    ? board.hiddenRows
        .map((id) => characters.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
    : []
  const hiddenColNames = board
    ? board.hiddenCols
        .map((id) => timeline.find((t) => t.id === id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
    : []

  return (
    <div className="boards-view">
      <div className="board-tabs">
        {boards.map((b) => (
          <div
            key={b.id}
            className={`board-tab${b.id === activeBoardId ? ' active' : ''}${
              b.id === dragId ? ' dragging' : ''
            }`}
            draggable
            onClick={() => setActiveBoard(b.id)}
            onDoubleClick={() => onRenameBoard(b)}
            onContextMenu={(e) => {
              e.preventDefault()
              setTabMenu({ boardId: b.id, x: e.clientX, y: e.clientY })
            }}
            onDragStart={(e) => {
              setDragId(b.id)
              e.dataTransfer.setData(MIME_BOARD, b.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(MIME_BOARD)) e.preventDefault()
            }}
            onDrop={(e) => {
              const dragged = e.dataTransfer.getData(MIME_BOARD)
              if (dragged) onTabDrop(dragged, b.id, e)
            }}
            title="Drag to reorder · double-click or right-click to rename · right-click to delete"
          >
            {b.name}
          </div>
        ))}
        <button className="board-tab add" onClick={onAddBoard} title="New board">
          +
        </button>
      </div>

      {tabMenu && (
        <div className="context-menu" style={{ left: tabMenu.x, top: tabMenu.y }}>
          <button
            onClick={() => {
              const b = boards.find((x) => x.id === tabMenu.boardId)
              if (b) onRenameBoard(b)
            }}
          >
            Rename
          </button>
          <button
            className="danger"
            onClick={() => {
              const b = boards.find((x) => x.id === tabMenu.boardId)
              if (b) onDeleteBoard(b)
            }}
          >
            Delete
          </button>
        </div>
      )}

      {!board ? (
        <p className="muted placeholder">No boards. Create one with the + above.</p>
      ) : (
        <>
          <div className="board-toolbar">
            {board.presets.length > 0 && (
              <select
                className="preset-select"
                value=""
                onChange={(e) => e.target.value && applyPreset(e.target.value)}
              >
                <option value="">Presets…</option>
                {board.presets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn small" onClick={savePreset}>
              Save preset
            </button>
            <button className="btn small" onClick={onAddColumn}>
              + Column
            </button>
            <button className="btn small" onClick={onAddRow}>
              + Row
            </button>
            {offBoard.length > 0 && (
              <select
                className="preset-select"
                value=""
                title={`Put a ${rowWord.toLowerCase()} that is already in this project onto this board`}
                onChange={(e) => e.target.value && addCharacterToBoard(e.target.value)}
              >
                <option value="">Add {rowWord.toLowerCase()}… ({offBoard.length})</option>
                {offBoard.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}

            {(hiddenRowNames.length > 0 || hiddenColNames.length > 0) && (
              <div className="hidden-chips">
                <span className="muted small">Hidden:</span>
                {hiddenRowNames.map((c) => (
                  <button key={`r-${c.id}`} className="chip" onClick={() => unhideRow(c.id)}>
                    {c.name} ✕
                  </button>
                ))}
                {hiddenColNames.map((t) => (
                  <button key={`c-${t.id}`} className="chip" onClick={() => unhideCol(t.id)}>
                    {t.label} ✕
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* In panel mode (#83) the note is a sibling of the board rather than
              a modal over it, so the plot stays readable while a note is open —
              and the board keeps scrolling under its own width. */}
          <div className="board-main" ref={mainRef}>
            {activeBoard && <BoardGrid data={activeBoard} />}

            {panel && asPanel && (
              <>
                <div
                  className="note-panel-rail"
                  title="Drag to resize the note · double-click to reset"
                  onPointerDown={beginPanelResize}
                  onDoubleClick={resetPanelWidth}
                />
                <NoteSidePanel
                  key={`${panel.kind}:${panel.id}`}
                  target={panel}
                  onClose={closePanel}
                  onOpenNote={(id) => openPanel({ kind: 'note', id })}
                  style={{ flexBasis: `${panelFraction * 100}%` }}
                />
              </>
            )}
          </div>

          {/* The original popup, still the default. Rendered here rather than in
              the grid so both views are chosen in one place. */}
          {!asPanel && openNote && (
            <NotePopup
              note={openNote}
              onClose={closePanel}
              onOpenNote={(id) => openPanel({ kind: 'note', id })}
            />
          )}
          {!asPanel && openChar && <CharacterNotePopup character={openChar} onClose={closePanel} />}
        </>
      )}

      {addModal === 'row' && (
        <Modal title={`New ${rowWord.toLowerCase()}`} onClose={() => setAddModal(null)}>
          {/* Created *from* the board, so being a row is the reason it exists —
              unlike the Characters tab, where a new character stays off the grid. */}
          <CharacterForm
            initial={null}
            addToBoard
            onSaved={() => setAddModal(null)}
            onCancel={() => setAddModal(null)}
          />
        </Modal>
      )}
      {addModal === 'column' && (
        <Modal
          title={`New ${colWord.toLowerCase()}`}
          onClose={() => setAddModal(null)}
        >
          <TimelineForm
            initial={null}
            onSaved={() => setAddModal(null)}
            onCancel={() => setAddModal(null)}
          />
        </Modal>
      )}
    </div>
  )
}
