import { useBoardUi } from './BoardUiContext'

/** Right-side tab-bar toolbar for the Boards tab. */
export function BoardToolbar(): JSX.Element {
  const { allExpanded, setAll, cardIds, revising, setRevising, revealAll } = useBoardUi()
  const empty = cardIds.length === 0

  return (
    <div className="header-toolbar">
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
    </div>
  )
}
