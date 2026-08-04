import { useEffect, useState } from 'react'
import type { Board } from '@shared/types'
import { useStore } from '../../store'
import { usePrompt } from '../PromptModal'
import { moveAfter, moveBefore } from '../../lib/reorder'
import { BoardGrid } from './BoardGrid'

const PALETTE = ['#E24B4A', '#4A90D9', '#3FB984', '#E2A23B', '#9B59B6', '#16A085', '#E67E22']
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
    saveTimelineUnit,
    saveCharacter
  } = useStore()
  const ask = usePrompt()
  const characters = activeBoard?.characters ?? []
  const timeline = activeBoard?.timeline ?? []
  const board = activeBoard?.board ?? null

  const [tabMenu, setTabMenu] = useState<{ boardId: string; x: number; y: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

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

  const onAddColumn = async (): Promise<void> => {
    const unit = (snapshot?.project.timelineLabel ?? 'unit').toLowerCase()
    const label = await ask({ title: `New ${unit}`, placeholder: `${unit} label` })
    if (label && label.trim()) {
      saveTimelineUnit({ id: '', label: label.trim(), order: 0 })
    }
  }
  const onAddRow = async (): Promise<void> => {
    const name = await ask({ title: 'New character', placeholder: 'Character name' })
    if (name && name.trim()) {
      const colour = PALETTE[characters.length % PALETTE.length]
      saveCharacter({ id: '', type: 'character', name: name.trim(), colour })
    }
  }

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

          {activeBoard && <BoardGrid data={activeBoard} />}
        </>
      )}
    </div>
  )
}
