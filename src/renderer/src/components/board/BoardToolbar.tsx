import { useBoardUi } from './BoardUiContext'

/** Right-side tab-bar toolbar for the Boards tab. One button for now. */
export function BoardToolbar(): JSX.Element {
  const { allExpanded, setAll, cardIds } = useBoardUi()
  return (
    <div className="header-toolbar">
      <button
        className="toolbar-btn"
        disabled={cardIds.length === 0}
        title={allExpanded ? 'Collapse all cards' : 'Expand all cards'}
        onClick={() => setAll(!allExpanded)}
      >
        {allExpanded ? '⤡' : '⤢'}
      </button>
    </div>
  )
}
