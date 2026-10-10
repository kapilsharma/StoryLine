import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardData } from '@shared/ipc'
import { orderedLeaves } from '@shared/columns'
import { useBoardUi } from './BoardUiContext'
import { boardMembers } from './grid-utils'

interface Item {
  id: string
  label: string
}

/**
 * A section of a filter dropdown: either a named group whose checkbox toggles
 * all its members at once (Issue #140), or a single ungrouped item.
 */
type Section =
  | { kind: 'group'; key: string; label: string; items: Item[] }
  | { kind: 'item'; item: Item }

/** A checkbox that can also show the half-checked (indeterminate) state. */
function Check({
  checked,
  indeterminate,
  strong,
  label,
  onToggle
}: {
  checked: boolean
  indeterminate?: boolean
  strong?: boolean
  label: string
  onToggle: (checked: boolean) => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  // `indeterminate` is a property, not an attribute, so it has to be set on the node.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked
  }, [indeterminate, checked])
  return (
    <label className={`filter-check${strong ? ' group' : ''}`}>
      <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/**
 * A multi-select checkbox dropdown (Issue #140). A checkbox is *checked* when its
 * id is shown — i.e. not in `excluded` — so leaving everything checked is "no
 * filter". A group checkbox reflects and toggles all its members together.
 */
function MultiSelect({
  label,
  sections,
  allIds,
  excluded,
  onChange
}: {
  label: string
  sections: Section[]
  allIds: string[]
  excluded: Set<string>
  onChange: (next: Set<string>) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const shown = allIds.filter((id) => !excluded.has(id)).length
  const summary = shown === allIds.length ? 'All' : `${shown}/${allIds.length}`

  const setIncluded = (ids: string[], included: boolean): void => {
    const next = new Set(excluded)
    for (const id of ids) (included ? next.delete(id) : next.add(id))
    onChange(next)
  }

  return (
    <div className="filter-select" ref={rootRef}>
      <button
        className={`filter-select-btn${shown === allIds.length ? '' : ' active'}`}
        onClick={() => setOpen((o) => !o)}
        title={`Filter ${label.toLowerCase()}`}
      >
        {label}: <strong>{summary}</strong> <span className="caret">▾</span>
      </button>
      {open && (
        <div className="filter-popover" role="listbox">
          <div className="filter-popover-actions">
            <button className="link-btn" onClick={() => setIncluded(allIds, true)}>
              Select all
            </button>
            <button className="link-btn" onClick={() => setIncluded(allIds, false)}>
              Clear
            </button>
          </div>
          <div className="filter-popover-list">
            {sections.map((s) =>
              s.kind === 'item' ? (
                <Check
                  key={s.item.id}
                  label={s.item.label}
                  checked={!excluded.has(s.item.id)}
                  onToggle={(c) => setIncluded([s.item.id], c)}
                />
              ) : (
                <div key={s.key} className="filter-group">
                  <Check
                    strong
                    label={s.label}
                    checked={s.items.every((it) => !excluded.has(it.id))}
                    indeterminate={s.items.some((it) => !excluded.has(it.id))}
                    onToggle={(c) => setIncluded(s.items.map((it) => it.id), c)}
                  />
                  {s.items.map((it) => (
                    <Check
                      key={it.id}
                      label={it.label}
                      checked={!excluded.has(it.id)}
                      onToggle={(c) => setIncluded([it.id], c)}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Group an ordered list by a key, groups in first-appearance order, loose last. */
function toSections(items: Item[], groupOf: (item: Item) => { key: string; label: string } | null): Section[] {
  const groups = new Map<string, { label: string; items: Item[] }>()
  const groupOrder: string[] = []
  const loose: Item[] = []
  for (const item of items) {
    const g = groupOf(item)
    if (!g) {
      loose.push(item)
      continue
    }
    if (!groups.has(g.key)) {
      groups.set(g.key, { label: g.label, items: [] })
      groupOrder.push(g.key)
    }
    groups.get(g.key)!.items.push(item)
  }
  const sections: Section[] = groupOrder.map((key) => ({
    kind: 'group',
    key,
    label: groups.get(key)!.label,
    items: groups.get(key)!.items
  }))
  for (const item of loose) sections.push({ kind: 'item', item })
  return sections
}

/**
 * The filter bar below the board tabs (Issue #140): a momentary lens on a
 * crowded board. Two checkbox dropdowns narrow which rows (characters) and
 * columns (scenes) are drawn, without touching what's on disk.
 */
export function BoardFilterBar({ data }: { data: BoardData }): JSX.Element {
  const { rowFilter, colFilter, setRowFilter, setColFilter, clearFilters, filterActive } = useBoardUi()

  // The board's full cast and column list — filtering chooses *among* these, so
  // it offers everything on the board, hidden-for-now rows included.
  const charSections = useMemo<Section[]>(() => {
    const cast = boardMembers(data.board, data.characters).map((c) => ({ id: c.id, name: c.name, group: c.group }))
    return toSections(
      cast.map((c) => ({ id: c.id, label: c.name })),
      (item) => {
        const group = cast.find((c) => c.id === item.id)?.group
        return group ? { key: group, label: group } : null
      }
    )
  }, [data.board, data.characters])

  const colSections = useMemo<Section[]>(() => {
    const units = orderedLeaves(data.colGroups ?? [], data.timeline)
    const groupLabel = new Map((data.colGroups ?? []).map((g) => [g.id, g.label]))
    return toSections(
      units.map((u) => ({ id: u.id, label: u.label })),
      (item) => {
        const parent = units.find((u) => u.id === item.id)?.parent
        const label = parent ? groupLabel.get(parent) : undefined
        return parent && label ? { key: parent, label } : null
      }
    )
  }, [data.colGroups, data.timeline])

  const charIds = useMemo(() => boardMembers(data.board, data.characters).map((c) => c.id), [data.board, data.characters])
  const colIds = useMemo(
    () => orderedLeaves(data.colGroups ?? [], data.timeline).map((u) => u.id),
    [data.colGroups, data.timeline]
  )

  return (
    <div className="board-filter-bar">
      <span className="muted small">Show:</span>
      {charIds.length > 0 && (
        <MultiSelect
          label="Characters"
          sections={charSections}
          allIds={charIds}
          excluded={rowFilter}
          onChange={setRowFilter}
        />
      )}
      {colIds.length > 0 && (
        <MultiSelect
          label="Scenes"
          sections={colSections}
          allIds={colIds}
          excluded={colFilter}
          onChange={setColFilter}
        />
      )}
      {charIds.length === 0 && colIds.length === 0 && (
        <span className="muted small">Nothing to filter yet — add rows and columns first.</span>
      )}
      {filterActive && (
        <button className="chip" onClick={clearFilters} title="Clear all filters">
          Clear filters ✕
        </button>
      )}
    </div>
  )
}
