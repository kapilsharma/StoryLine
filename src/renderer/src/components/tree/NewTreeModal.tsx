import { useState } from 'react'
import type { ViewMode } from '@shared/types'
import { useStore } from '../../store'
import { Modal } from '../Modal'

/**
 * Create a family tree, choosing its layout mode up front (Issue 30). Timeline
 * mode is a one-way door — a free-flow tree can be converted to it later, never
 * the reverse — so the choice is made deliberately here rather than toggled.
 */
export function NewTreeModal({
  defaultName = '',
  onClose
}: {
  defaultName?: string
  onClose: () => void
}): JSX.Element {
  const { createView } = useStore()
  const [name, setName] = useState(defaultName)
  const [mode, setMode] = useState<ViewMode>('freeflow')

  const create = async (): Promise<void> => {
    if (!name.trim()) return
    await createView(name.trim(), null, mode)
    onClose()
  }

  return (
    <Modal title="New family tree" onClose={onClose}>
      <div className="form-row">
        <label>Name</label>
        <input
          value={name}
          autoFocus
          placeholder="Ashvale side"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
        />
      </div>

      <div className="form-row">
        <label>Layout</label>
        <label className="radio-row">
          <input
            type="radio"
            checked={mode === 'freeflow'}
            onChange={() => setMode('freeflow')}
          />
          <span>
            <strong>Free-flowing</strong>
            <span className="muted small"> — auto-arranged by generation (the usual tree)</span>
          </span>
        </label>
        <label className="radio-row">
          <input
            type="radio"
            checked={mode === 'timeline'}
            onChange={() => setMode('timeline')}
          />
          <span>
            <strong>Timeline</strong>
            <span className="muted small">
              {' '}
              — vertical axis is birth year; dated people pin to their year. Can’t be changed back.
            </span>
          </span>
        </label>
      </div>

      <div className="form-actions">
        <button className="btn primary" disabled={!name.trim()} onClick={() => void create()}>
          Create
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
