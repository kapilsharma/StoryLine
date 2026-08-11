import { useMemo } from 'react'
import type { View } from '@shared/types'
import { displayName } from '@shared/families'
import { useStore } from '../../store'
import { filterSelection, viewMembers } from './layout'

/**
 * The three filters that pick a cast for a tree: root character, parent depth,
 * child depth — plus the spouse-families toggle.
 *
 * Depth `0` is what replaces a direction enum: "her side" is her as root with
 * child depth 0; "my grandchildren" is me with parent depth 0.
 *
 * Since v0.6.0 the filters are a **bulk-add helper**, not live membership: they
 * describe a set, and "Select these" writes it into the tree. A tree you have
 * curated or arranged is not going to change under you because a character was
 * entered somewhere else — which is the whole point of explicit membership.
 */
export function ViewSettings({ view, onClose }: { view: View; onClose: () => void }): JSX.Element {
  const { activeBoard, graph, saveView, readOnly } = useStore()
  const characters = [...(activeBoard?.characters ?? [])].sort((a, b) => a.name.localeCompare(b.name))

  /** What the filters currently describe, and how it differs from the tree. */
  const proposal = useMemo(() => {
    if (!graph) return null
    const wanted = filterSelection(graph, view)
    const current = viewMembers(graph, view)
    const added = wanted.filter((id) => !current.has(id))
    const removed = [...current].filter((id) => !wanted.includes(id))
    return { wanted, added, removed }
  }, [graph, view])

  /**
   * A root pointing at a character that no longer exists makes `selectCharacters`
   * fall back to showing everyone — which reads as "my filters stopped working".
   * Say so instead of silently drawing the wrong tree. Tested against the graph,
   * not the file list, because a root that survives only as a ghost still walks.
   */
  const danglingRoot = view.root && !graph?.byId.has(view.root) ? view.root : null

  const update = (patch: Partial<View>): void => void saveView({ ...view, ...patch })

  /** Empty input = unlimited (null); a number = that many generations. */
  const depthValue = (d: number | null): string => (d === null ? '' : String(d))
  const parseDepth = (raw: string): number | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isInteger(n) && n >= 0 ? n : null
  }

  return (
    <div className="tree-panel">
      <h3>{view.name}</h3>

      <div className="field">
        <label htmlFor="tree-root">Centred on</label>
        <select
          id="tree-root"
          value={danglingRoot ? '' : view.root ?? ''}
          onChange={(e) => update({ root: e.target.value || null })}
        >
          <option value="">Everyone on this board</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {displayName(c)}
            </option>
          ))}
        </select>
        {danglingRoot && (
          <div className="warn">
            This tree was centred on <code>{danglingRoot}</code>, who no longer exists on this board
            — so it is showing everyone. Pick someone else, or leave it on “Everyone”.
          </div>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="tree-up">Parent depth</label>
          <input
            id="tree-up"
            value={depthValue(view.parentDepth)}
            placeholder="all"
            onChange={(e) => update({ parentDepth: parseDepth(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="tree-down">Child depth</label>
          <input
            id="tree-down"
            value={depthValue(view.childDepth)}
            placeholder="all"
            onChange={(e) => update({ childDepth: parseDepth(e.target.value) })}
          />
        </div>
      </div>
      <p className="hint">
        Blank means no limit. <strong>0</strong> means don’t go that way at all — so ancestors-only
        is child depth 0, and descendants-only is parent depth 0.
      </p>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={view.includeSpouseFamilies}
            onChange={(e) => update({ includeSpouseFamilies: e.target.checked })}
          />{' '}
          Include spouses’ families
        </label>
        <p className="hint">
          Spouses always appear. This decides whether their parents and siblings come too — the
          difference between one side and the joined tree.
        </p>
      </div>

      {proposal && !readOnly && (
        <div className="field">
          <label>Apply these filters</label>
          <button
            disabled={!proposal.added.length && !proposal.removed.length}
            onClick={() => void saveView({ ...view, members: proposal.wanted })}
            title="Replace this tree's people with whoever the filters above describe"
          >
            {proposal.added.length || proposal.removed.length
              ? `Select these ${proposal.wanted.length} — ${describeDelta(proposal)}`
              : `Already showing these ${proposal.wanted.length}`}
          </button>
          <p className="hint">
            The filters describe a set of people; this puts that set on the tree. They are not live —
            once a tree has its people, a character added elsewhere will not appear on it until you
            add them.
          </p>
        </div>
      )}

      <div className="buttons">
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

/** "+3, −1" — what pressing "Select these" would actually do. */
function describeDelta({ added, removed }: { added: string[]; removed: string[] }): string {
  const parts: string[] = []
  if (added.length) parts.push(`+${added.length}`)
  if (removed.length) parts.push(`−${removed.length}`)
  return parts.join(', ')
}
