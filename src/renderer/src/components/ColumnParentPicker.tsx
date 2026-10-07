import { useMemo } from 'react'
import { buildColumnTree, canMoveUnder, type ColumnRef } from '@shared/columns'
import { useStore } from '../store'

interface Props {
  id: string
  /** The group currently chosen; null = top level. */
  value: string | null
  onChange: (parent: string | null) => void
  /**
   * What is being placed. A group can't be put inside itself or anything under it,
   * so those are left out of the choices; a column can go under any group.
   */
  moving?: ColumnRef
}

/**
 * "Inside: <group>" — where a column or group sits in the hierarchy (Issue #104).
 *
 * The same control on the column form and the group form, so moving something is
 * one familiar gesture whichever kind it is. Renders nothing when the board has no
 * groups: there is no choice to make, and an empty dropdown is just noise on a
 * flat board.
 */
export function ColumnParentPicker({ id, value, onChange, moving }: Props): JSX.Element | null {
  const { activeBoard } = useStore()
  const groups = activeBoard?.colGroups
  const timeline = activeBoard?.timeline

  const options = useMemo(() => {
    if (!groups || !timeline || groups.length === 0) return []
    const tree = buildColumnTree(groups, timeline)
    const out: Array<{ id: string; label: string }> = []
    const walk = (parentId: string | null, depth: number): void => {
      for (const item of tree.childrenOf(parentId)) {
        if (item.kind !== 'node') continue
        if (!moving || canMoveUnder(tree, moving, item.node.id)) {
          out.push({ id: item.node.id, label: `${'— '.repeat(depth)}${item.node.label}` })
        }
        walk(item.node.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [groups, timeline, moving?.kind, moving?.id])

  if (options.length === 0) return null

  return (
    <div className="form-row">
      <label htmlFor={id}>Inside</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Top level</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
