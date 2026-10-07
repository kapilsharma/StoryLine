import type { CardStatus } from '@shared/types'
import { findCardStatus } from '@shared/cardStatus'

interface Props {
  statuses: CardStatus[]
  /** The note's `status:` id; undefined = none. */
  value: string | undefined
  onChange: (status: string | undefined) => void
  disabled?: boolean
}

/**
 * The note's status, as a dropdown (Issue #108). Shared by the popup and the
 * side panel so the two cannot drift.
 *
 * A status id the project no longer defines is offered as its own option rather
 * than shown as "no status": the note still says it, and silently presenting it
 * as blank would invite a save that erases it.
 */
export function CardStatusSelect({ statuses, value, onChange, disabled }: Props): JSX.Element | null {
  const unknown = value !== undefined && !findCardStatus(statuses, value)
  // Nothing to choose from and nothing to show: stay out of the way.
  if (statuses.length === 0 && !unknown) return null
  return (
    <label className="card-status-select">
      <span className="muted small">Status</span>
      <select
        aria-label="Status"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">— No status —</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.icon} {s.label}
          </option>
        ))}
        {unknown && <option value={value}>{value} (no longer defined)</option>}
      </select>
    </label>
  )
}
