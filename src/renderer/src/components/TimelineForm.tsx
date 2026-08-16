import { useId, useState } from 'react'
import type { TimelineUnit } from '@shared/types'
import { useStore } from '../store'

interface FormState {
  id: string
  label: string
  summary: string
  group: string
  tags: string
}

const BLANK: FormState = { id: '', label: '', summary: '', group: '', tags: '' }

function toForm(u: TimelineUnit): FormState {
  return {
    id: u.id,
    label: u.label,
    summary: u.summary ?? '',
    group: u.group ?? '',
    tags: (u.tags ?? []).join(', ')
  }
}

/**
 * The timeline-unit editor form — reused by the Timeline tab (side panel) and
 * the board's "+ Column" modal. Reset by remounting via a `key`.
 */
export function TimelineForm({
  initial,
  onSaved,
  onCancel,
  onDelete,
  onOpenInEditor
}: {
  /** The unit being edited, or null to create a new one. */
  initial: TimelineUnit | null
  onSaved: () => void
  onCancel?: () => void
  onDelete?: () => void
  onOpenInEditor?: () => void
}): JSX.Element {
  const { saveTimelineUnit } = useStore()
  const [form, setForm] = useState<FormState>(() => (initial ? toForm(initial) : BLANK))
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
      ...(form.group.trim() ? { group: form.group.trim() } : {}),
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
      <div className="form-row">
        <label htmlFor={`${uid}-group`}>Group</label>
        <input
          id={`${uid}-group`}
          value={form.group}
          placeholder="e.g. Chapter 1, Act 1 (groups columns on the board)"
          onChange={(e) => set('group', e.target.value)}
        />
      </div>
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
