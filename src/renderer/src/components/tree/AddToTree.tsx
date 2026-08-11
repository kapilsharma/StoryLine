import { useMemo, useState } from 'react'
import type { View } from '@shared/types'
import { displayName } from '@shared/families'
import type { FamilyGraph } from '@shared/graph'
import { useStore } from '../../store'
import { layoutTree, nonMembers, suggestPosition, viewMembers, type LayoutOptions } from './layout'

/**
 * Put someone on this tree (Requirements/Feature29.md §4).
 *
 * A tree's membership is an explicit list, so nobody appears on it by accident —
 * not a character entered for context, and not a relative added to some other
 * board. This is the deliberate way in: pick a name, and they are added.
 *
 * On an *arranged* tree they are also placed once, next to whichever relatives
 * are already there, and pinned like everyone else — which is what stops one new
 * person from re-running the layout and undoing an arrangement.
 */
export function AddToTree({
  graph,
  view,
  opts
}: {
  graph: FamilyGraph
  view: View
  opts: LayoutOptions
}): JSX.Element | null {
  const { saveView, readOnly } = useStore()
  const [open, setOpen] = useState(false)

  const missing = useMemo(
    () =>
      nonMembers(graph, view)
        .map((id) => graph.byId.get(id)!)
        .sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [graph, view]
  )

  if (readOnly) return null

  const add = (id: string): void => {
    setOpen(false)
    // Membership first: on a non-arranged tree that is the whole job, because the
    // layout engine will place them.
    const members = [...viewMembers(graph, view), id]
    if (!view.arranged) {
      void saveView({ ...view, members })
      return
    }
    // Arranged: they also need a position, computed once. The automatic layout of
    // the same selection supplies the shape; the stored positions supply the
    // frame. See suggestPosition.
    const automatic = layoutTree(graph, { ...view, members, arranged: false, overrides: {} }, opts)
    const at = suggestPosition(graph, view, automatic, id)
    void saveView({ ...view, members, overrides: { ...view.overrides, [id]: at } })
  }

  return (
    <span style={{ position: 'relative' }}>
      {/* A stable label: the count goes in the tooltip, so the control does not
          rename itself as people come and go. */}
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!missing.length}
        title={
          missing.length
            ? `${missing.length} ${missing.length === 1 ? 'person is' : 'people are'} in this project but not on this tree`
            : 'Everyone in this project is already on this tree'
        }
      >
        + Add person{missing.length ? ` (${missing.length})` : ''}
      </button>

      {open && missing.length > 0 && (
        <div
          className="context-menu"
          style={{ position: 'absolute', top: '100%', left: 0, maxHeight: 320, overflow: 'auto' }}
        >
          {missing.map((c) => (
            <button key={c.id} onClick={() => add(c.id)}>
              {displayName(c)}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
