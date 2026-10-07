import { useId, useState } from 'react'
import type { ColumnGroup } from '@shared/types'
import { useStore } from '../store'
import { ColumnParentPicker } from './ColumnParentPicker'

/**
 * The editor for a group in the column hierarchy — a Part, a Novel, a Chapter that
 * has scenes under it (Issue #104). Deliberately small: a group is a name, a place
 * and a note, and the note is written in the note editor, not here.
 *
 * Renaming only edits the label. The id — and with it the file the note lives in —
 * is fixed when the group is created, which is what keeps a note attached through
 * every rename and reshuffle.
 */
export function ColumnGroupForm({
  initial,
  defaultParent = null,
  levelWord,
  onSaved,
  onCancel,
  onDelete,
  onOpenNote
}: {
  /** The group being edited, or null to create one. */
  initial: ColumnGroup | null
  /** Where a new group starts out; ignored when editing. */
  defaultParent?: string | null
  /** What this group is called at its depth — "Part", "Chapter" — for the labels. */
  levelWord: string
  onSaved: () => void
  onCancel?: () => void
  onDelete?: () => void
  onOpenNote?: () => void
}): JSX.Element {
  const { saveColumnGroup } = useStore()
  const uid = useId()
  const [label, setLabel] = useState(initial?.label ?? '')
  const [parent, setParent] = useState<string | null>(initial ? (initial.parent ?? null) : defaultParent)

  const onSave = async (): Promise<void> => {
    if (!label.trim()) return
    await saveColumnGroup({
      id: initial?.id ?? '',
      type: 'colgroup',
      label: label.trim(),
      order: initial?.order ?? 0,
      ...(parent ? { parent } : {})
    })
    onSaved()
  }

  return (
    <>
      <div className="form-row">
        <label htmlFor={`${uid}-label`}>Name</label>
        <input
          id={`${uid}-label`}
          value={label}
          placeholder={`${levelWord} name`}
          onChange={(e) => setLabel(e.target.value)}
          autoFocus
        />
      </div>
      <ColumnParentPicker
        id={`${uid}-parent`}
        value={parent}
        onChange={setParent}
        moving={initial ? { kind: 'node', id: initial.id } : undefined}
      />
      <div className="form-actions">
        <button className="btn primary" onClick={onSave} disabled={!label.trim()}>
          {initial ? 'Save' : 'Create'}
        </button>
        {onOpenNote && (
          <button className="btn" onClick={onOpenNote}>
            Open note
          </button>
        )}
        {onDelete && (
          <button className="btn danger" onClick={onDelete}>
            Delete
          </button>
        )}
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </>
  )
}
