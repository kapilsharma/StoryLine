import { useState } from 'react'
import { isPlotRow } from '@shared/types'
import { useStore } from '../../store'
import { useBoardUi } from './BoardUiContext'
import { ExportDialog } from './ExportDialog'

/** Right-side tab-bar toolbar for the Boards tab. */
export function BoardToolbar(): JSX.Element {
  const { allExpanded, setAll, cardIds, revising, setRevising, revealAll, filtersOpen, setFiltersOpen, filterActive } =
    useBoardUi()
  const { activeBoard, saveBoard, readOnly } = useStore()
  const [exporting, setExporting] = useState(false)
  const empty = cardIds.length === 0

  // The row-kind toggles (Issue #119) only matter once a board actually has plot
  // rows, so they stay hidden until the author creates one — keeping the toolbar
  // unchanged for everyone else.
  const board = activeBoard?.board
  const hasPlotRows = (activeBoard?.characters ?? []).some(isPlotRow)
  const hidePlot = board?.hidePlotRows ?? false
  const hideChars = board?.hideCharacterRows ?? false

  // Write the flag only when true, so a board left in the default state keeps a
  // clean board.json (matching how `normalizeBoard` drops the keys on read).
  const setFlag = (key: 'hidePlotRows' | 'hideCharacterRows', on: boolean): void => {
    if (!board) return
    const next = { ...board }
    if (on) next[key] = true
    else delete next[key]
    void saveBoard(next)
  }

  return (
    <div className="header-toolbar">
      {board && hasPlotRows && (
        <>
          <button
            className={`toolbar-btn${hidePlot ? ' active' : ''}`}
            disabled={readOnly}
            title={hidePlot ? 'Show plot rows' : 'Hide plot rows'}
            onClick={() => setFlag('hidePlotRows', !hidePlot)}
          >
            📋
          </button>
          <button
            className={`toolbar-btn${hideChars ? ' active' : ''}`}
            disabled={readOnly}
            title={hideChars ? 'Show character rows' : 'Hide character rows'}
            onClick={() => setFlag('hideCharacterRows', !hideChars)}
          >
            👥
          </button>
        </>
      )}
      {/* Revision mode (#67). Hiding a column with a preset gives you the prompt;
          this gives you the answer back one card at a time. */}
      <button
        className={`toolbar-btn${revising ? ' active' : ''}`}
        disabled={empty}
        title={revising ? 'Leave revision mode' : 'Revision mode — hide card titles until clicked'}
        onClick={() => setRevising(!revising)}
      >
        🎓
      </button>
      {revising && (
        <>
          <button
            className="toolbar-btn"
            disabled={empty}
            title="Reveal every card"
            onClick={() => revealAll(true)}
          >
            👁
          </button>
          <button
            className="toolbar-btn"
            disabled={empty}
            title="Hide every card again"
            onClick={() => revealAll(false)}
          >
            ⊘
          </button>
        </>
      )}
      <button
        className="toolbar-btn"
        disabled={empty}
        title={allExpanded ? 'Collapse all cards' : 'Expand all cards'}
        onClick={() => setAll(!allExpanded)}
      >
        {allExpanded ? '⤡' : '⤢'}
      </button>
      {/* Open the filter bar below the tabs (#140). Stays lit while a filter is
          applied, so a board showing only some of its rows/columns says why. */}
      <button
        className={`toolbar-btn${filtersOpen || filterActive ? ' active' : ''}`}
        disabled={!board}
        title={filtersOpen ? 'Hide filters' : 'Filter rows and columns'}
        onClick={() => setFiltersOpen(!filtersOpen)}
      >
        🔍
      </button>
      {/* Export this board to one Markdown/PDF file (#125). Read-only, so it
          stays available even when the board is open read-only. */}
      <button
        className="toolbar-btn"
        disabled={!board}
        title="Export board to a file…"
        onClick={() => setExporting(true)}
      >
        📤
      </button>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  )
}
