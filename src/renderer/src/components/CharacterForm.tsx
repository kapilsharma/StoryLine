import { useMemo, useState } from 'react'
import type { Character, Gender } from '@shared/types'
import { GENDERS } from '@shared/types'
import { isPartialDate } from '@shared/dates'
import { colourFor, displayName, familiesIn, familyOf } from '@shared/families'
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
  // ── Family fields ──
  family: string
  gender: Gender | ''
  birthday: string
  died: string
  maidenName: string
  father: string
  mother: string
  spouse: string[]
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
  family: '',
  gender: '',
  birthday: '',
  died: '',
  maidenName: '',
  father: '',
  mother: '',
  spouse: [],
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
    family: c.family ?? '',
    gender: c.gender ?? '',
    birthday: c.birthday ?? '',
    died: c.died ?? '',
    maidenName: c.maidenName ?? '',
    father: c.father ?? '',
    mother: c.mother ?? '',
    spouse: c.spouse ?? [],
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
  // Family fields stay absent when untouched, so a character that never appears
  // on a tree round-trips through its file unchanged.
  if (f.family.trim()) char.family = f.family.trim()
  if (f.gender) char.gender = f.gender
  if (f.birthday.trim()) char.birthday = f.birthday.trim()
  if (f.died.trim()) char.died = f.died.trim()
  if (f.maidenName.trim()) char.maidenName = f.maidenName.trim()
  if (f.father) char.father = f.father
  if (f.mother) char.mother = f.mother
  if (f.spouse.length) char.spouse = f.spouse
  if (Object.keys(custom).length) char.custom = custom
  return char
}

/**
 * The character editor form — the single source of truth for character fields,
 * reused by the Characters tab (side panel) and the board's "+ Row" modal.
 * Reset by remounting via a `key` when the edited character changes.
 *
 * The family block (Issue 29) feeds the Family tab. Two of its behaviours are
 * load-bearing rather than cosmetic:
 *
 *  - **Children edit the child's file, not this one.** The form offers a Children
 *    list because that is how people think, but saving writes `father`/`mother`
 *    onto each child — the child→parent edge is canonical, so one fact lives in
 *    one place. That write happens immediately, not on Save, because it touches
 *    other files.
 *  - **Renaming does not change the id.** Relations point at ids, so the id is
 *    frozen at creation; the explicit "Rename file" action is the only thing that
 *    moves it, and it retargets every referring relation in one batch.
 */
export function CharacterForm({
  initial,
  onSaved,
  onCancel,
  onDelete,
  onOpenInEditor,
  addToBoard = false
}: {
  /** The character being edited, or null to create a new one. */
  initial: Character | null
  /** Called after a successful save. */
  onSaved: () => void
  /**
   * Put a newly created character straight onto the board. Set by the board's
   * "+ Row"; left off by the Characters tab, where a new character is cast
   * rather than plot and joins a board only when it is put there.
   */
  addToBoard?: boolean
  /** When provided, shows a Cancel button (e.g. in the modal). */
  onCancel?: () => void
  /** When provided, shows a Delete button (edit context only). */
  onDelete?: () => void
  /** When provided, shows an "Open in editor" button (edit context only). */
  onOpenInEditor?: () => void
}): JSX.Element {
  const { saveCharacter, renameCharacter, setChildren, activeBoard, snapshot, graph } = useStore()
  const [form, setForm] = useState<FormState>(() => (initial ? toForm(initial) : BLANK))

  const all = activeBoard?.characters ?? []
  const familyColours = snapshot?.project.families ?? {}
  const knownFamilies = useMemo(() => familiesIn(all), [all])

  /** Everyone else on the board, for the parent / spouse / child pickers. */
  const others = useMemo(
    () =>
      all
        .filter((c) => c.id !== form.id)
        .slice()
        .sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [all, form.id]
  )

  /** Derived, never stored on this character — see the note above. */
  const children = useMemo(
    () => (form.id ? graph?.childrenOf.get(form.id) ?? [] : []),
    [graph, form.id]
  )

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const nameOf = (id: string): string => {
    const c = all.find((x) => x.id === id)
    return c ? displayName(c) : id
  }

  const onSave = async (): Promise<void> => {
    if (!form.name.trim()) return
    await saveCharacter(toCharacter(form), addToBoard)
    onSaved()
  }

  const toggleSpouse = (id: string): void =>
    set('spouse', form.spouse.includes(id) ? form.spouse.filter((s) => s !== id) : [...form.spouse, id])

  const dateInvalid = (value: string): boolean => Boolean(value.trim() && !isPartialDate(value.trim()))

  // Preview of what the tree will show, built from the draft rather than the
  // saved character so the Family field's effect is visible while typing.
  const preview: Character = { ...toCharacter(form), name: form.name.trim() || form.id }

  return (
    <>
      <div className="form-row">
        <label>Name</label>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </div>
      {initial && form.name.trim() && form.name.trim() !== initial.name && (
        <p className="small muted">
          The file keeps its id (<code>{initial.id}</code>) when you rename — relations point at the
          id.{' '}
          <button
            className="link-btn"
            onClick={() => void renameCharacter(initial.id, form.name.trim())}
          >
            Rename the file too
          </button>
        </p>
      )}
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
          <label>Family tree</label>
        </div>

        <div className="form-row">
          <label>Family</label>
          <input
            value={form.family}
            list="known-families"
            placeholder={familyOf(preview) || 'e.g. Ashvale'}
            onChange={(e) => set('family', e.target.value)}
          />
        </div>
        <datalist id="known-families">
          {knownFamilies.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <p className="small muted">
          <span
            className="swatch"
            style={{ background: colourFor(preview, familyColours), marginRight: 6 }}
          />
          Decides the colour on the tree, and the tree shows{' '}
          <strong>{displayName(preview) || '—'}</strong>. Left blank it is taken from the surname —
          set it explicitly for someone who kept their own surname after marrying in.
        </p>

        <div className="form-row">
          <label>Gender</label>
          <select value={form.gender} onChange={(e) => set('gender', e.target.value as Gender | '')}>
            <option value="">— not set —</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label>Born</label>
          <input
            value={form.birthday}
            placeholder="1984, 1984-06 or 1984-06-12"
            onChange={(e) => set('birthday', e.target.value)}
          />
        </div>
        {dateInvalid(form.birthday) && <p className="small error">Use YYYY, YYYY-MM or YYYY-MM-DD.</p>}

        <div className="form-row">
          <label>Died</label>
          <input
            value={form.died}
            placeholder="blank if living"
            onChange={(e) => set('died', e.target.value)}
          />
        </div>
        {dateInvalid(form.died) && <p className="small error">Use YYYY, YYYY-MM or YYYY-MM-DD.</p>}

        <div className="form-row">
          <label>Maiden name</label>
          <input value={form.maidenName} onChange={(e) => set('maidenName', e.target.value)} />
        </div>

        <div className="form-row">
          <label>Father</label>
          <select value={form.father} onChange={(e) => set('father', e.target.value)}>
            <option value="">— unknown —</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {displayName(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>Mother</label>
          <select value={form.mother} onChange={(e) => set('mother', e.target.value)}>
            <option value="">— unknown —</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {displayName(c)}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label>Spouse</label>
          <select value="" onChange={(e) => e.target.value && toggleSpouse(e.target.value)}>
            <option value="">— add a spouse —</option>
            {others
              .filter((c) => !form.spouse.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {displayName(c)}
                </option>
              ))}
          </select>
        </div>
        {form.spouse.length > 0 && (
          <div className="hidden-chips">
            {form.spouse.map((id) => (
              <span className="chip" key={id}>
                {nameOf(id)}
                <button className="icon-btn" onClick={() => toggleSpouse(id)} title="Remove">
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="small muted">Saved on both people, so the link never points one way only.</p>

        {initial && (
          <>
            <div className="form-row">
              <label>Children</label>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) void setChildren(initial.id, [...children, e.target.value])
                }}
              >
                <option value="">— add a child —</option>
                {others
                  .filter((c) => !children.includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {displayName(c)}
                    </option>
                  ))}
              </select>
            </div>
            {children.length > 0 && (
              <div className="hidden-chips">
                {children.map((id) => (
                  <span className="chip" key={id}>
                    {nameOf(id)}
                    <button
                      className="icon-btn"
                      onClick={() => void setChildren(initial.id, children.filter((c) => c !== id))}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="small muted">
              Saved straight away on the child as{' '}
              {form.gender === 'female' ? <code>mother</code> : <code>father</code>}, never here —
              one fact, one place.
            </p>
          </>
        )}
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
