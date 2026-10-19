import { useMemo, useState } from 'react'
import type { Character } from '@shared/types'
import { parseCharacterCsv } from '@shared/characterImport'
import { Modal } from './Modal'

/** Field names as the form labels them, for the "what each column became" line. */
const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  colour: 'Colour',
  role: 'Role',
  age: 'Age',
  species: 'Species',
  group: 'Group',
  tags: 'Tags',
  rowKind: 'Kind',
  family: 'Family',
  gender: 'Gender',
  birthday: 'Birthday',
  died: 'Died',
  maidenName: 'Maiden name',
  father: 'Father',
  mother: 'Mother',
  spouse: 'Spouse'
}

/**
 * "Add multiple characters" (Issue #175): paste CSV (or cells copied from a
 * spreadsheet) with a header line, one character per line below it.
 *
 * All-or-nothing: while any row has a problem the Add button stays off and the
 * row is named, so the author fixes or removes it rather than ending up with
 * half a cast. The column line shows what each header became — a typo such as
 * "sepcies" shows up as a custom field instead of Species.
 */
export function AddCharactersModal({
  existing,
  onCancel,
  onConfirm
}: {
  /** The characters already on this board — for duplicates and family names. */
  existing: Character[]
  onCancel: () => void
  onConfirm: (characters: Character[]) => void
}): JSX.Element {
  const [text, setText] = useState('')
  const parsed = useMemo(() => parseCharacterCsv(text, existing), [text, existing])
  const n = parsed.characters.length
  const canAdd = n > 0 && parsed.errors.length === 0

  return (
    <Modal title="Add multiple characters" onClose={onCancel}>
      <p className="muted small">
        Paste CSV, or cells copied from a spreadsheet. The first line names the columns — Name is
        required; Species, Group, Family, Role, Age, Gender, Tags, Father, Mother, Spouse and others
        are recognised, and any other column is kept as a custom field. Each line below it is one
        character, added to this board.
      </p>
      <div className="form-row">
        <label htmlFor="characters-csv">Characters</label>
        <textarea
          id="characters-csv"
          rows={12}
          value={text}
          spellCheck={false}
          wrap="off"
          style={{ fontFamily: 'monospace' }}
          placeholder={'Name, Species, Group, Family\nGriffith Devoras, Mage, Council, Devoras'}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
      </div>
      {parsed.columns.length > 0 && (
        <p className="small import-columns" aria-label="Columns">
          {parsed.columns.map((col, i) => (
            <span key={i} className={col.field ? 'tag-chip' : 'tag-chip custom'}>
              {col.header || '?'} → {col.field ? FIELD_LABEL[col.field] : 'custom field'}
            </span>
          ))}
        </p>
      )}
      {parsed.errors.length > 0 ? (
        <>
          <p className="small">Nothing is added until these are fixed — correct or remove each row:</p>
          <ul className="outline-errors" role="alert" aria-label="Problems">
            {parsed.errors.map((err, i) => (
              <li key={i} className="small">
                Line {err.line}: {err.message}
              </li>
            ))}
          </ul>
        </>
      ) : (
        n > 0 && (
          <p className="muted small">
            Will add {n} character{n === 1 ? '' : 's'} to this board.
          </p>
        )
      )}
      <div className="form-actions">
        <button className="btn primary" disabled={!canAdd} onClick={() => onConfirm(parsed.characters)}>
          Add characters
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
