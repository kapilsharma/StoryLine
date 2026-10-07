import { useId, useState } from 'react'
import type { TimelineUnit } from '@shared/types'
import { useStore } from '../store'
import { ColumnParentPicker } from './ColumnParentPicker'

interface FormState {
  id: string
  label: string
  summary: string
  parent: string | null
  tags: string
}

const BLANK: FormState = { id: '', label: '', summary: '', parent: null, tags: '' }

function toForm(u: TimelineUnit): FormState {
  return {
    id: u.id,
    label: u.label,
    summary: u.summary ?? '',
    parent: u.parent ?? null,
    tags: (u.tags ?? []).join(', ')
  }
}

/**
 * The timeline-unit editor form — reused by the Timeline tab (side panel) and
 * the board's "+ Column" modal. Reset by remounting via a `key`.
 */
export function TimelineForm({
  initial,
  defaultParent = null,
  onSaved,
  onCancel,
  onDelete,
  onOpenInEditor,
  onBreakUp,
  breakUpLabel
}: {
  /** The unit being edited, or null to create a new one. */
  initial: TimelineUnit | null
  /** The group a new unit starts out inside; ignored when editing (Issue #104). */
  defaultParent?: string | null
  onSaved: () => void
  onCancel?: () => void
  onDelete?: () => void
  onOpenInEditor?: () => void
  /** "Break this into smaller parts" — turns the column into a group's first child. */
  onBreakUp?: () => void
  breakUpLabel?: string
}): JSX.Element {
  const { saveTimelineUnit } = useStore()
  const [form, setForm] = useState<FormState>(() =>
    initial ? toForm(initial) : { ...BLANK, parent: defaultParent }
  )
  // The form renders in two places (the Timeline tab and the board's "+ Column"
  // modal), so the label/field ids have to be unique per instance.
  const uid = useId()

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const onSave = async (): Promise<void> => {
    if (!form.label.trim()) return
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const unit: TimelineUnit = {
      id: form.id,
      label: form.label.trim(),
      order: initial?.order ?? 0,
      ...(form.summary.trim() ? { summary: form.summary.trim() } : {}),
      ...(form.parent ? { parent: form.parent } : {}),
      ...(tags.length ? { tags } : {})
    }
    await saveTimelineUnit(unit)
    onSaved()
  }

  return (
    <>
      <div className="form-row">
        <label htmlFor={`${uid}-label`}>Label</label>
        <input
          id={`${uid}-label`}
          value={form.label}
          onChange={(e) => set('label', e.target.value)}
          autoFocus
        />
      </div>
      <div className="form-row">
        <label htmlFor={`${uid}-summary`}>Summary</label>
        <textarea
          id={`${uid}-summary`}
          rows={3}
          value={form.summary}
          onChange={(e) => set('summary', e.target.value)}
        />
      </div>
      <ColumnParentPicker
        id={`${uid}-parent`}
        value={form.parent}
        onChange={(parent) => set('parent', parent)}
      />
      <div className="form-row">
        <label htmlFor={`${uid}-tags`}>Tags</label>
        <input
          id={`${uid}-tags`}
          value={form.tags}
          placeholder="comma, separated"
          onChange={(e) => set('tags', e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button className="btn primary" onClick={onSave} disabled={!form.label.trim()}>
          {initial ? 'Save' : 'Create'}
        </button>
        {onOpenInEditor && (
          <button className="btn" onClick={onOpenInEditor}>
            Open in editor
          </button>
        )}
        {onBreakUp && (
          <button className="btn" onClick={onBreakUp}>
            {breakUpLabel ?? 'Break up…'}
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
