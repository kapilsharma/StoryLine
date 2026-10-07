/**
 * Card statuses (Issue #108) — where a scene stands, shown as an icon at the
 * left of its card and picked from a dropdown wherever the note is opened.
 *
 * The list is per project (`Project.cardStatuses`); the value is per note
 * (`Note.status`, an id). Every read goes through these helpers so the
 * "absent means the built-in set" default lives in one place.
 */
import type { CardStatus, Project } from './types'

/** What a project starts with — the set the issue's author was keeping by hand. */
export const DEFAULT_CARD_STATUSES: CardStatus[] = [
  { id: 'idea', icon: '💡', label: 'High-level idea done' },
  { id: 'doc', icon: '⚡', label: 'Doc created, not started' },
  { id: 'draft', icon: '🌓', label: 'Draft started' },
  { id: 'stuck', icon: '🚩', label: 'Stuck, or needs a rewrite' },
  { id: 'done', icon: '✅', label: 'Draft done' }
]

/**
 * Leniently read a hand-editable `cardStatuses` value. Not an array → undefined
 * (use the defaults); entries without a usable id are dropped, as are repeats of
 * an id, which would make two statuses indistinguishable on a note.
 */
export function normalizeCardStatuses(raw: unknown): CardStatus[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: CardStatus[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Partial<Record<keyof CardStatus, unknown>>
    const id = typeof e.id === 'string' ? e.id.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      icon: typeof e.icon === 'string' ? e.icon : '',
      label: typeof e.label === 'string' ? e.label : id
    })
  }
  return out
}

/** The project's statuses in display order, defaults applied. */
export function cardStatuses(project: Pick<Project, 'cardStatuses'>): CardStatus[] {
  return project.cardStatuses ?? DEFAULT_CARD_STATUSES
}

/** The status a note's `status:` id names, or undefined (none, or no longer defined). */
export function findCardStatus(
  statuses: CardStatus[],
  id: string | undefined
): CardStatus | undefined {
  return id ? statuses.find((s) => s.id === id) : undefined
}

export function sameCardStatuses(a: CardStatus[], b: CardStatus[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => s.id === b[i].id && s.icon === b[i].icon && s.label === b[i].label)
  )
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Tidy an edited list for saving: trim, drop rows with neither icon nor label,
 * and give a new row (empty id) a slug of its label that no other row uses.
 * An existing id is never changed — that is what keeps notes attached.
 */
export function finalizeCardStatuses(edited: CardStatus[]): CardStatus[] {
  const rows = edited
    .map((s) => ({ id: s.id.trim(), icon: s.icon.trim(), label: s.label.trim() }))
    .filter((s) => s.icon || s.label)
  const used = new Set(rows.map((s) => s.id).filter(Boolean))
  return rows.map((s) => {
    if (s.id) return s
    const base = slugify(s.label) || 'status'
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return { ...s, id }
  })
}
