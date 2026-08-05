import { useState } from 'react'
import type { Character } from '@shared/types'
import { useStore } from '../store'

/** Editable form model — mirrors a Character plus an ordered list of custom fields. */
interface FormState {
  id: string
  name: string
  colour: string
  role: string
  age: string
  species: string
  group: string
  tags: string
  custom: Array<{ key: string; value: string }>
}

const BLANK: FormState = {
  id: '',
  name: '',
  colour: '#4A90D9',
  role: '',
  age: '',
  species: '',
  group: '',
  tags: '',
  custom: []
}

function toForm(c: Character): FormState {
  return {
    id: c.id,
    name: c.name,
    colour: c.colour,
    role: c.role ?? '',
    age: c.age != null ? String(c.age) : '',
    species: c.species ?? '',
    group: c.group ?? '',
    tags: (c.tags ?? []).join(', '),
    custom: Object.entries(c.custom ?? {}).map(([key, value]) => ({ key, value: String(value) }))
  }
}

function toCharacter(f: FormState): Character {
  const tags = f.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const custom: Record<string, unknown> = {}
  for (const { key, value } of f.custom) {
    const k = key.trim()
    if (k) custom[k] = value
  }
  const char: Character = { id: f.id, type: 'character', name: f.name.trim(), colour: f.colour }
  if (f.role.trim()) char.role = f.role.trim()
  if (f.age.trim() && !Number.isNaN(Number(f.age))) char.age = Number(f.age)
  if (f.species.trim()) char.species = f.species.trim()
  if (f.group.trim()) char.group = f.group.trim()
  if (tags.length) char.tags = tags
  if (Object.keys(custom).length) char.custom = custom
  return char
}

/**
 * The character editor form — the single source of truth for character fields,
 * reused by the Characters tab (side panel) and the board's "+ Row" modal.
 * Reset by remounting via a `key` when the edited character changes.
 */
export function CharacterForm({
  initial,
  onSaved,
  onCancel,
  onDelete,
  onOpenInEditor
}: {
  /** The character being edited, or null to create a new one. */
  initial: Character | null
  /** Called after a successful save. */
  onSaved: () => void
  /** When provided, shows a Cancel button (e.g. in the modal). */
  onCancel?: () => void
  /** When provided, shows a Delete button (edit context only). */
  onDelete?: () => void
  /** When provided, shows an "Open in editor" button (edit context only). */
  onOpenInEditor?: () => void
}): JSX.Element {
  const { saveCharacter } = useStore()
  const [form, setForm] = useState<FormState>(() => (initial ? toForm(initial) : BLANK))

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const onSave = async (): Promise<void> => {
    if (!form.name.trim()) return
    await saveCharacter(toCharacter(form))
    onSaved()
  }

  return (
    <>
      <div className="form-row">
        <label>Name</label>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </div>
      <div className="form-row">
        <label>Colour</label>
        <div className="colour-field">
          <input type="color" value={form.colour} onChange={(e) => set('colour', e.target.value)} />
          <input value={form.colour} onChange={(e) => set('colour', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label>Role</label>
        <input value={form.role} onChange={(e) => set('role', e.target.value)} />
      </div>
      <div className="form-row">
        <label>Age</label>
        <input type="number" value={form.age} onChange={(e) => set('age', e.target.value)} />
      </div>
      <div className="form-row">
        <label>Species</label>
        <input value={form.species} onChange={(e) => set('species', e.target.value)} />
      </div>
      <div className="form-row">
        <label>Group</label>
        <input
          value={form.group}
          placeholder="e.g. Humans, Fae (groups rows on the board)"
          onChange={(e) => set('group', e.target.value)}
        />
      </div>
      <div className="form-row">
        <label>Tags</label>
        <input
          value={form.tags}
          placeholder="comma, separated"
          onChange={(e) => set('tags', e.target.value)}
        />
      </div>

      <div className="custom-fields">
        <div className="custom-head">
          <label>Custom fields</label>
          <button
            className="btn small"
            onClick={() => set('custom', [...form.custom, { key: '', value: '' }])}
          >
            + Field
          </button>
        </div>
        {form.custom.map((field, i) => (
          <div className="custom-row" key={i}>
            <input
              placeholder="key"
              value={field.key}
              onChange={(e) =>
                set(
                  'custom',
                  form.custom.map((c, j) => (j === i ? { ...c, key: e.target.value } : c))
                )
              }
            />
            <input
              placeholder="value"
              value={field.value}
              onChange={(e) =>
                set(
                  'custom',
                  form.custom.map((c, j) => (j === i ? { ...c, value: e.target.value } : c))
                )
              }
            />
            <button
              className="icon-btn"
              onClick={() => set('custom', form.custom.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="form-actions">
        <button className="btn primary" onClick={onSave} disabled={!form.name.trim()}>
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
