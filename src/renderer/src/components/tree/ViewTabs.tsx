import { useEffect, useState } from 'react'
import { usePrompt } from '../PromptModal'
import { useStore } from '../../store'

/**
 * The view tab strip — one tab per family tree on this board.
 *
 * Duplicate is the primary way to make a second tree, not `+`: it copies the
 * filters so "Nisha's side" starts from "Rowan's side" with the depths already
 * set. Deleting a tab deletes a camera and a filter, never a character.
 *
 * Note that nothing here uses `window.prompt` — Electron does not implement it
 * (see PromptModal). `alert`/`confirm` *are* implemented.
 */

interface Menu {
  id: string
  name: string
  x: number
  y: number
}

export function ViewTabs(): JSX.Element {
  const { views, activeViewId, setActiveView, createView, duplicateView, renameView, deleteView, readOnly } =
    useStore()
  const ask = usePrompt()
  const [menu, setMenu] = useState<Menu | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const onNew = async (): Promise<void> => {
    const name = await ask({
      title: 'New family tree',
      placeholder: 'Ashvale side',
      confirmLabel: 'Create'
    })
    if (name) await createView(name)
  }

  const onRename = async (id: string, current: string): Promise<void> => {
    const name = await ask({ title: 'Rename tree', defaultValue: current, confirmLabel: 'Rename' })
    if (name) await renameView(id, name)
  }

  const onDuplicate = async (id: string, current: string): Promise<void> => {
    const name = await ask({
      title: 'Duplicate tree',
      defaultValue: `${current} copy`,
      confirmLabel: 'Duplicate'
    })
    if (name) await duplicateView(id, name)
  }

  const onDelete = (id: string, name: string): void => {
    if (confirm(`Delete the "${name}" tree? The characters in it are not affected.`)) {
      void deleteView(id)
    }
  }

  return (
    <div className="tree-toolbar view-tabs">
      <div className="tabs">
        {views.map((v) => (
          <button
            key={v.id}
            className="tab"
            aria-selected={v.id === activeViewId}
            onClick={() => setActiveView(v.id)}
            onContextMenu={(e) => {
              if (readOnly) return
              e.preventDefault()
              setActiveView(v.id)
              setMenu({ id: v.id, name: v.name, x: e.clientX, y: e.clientY })
            }}
            title={readOnly ? v.name : 'Right-click to rename, duplicate or delete'}
          >
            {v.name}
          </button>
        ))}
        {!readOnly && (
          <button className="tab" title="New tree" onClick={() => void onNew()}>
            +
          </button>
        )}
      </div>

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => void onRename(menu.id, menu.name)}>Rename…</button>
          <button onClick={() => void onDuplicate(menu.id, menu.name)}>Duplicate…</button>
          <button onClick={() => onDelete(menu.id, menu.name)} className="danger">
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
