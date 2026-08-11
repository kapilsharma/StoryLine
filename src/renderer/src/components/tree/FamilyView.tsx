import { useMemo, useState, type ReactNode } from 'react'
import { familiesIn, familyOf, UNKNOWN_FAMILY_COLOUR } from '@shared/families'
import { useStore } from '../../store'
import { BoardPicker } from '../BoardPicker'
import { usePrompt } from '../PromptModal'
import { AddToTree } from './AddToTree'
import { DEFAULT_LAYOUT_OPTIONS, type LayoutOptions } from './layout'
import { TreeCanvas } from './TreeCanvas'
import { ViewSettings } from './ViewSettings'
import { ViewTabs } from './ViewTabs'

/**
 * Board picker above, view tabs inside. The tree is drawn over one board's cast,
 * so which board is showing has to be visible and switchable — the same picker
 * the Characters / Timeline / Notes tabs use.
 */
function Shell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="board-scoped-tab">
      <BoardPicker />
      <div className="family-view">{children}</div>
    </div>
  )
}

/**
 * The Family tab: view tab strip, toolbar, canvas, and the problems panel.
 *
 * Scoped to the **active board's** cast, because boards have been fully
 * independent since v0.2.0 — a tree spanning two of them would have no shared
 * characters to draw. Everything here lives inside `.family-view`, which is both
 * the CSS scope and the flex container the canvas needs to size itself against.
 */
export function FamilyView(): JSX.Element {
  const { graph, views, activeView, activeBoard, snapshot, saveView, createView, config, readOnly } =
    useStore()
  const ask = usePrompt()
  const [showSettings, setShowSettings] = useState(false)
  const [showProblems, setShowProblems] = useState(false)

  const opts: LayoutOptions = useMemo(
    () => ({
      nodeWidth: config?.settings.nodeWidth ?? DEFAULT_LAYOUT_OPTIONS.nodeWidth,
      nodeHeight: config?.settings.nodeHeight ?? DEFAULT_LAYOUT_OPTIONS.nodeHeight,
      generationGap: config?.settings.generationGap ?? DEFAULT_LAYOUT_OPTIONS.generationGap,
      siblingGap: config?.settings.siblingGap ?? DEFAULT_LAYOUT_OPTIONS.siblingGap,
      partnerGap: config?.settings.partnerGap ?? DEFAULT_LAYOUT_OPTIONS.partnerGap
    }),
    [config]
  )

  const problems = activeBoard?.problems ?? []
  const familyColours = snapshot?.project.families ?? {}
  const movedCount = Object.keys(activeView?.overrides ?? {}).length
  const routedCount = Object.keys(activeView?.edgeRoutes ?? {}).length

  // Only the families actually on screen — a legend listing absent families is
  // noise, and on a filtered view most of them are absent.
  const shown = useMemo(() => {
    if (!graph) return []
    const present = new Set(graph.characters.filter((c) => !c.ghost).map((c) => familyOf(c)))
    return familiesIn(graph.characters).filter((f) => present.has(f))
  }, [graph])

  const onFirstTree = async (): Promise<void> => {
    const name = await ask({
      title: 'New family tree',
      defaultValue: 'Everyone',
      placeholder: 'Everyone',
      confirmLabel: 'Create'
    })
    if (name) await createView(name)
  }

  if (!graph || !activeBoard) {
    return (
      <Shell>
        <div className="tree-empty">
          <p>No board selected.</p>
        </div>
      </Shell>
    )
  }

  // A board with no `views/` folder yet. Offering the first tree here beats
  // creating one silently on open, which would write to every project on upgrade.
  if (!views.length) {
    return (
      <Shell>
        <div className="tree-empty">
          <p>No family tree on this board yet.</p>
          <p className="hint">
            A tree is a saved set of filters over this board&rsquo;s characters — who it is centred
            on, and how many generations up and down to follow.
          </p>
          {!readOnly && (
            <button className="btn primary" onClick={() => void onFirstTree()}>
              Create the first tree
            </button>
          )}
        </div>
      </Shell>
    )
  }

  if (!activeView) {
    return (
      <Shell>
        <ViewTabs />
        <div className="tree-empty">
          <p>No tree selected.</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <ViewTabs />

      <div className="tree-toolbar">
        <button onClick={() => setShowSettings((s) => !s)}>Tree settings</button>

        <label className="check">
          <input
            type="checkbox"
            checked={activeView.showGhosts}
            onChange={(e) => void saveView({ ...activeView, showGhosts: e.target.checked })}
          />
          Show missing people
        </label>

        <AddToTree graph={graph} view={activeView} opts={opts} />

        {activeView.arranged && (
          <button
            onClick={() =>
              void saveView({ ...activeView, arranged: false, overrides: {}, edgeRoutes: {} })
            }
            title="Discard the arrangement and let the layout engine place everyone again"
          >
            Back to auto layout
          </button>
        )}

        {!activeView.arranged && movedCount > 0 && (
          <button
            onClick={() => void saveView({ ...activeView, overrides: {} })}
            title="Put every hand-moved person back where the layout engine put them"
          >
            Reset {movedCount} moved {movedCount === 1 ? 'person' : 'people'}
          </button>
        )}

        {routedCount > 0 && (
          <button
            onClick={() => void saveView({ ...activeView, edgeRoutes: {} })}
            title="Put every hand-routed connector back on its automatic path"
          >
            Reset {routedCount} {routedCount === 1 ? 'line' : 'lines'}
          </button>
        )}

        <span style={{ flex: 1 }} />

        {problems.length > 0 && (
          <button onClick={() => setShowProblems((s) => !s)}>
            {problems.length} {problems.length === 1 ? 'problem' : 'problems'}
          </button>
        )}
        <span className="hint">
          {activeView.arranged
            ? 'Arranged — positions are kept; add people from the button above'
            : 'Click a person to trace · click a line to bend it · drag to move'}
        </span>
      </div>

      {shown.length > 1 && (
        <div className="tree-toolbar legend">
          {shown.map((f) => (
            <span className="entry" key={f}>
              <span className="swatch" style={{ background: familyColours[f] ?? UNKNOWN_FAMILY_COLOUR }} />
              {f}
            </span>
          ))}
        </div>
      )}

      <div className="tree-body">
        <TreeCanvas graph={graph} view={activeView} families={familyColours} opts={opts} />

        {showSettings && <ViewSettings view={activeView} onClose={() => setShowSettings(false)} />}

        {showProblems && (
          <div className="tree-panel">
            <h3>Problems</h3>
            <p className="hint">
              Listed whatever the “show missing people” checkbox says — hiding them from the canvas
              is not the same as fixing them.
            </p>
            {problems.map((p, i) => (
              <div className="item" key={`${p.kind}-${p.id}-${i}`}>
                {p.message}
              </div>
            ))}
            <div style={{ marginTop: 10 }}>
              <button onClick={() => setShowProblems(false)}>Close</button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}
