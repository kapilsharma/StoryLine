import { useState } from 'react'
import type { ColumnGroup, TimelineUnit } from '@shared/types'
import type { ColumnDescendant } from '@shared/columns'
import { Modal } from './Modal'

/**
 * Confirmation for deleting a group that has things under it (Issue #104).
 *
 * The author's planning lives in these notes, so the delete is never silent and
 * never blocked: it says exactly what will go — every group and column beneath,
 * and which of them carry a note — and then does it on one deliberate click.
 */
export function DeleteGroupModal({
  group,
  descendants,
  onCancel,
  onConfirm
}: {
  group: ColumnGroup
  descendants: ColumnDescendant[]
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const nodes = descendants.filter((d) => d.kind === 'node')
  const units = descendants.filter((d) => d.kind === 'unit')
  const withNotes = descendants.filter((d) =>
    d.kind === 'node' ? d.node.hasNote : d.unit.hasNote
  ).length + (group.hasNote ? 1 : 0)

  const parts = [
    nodes.length ? `${nodes.length} group${nodes.length === 1 ? '' : 's'}` : null,
    units.length ? `${units.length} column${units.length === 1 ? '' : 's'}` : null
  ].filter(Boolean)

  return (
    <Modal title={`Delete “${group.label}”?`} onClose={onCancel}>
      <p>
        This also deletes {parts.join(' and ')} inside it
        {withNotes > 0 ? `, and ${withNotes} note${withNotes === 1 ? '' : 's'} written on them` : ''}.
        The cards on those columns are removed from the board. This can’t be undone.
      </p>
      <ul className="delete-list" aria-label="Everything that will be deleted">
        <li style={{ fontWeight: 600 }}>
          {group.label}
          {group.hasNote && <span title="Has a note"> 📝</span>}
        </li>
        {descendants.map((d) => {
          const label = d.kind === 'node' ? d.node.label : d.unit.label
          const hasNote = d.kind === 'node' ? d.node.hasNote : d.unit.hasNote
          return (
            <li
              key={`${d.kind}:${d.kind === 'node' ? d.node.id : d.unit.id}`}
              style={{ paddingLeft: `${d.depth * 1.1}rem`, fontWeight: d.kind === 'node' ? 600 : 400 }}
            >
              {label}
              {hasNote && <span title="Has a note"> 📝</span>}
            </li>
          )
        })}
      </ul>
      <div className="form-actions">
        <button className="btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button className="btn danger" onClick={onConfirm}>
          Delete everything
        </button>
      </div>
    </Modal>
  )
}

/**
 * "Break this chapter into scenes": the column becomes the first thing inside a
 * new group that takes its place. Nothing is repointed — the column keeps its id,
 * its cards and its note — so the only choice to make is the group's name and
 * whether the note it already has belongs to the column or to the new group.
 */
export function WrapColumnModal({
  unit,
  groupWord,
  onCancel,
  onConfirm
}: {
  unit: TimelineUnit
  /** What the new group is called at this depth — "Chapter", "Part". */
  groupWord: string
  onCancel: () => void
  onConfirm: (label: string, moveNote: boolean) => void
}): JSX.Element {
  const [label, setLabel] = useState(unit.label)
  const [moveNote, setMoveNote] = useState(true)

  return (
    <Modal title={`Break “${unit.label}” into smaller parts`} onClose={onCancel}>
      <p className="muted small">
        A new {groupWord.toLowerCase()} takes this column’s place, and “{unit.label}” moves inside
        it. Its cards and note stay with it.
      </p>
      <div className="form-row">
        <label htmlFor="wrap-label">New {groupWord.toLowerCase()} name</label>
        <input id="wrap-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
      </div>
      {unit.hasNote && (
        <label className="check-row">
          <input type="checkbox" checked={moveNote} onChange={(e) => setMoveNote(e.target.checked)} />{' '}
          Move the note up to the new {groupWord.toLowerCase()}
        </label>
      )}
      <div className="form-actions">
        <button
          className="btn primary"
          disabled={!label.trim()}
          onClick={() => onConfirm(label.trim(), unit.hasNote ? moveNote : false)}
        >
          Break up
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
