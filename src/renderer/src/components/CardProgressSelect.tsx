import { PROGRESS_STEPS } from '@shared/cardProgress'

interface Props {
  /** The note's `progress:` (0–100); undefined = not tracked. */
  value: number | undefined
  onChange: (progress: number | undefined) => void
  disabled?: boolean
}

/**
 * The note's % complete, as a dropdown (Issue #165). Sits after the status in
 * the popup and the side panel, so the two cannot drift.
 *
 * An off-step value written by hand (35) is offered as its own option rather
 * than snapped, so opening the note never rewrites it.
 */
export function CardProgressSelect({ value, onChange, disabled }: Props): JSX.Element {
  const offStep = value !== undefined && !PROGRESS_STEPS.includes(value)
  return (
    <label className="card-progress-select">
      <span className="muted small">Complete</span>
      <select
        aria-label="% complete"
        value={value === undefined ? '' : String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      >
        <option value="">— Not tracked —</option>
        {PROGRESS_STEPS.map((p) => (
          <option key={p} value={String(p)}>
            {p}%
          </option>
        ))}
        {offStep && <option value={String(value)}>{value}%</option>}
      </select>
    </label>
  )
}
