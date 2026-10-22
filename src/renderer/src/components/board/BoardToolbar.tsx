import { useEffect, useRef, useState } from 'react'
import { isPlotRow } from '@shared/types'
import { manuscriptLevel } from '@shared/manuscript'
import { stepZoom } from '@shared/menu'
import { useMenuCommands, useMenuState } from '../../lib/menuBridge'
import { useStore } from '../../store'
import { useBoardUi } from './BoardUiContext'
import { ExportDialog } from './ExportDialog'
import { colGroupLevels, columnLevelItems, rowGroupNames, withAllRowGroups, withColumnsAtLevel } from './grid-utils'

/**
 * Collapse or expand every row group, or show the columns at one group level
 * (#164). One menu rather than a toggle, so rows and columns are separate and
 * each item does exactly what it says whatever state the groups are in.
 */
function GroupsMenu(): JSX.Element {
  const { activeBoard, snapshot, saveBoard, readOnly } = useStore()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const board = activeBoard?.board
  const characters = activeBoard?.characters ?? []
  const colGroups = activeBoard?.colGroups ?? []
  const hasRowGroups = !!board && rowGroupNames(board, characters).length > 0
  const levelItems = columnLevelItems(snapshot?.project, colGroupLevels(colGroups))
  const hasColGroups = levelItems.length > 0

  const save = (next: (b: NonNullable<typeof board>) => NonNullable<typeof board>): void => {
    setOpen(false)
    if (board) void saveBoard(next(board))
  }

  return (
    <div className="toolbar-menu" ref={rootRef}>
      <button
        className={`toolbar-btn${open ? ' active' : ''}`}
        disabled={readOnly || (!hasRowGroups && !hasColGroups)}
        title="Collapse or expand all row and column groups"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⊟
      </button>
      {open && (
        <div className="context-menu" role="menu">
          <button
            role="menuitem"
            disabled={!hasRowGroups}
            onClick={() => save((b) => withAllRowGroups(b, characters, true))}
          >
            ⊟ Collapse all rows
          </button>
          <button
            role="menuitem"
            disabled={!hasRowGroups}
            onClick={() => save((b) => withAllRowGroups(b, characters, false))}
          >
            ⊞ Expand all rows
          </button>
          <div className="context-menu-sep" role="separator" />
          {/* One item per group level; the deepest level is the columns
              themselves, so it never appears here. */}
          {levelItems.map(({ depth, label }) => (
            <button
              key={depth}
              role="menuitem"
              onClick={() => save((b) => withColumnsAtLevel(b, colGroups, depth))}
            >
              ⊟ {label}
            </button>
          ))}
          <button
            role="menuitem"
            disabled={!hasColGroups}
            onClick={() => save((b) => withColumnsAtLevel(b, colGroups, null))}
          >
            ⊞ Expand all columns
          </button>
        </div>
      )}
    </div>
  )
}

/** Right-side tab-bar toolbar for the Boards tab. */
export function BoardToolbar(): JSX.Element {
  const { allExpanded, setAll, cardIds, revising, setRevising, revealAll, filtersOpen, setFiltersOpen, filterActive } =
    useBoardUi()
  const { activeBoard, saveBoard, readOnly, snapshot } = useStore()
  const [exporting, setExporting] = useState(false)
  const empty = cardIds.length === 0

  // The row-kind toggles (Issue #119) only matter once a board actually has plot
  // rows, so they stay hidden until the author creates one — keeping the toolbar
  // unchanged for everyone else.
  const board = activeBoard?.board
  const hasPlotRows = (activeBoard?.characters ?? []).some(isPlotRow)
  const hidePlot = board?.hidePlotRows ?? false
  const hideChars = board?.hideCharacterRows ?? false
  // The Manuscript-row toggle (#204) appears once the project has the row.
  const hasManuscript = !!snapshot && manuscriptLevel(snapshot.project) !== null
  const hideManuscript = board?.hideManuscriptRow ?? false

  // Write the flag only when true, so a board left in the default state keeps a
  // clean board.json (matching how `normalizeBoard` drops the keys on read).
  const setFlag = (
    key: 'hidePlotRows' | 'hideCharacterRows' | 'hideManuscriptRow',
    on: boolean
  ): void => {
    if (!board) return
    const next = { ...board }
    if (on) next[key] = true
    else delete next[key]
    void saveBoard(next)
  }

  // ── The app menu (#168) ──
  // The board's part of the View and Board menus. Every command runs what the
  // button beside it here runs; the menu only adds another way to reach it.
  const characters = activeBoard?.characters ?? []
  const colGroups = activeBoard?.colGroups ?? []
  const hasRowGroups = !!board && rowGroupNames(board, characters).length > 0
  const levelItems = columnLevelItems(snapshot?.project, colGroupLevels(colGroups))
  useMenuState('board', {
    board: board
      ? {
          hasCards: !empty,
          manuscript: hasManuscript ? !hideManuscript : null,
          rowKinds: hasPlotRows ? { plot: !hidePlot, characters: !hideChars } : null,
          hasRowGroups,
          columnLevels: levelItems,
          allCardsExpanded: allExpanded,
          filtersOpen,
          revising
        }
      : null
  })
  const saveWith = (next: (b: NonNullable<typeof board>) => NonNullable<typeof board>): void => {
    if (board) void saveBoard(next(board))
  }
  useMenuCommands({
    'view.manuscript': () => setFlag('hideManuscriptRow', !hideManuscript),
    'view.plotRows': () => setFlag('hidePlotRows', !hidePlot),
    'view.characterRows': () => setFlag('hideCharacterRows', !hideChars),
    'view.collapseRows': () => saveWith((b) => withAllRowGroups(b, characters, true)),
    'view.expandRows': () => saveWith((b) => withAllRowGroups(b, characters, false)),
    'view.collapseLevel': ({ depth }) => saveWith((b) => withColumnsAtLevel(b, colGroups, depth)),
    'view.expandColumns': () => saveWith((b) => withColumnsAtLevel(b, colGroups, null)),
    'view.toggleCards': () => setAll(!allExpanded),
    'view.filters': () => setFiltersOpen(!filtersOpen),
    // The board's own zoom — the one Ctrl+scroll changes — not the page's.
    'view.zoomIn': () => saveWith((b) => ({ ...b, zoom: stepZoom(b.zoom || 1, 'in') })),
    'view.zoomOut': () => saveWith((b) => ({ ...b, zoom: stepZoom(b.zoom || 1, 'out') })),
    'view.zoomReset': () => saveWith((b) => ({ ...b, zoom: stepZoom(b.zoom || 1, 'reset') })),
    'board.revision': () => setRevising(!revising),
    'board.revealAll': () => revealAll(true),
    'board.hideAll': () => revealAll(false),
    'file.exportBoard': () => {
      if (board) setExporting(true)
    }
  })

  return (
    <div className="header-toolbar">
      {board && hasManuscript && (
        <button
          className={`toolbar-btn${hideManuscript ? ' active' : ''}`}
          disabled={readOnly}
          title={hideManuscript ? 'Show the Manuscript row' : 'Hide the Manuscript row'}
          onClick={() => setFlag('hideManuscriptRow', !hideManuscript)}
        >
          📖
        </button>
      )}
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
      {board && <GroupsMenu />}
      <button
        className="toolbar-btn"
        disabled={empty}
        title={allExpanded ? 'Collapse all cards' : 'Expand all cards'}
        onClick={() => setAll(!allExpanded)}
      >
        {allExpanded ? '⤡' : '⤢'}
      </button>
      {/* Open the filter bar below the tabs (#140, #182). Stays lit while a filter
          is applied, so a board showing only some of its rows/columns/cards says why. */}
      <button
        className={`toolbar-btn${filtersOpen || filterActive ? ' active' : ''}`}
        disabled={!board}
        title={filtersOpen ? 'Hide filters' : 'Filters'}
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
