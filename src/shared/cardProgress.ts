/**
 * Card % complete (Issue #165) — how far along a scene is, picked in tens and
 * shown as a thin bar along the bottom of its card, red at 0% to green at 100%.
 *
 * The value is per note (`Note.progress`); absent means "not tracked", which
 * draws no bar, so 0% is a choice the author made rather than a default.
 */

/** The values the dropdown offers. */
export const PROGRESS_STEPS: number[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

/**
 * Leniently read a hand-editable `progress:` value. A number, or a string such
 * as "40" or "40%", is rounded and clamped to 0–100; anything else is absent.
 * An off-step value (35) is kept as written — it is still a fair answer.
 */
export function normalizeProgress(raw: unknown): number | undefined {
  let n: number
  if (typeof raw === 'number') n = raw
  else if (typeof raw === 'string' && raw.trim()) n = Number(raw.trim().replace(/%$/, ''))
  else return undefined
  if (!Number.isFinite(n)) return undefined
  return Math.min(100, Math.max(0, Math.round(n)))
}
