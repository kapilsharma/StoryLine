import { useMemo, useRef, useState } from 'react'
import type { ColumnGroup, TimelineUnit } from '@shared/types'
import {
  buildColumnTree,
  collectColumnDescendants,
  planDrop,
  refOf,
  sameRef,
  type ColumnItem,
  type ColumnRef,
  type ColumnTree,
  type DropPosition
} from '@shared/columns'
import { levelLabel, timelineLevelLabels } from '@shared/project'
import { useStore } from '../store'
import { pluralize } from '../lib/text'
import { BoardPicker } from './BoardPicker'
import { TimelineForm } from './TimelineForm'
import { ColumnGroupForm } from './ColumnGroupForm'
import { DeleteGroupModal, WrapColumnModal } from './ColumnDialogs'

const MIME_COLUMN = 'application/x-znstoryline-column'

const NO_UNITS: TimelineUnit[] = []
const NO_GROUPS: ColumnGroup[] = []

/** One line of the tree: an item, how deep it sits, and its place among its siblings. */
interface TreeRow {
  item: ColumnItem
  depth: number
  /** 1-based position among siblings. */
  position: number
  siblings: number
}

function flatten(tree: ColumnTree): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (parentId: string | null, depth: number): void => {
    const kids = tree.childrenOf(parentId)
    kids.forEach((item, i) => {
      rows.push({ item, depth, position: i + 1, siblings: kids.length })
      if (item.kind === 'node') walk(item.node.id, depth + 1)
    })
  }
  walk(null, 0)
  return rows
}

/** What is being made in the right-hand form, and where it will go. */
type Creating = { kind: 'unit' | 'node'; parent: string | null } | null

/**
 * Which third of a row the pointer is over. A group has a middle ("drop inside")
 * because it can take children; a column only has a top and a bottom.
 */
function zoneOf(e: React.DragEvent, isGroup: boolean): DropPosition {
  const rect = e.currentTarget.getBoundingClientRect()
  const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5
  if (isGroup) return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
  return y < 0.5 ? 'before' : 'after'
}

export function TimelineEditor(): JSX.Element {
  const {
    snapshot,
    activeBoard,
    deleteTimelineUnit,
    deleteColumnGroup,
    reorderColumns,
    moveColumn,
    wrapColumnInGroup,
    openEditor
  } = useStore()
  const units = activeBoard?.timeline ?? NO_UNITS
  const groups = activeBoard?.colGroups ?? NO_GROUPS
  const project = snapshot?.project
  const levels = project ? timelineLevelLabels(project) : ['Chapter']
  const word = (depth: number): string => (project ? levelLabel(project, depth) : 'Chapter')
  const leafWord = levels[levels.length - 1]

  const tree = useMemo(() => buildColumnTree(groups, units), [groups, units])
  const rows = useMemo(() => flatten(tree), [tree])

  const [selected, setSelected] = useState<ColumnRef | null>(null)
  const [creating, setCreating] = useState<Creating>(null)
  const [pendingDelete, setPendingDelete] = useState<ColumnGroup | null>(null)
  const [wrapping, setWrapping] = useState<TimelineUnit | null>(null)
  // Dragging is held in a ref as well as state: the drop handlers need the value
  // synchronously, and `dataTransfer` is not readable during dragover.
  const dragRef = useRef<ColumnRef | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hint, setHint] = useState<{ ref: ColumnRef; position: DropPosition } | null>(null)

  const selectedUnit =
    selected?.kind === 'unit' ? (units.find((u) => u.id === selected.id) ?? null) : null
  const selectedGroup =
    selected?.kind === 'node' ? (groups.find((g) => g.id === selected.id) ?? null) : null

  const startCreate = (kind: 'unit' | 'node', parent: string | null): void => {
    setCreating({ kind, parent })
    setSelected(null)
  }

  const select = (ref: ColumnRef): void => {
    setCreating(null)
    setSelected(ref)
  }

  // ── Delete ──
  const onDeleteUnit = async (): Promise<void> => {
    if (!selectedUnit) return
    if (
      !confirm(`Delete "${selectedUnit.label}"? This also removes its column and cards from all boards.`)
    )
      return
    await deleteTimelineUnit(selectedUnit.id)
    setSelected(null)
  }

  const onDeleteGroup = async (): Promise<void> => {
    if (!selectedGroup) return
    // A group with nothing in it is a light confirm; one with work inside lists it
    // first (see DeleteGroupModal) rather than deleting — or refusing — silently.
    if (collectColumnDescendants(groups, units, selectedGroup.id).length > 0) {
      setPendingDelete(selectedGroup)
      return
    }
    if (!confirm(`Delete "${selectedGroup.label}"?`)) return
    await deleteColumnGroup(selectedGroup.id)
    setSelected(null)
  }

  // ── Order ──
  const moveWithinSiblings = async (row: TreeRow, dir: -1 | 1): Promise<void> => {
    const ref = refOf(row.item)
    const parent = tree.parentOf(ref)
    const refs = tree.childrenOf(parent).map(refOf)
    const i = refs.findIndex((r) => sameRef(r, ref))
    const j = i + dir
    if (i < 0 || j < 0 || j >= refs.length) return
    ;[refs[i], refs[j]] = [refs[j], refs[i]]
    await reorderColumns(parent, refs)
  }

  // ── Drag and drop: reorder, and reparent by dropping on a group ──
  const onDragOver = (e: React.DragEvent, row: TreeRow): void => {
    const dragged = dragRef.current
    if (!dragged) return
    const target = refOf(row.item)
    const position = zoneOf(e, row.item.kind === 'node')
    if (!planDrop(tree, dragged, target, position)) {
      if (hint) setHint(null)
      return
    }
    e.preventDefault()
    if (!hint || !sameRef(hint.ref, target) || hint.position !== position) setHint({ ref: target, position })
  }

  const finishDrag = (): void => {
    dragRef.current = null
    setDragging(false)
    setHint(null)
  }

  const onDrop = (e: React.DragEvent, row: TreeRow): void => {
    e.preventDefault()
    const dragged = dragRef.current
    const plan =
      dragged && planDrop(tree, dragged, refOf(row.item), zoneOf(e, row.item.kind === 'node'))
    finishDrag()
    if (dragged && plan) void moveColumn(dragged, plan.parent, plan.index)
  }

  const isHinted = (row: TreeRow, position: DropPosition): boolean =>
    hint !== null && hint.position === position && sameRef(hint.ref, refOf(row.item))

  const hasLevels = levels.length > 1
  const selectedDepth = selected ? tree.depthOf(selected) : 0
  const editing = creating !== null || selectedUnit !== null || selectedGroup !== null

  return (
    <div className="board-scoped-tab">
      <BoardPicker />
      <div className="editor-layout">
        <aside className="entity-list">
          <div className="entity-list-head">
            <h2>{pluralize(leafWord)}</h2>
            <div className="entity-list-actions">
              <button className="btn small" onClick={() => startCreate('unit', null)}>
                + Add {leafWord.toLowerCase()}
              </button>
              {hasLevels && (
                <button className="btn small" onClick={() => startCreate('node', null)}>
                  + Add {word(0).toLowerCase()}
                </button>
              )}
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="muted small">No {pluralize(leafWord.toLowerCase())} yet.</p>
          ) : (
            <ul>
              {rows.map((row) => {
                const ref = refOf(row.item)
                const isGroup = row.item.kind === 'node'
                const label = row.item.kind === 'node' ? row.item.node.label : row.item.unit.label
                const hasNote = row.item.kind === 'node' ? row.item.node.hasNote : row.item.unit.hasNote
                const active = selected !== null && sameRef(selected, ref)
                return (
                  <li
                    key={`${ref.kind}:${ref.id}`}
                    className={[
                      'ordered-row',
                      'draggable',
                      'tl-row',
                      isGroup ? 'tl-group' : '',
                      isHinted(row, 'before') ? 'drop-before' : '',
                      isHinted(row, 'after') ? 'drop-after' : '',
                      isHinted(row, 'inside') ? 'drop-inside' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ paddingLeft: `${row.depth * 1.1}rem` }}
                    draggable
                    onDragStart={(e) => {
                      dragRef.current = ref
                      setDragging(true)
                      e.dataTransfer.setData(MIME_COLUMN, `${ref.kind}:${ref.id}`)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={finishDrag}
                    onDragOver={(e) => onDragOver(e, row)}
                    onDrop={(e) => onDrop(e, row)}
                  >
                    <button
                      className={`entity-row${active ? ' active' : ''}`}
                      onClick={() => select(ref)}
                    >
                      <span className="order-num">{row.position}</span>
                      <span className="tl-label">{label}</span>
                      {isGroup && <span className="tl-level muted small">{word(row.depth)}</span>}
                      {hasNote && (
                        <span className="entity-note-icon" title="Has a note" aria-label="Has a note">
                          📝
                        </span>
                      )}
                    </button>
                    <div className="reorder-btns">
                      <button
                        className="icon-btn"
                        aria-label={`Move ${label} up`}
                        disabled={row.position === 1}
                        onClick={() => moveWithinSiblings(row, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Move ${label} down`}
                        disabled={row.position === row.siblings}
                        onClick={() => moveWithinSiblings(row, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                )
              })}
              {/* Only while dragging: a way to drop something back out to the top
                  level without hunting for a gap between two rows. */}
              {dragging && groups.length > 0 && (
                <li
                  className="tl-root-drop"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const dragged = dragRef.current
                    finishDrag()
                    if (dragged) void moveColumn(dragged, null)
                  }}
                >
                  Drop here to move to the top level
                </li>
              )}
            </ul>
          )}
        </aside>

        <section className="entity-form">
          {!editing ? (
            <p className="muted">
              Select a {leafWord.toLowerCase()}
              {hasLevels ? ` or a ${word(0).toLowerCase()}` : ''} or add a new one.
            </p>
          ) : creating?.kind === 'node' ? (
            <ColumnGroupForm
              key={`new-group:${creating.parent ?? ''}`}
              initial={null}
              defaultParent={creating.parent}
              levelWord={word(creating.parent ? tree.depthOf({ kind: 'node', id: creating.parent }) + 1 : 0)}
              onSaved={() => setCreating(null)}
              onCancel={() => setCreating(null)}
            />
          ) : creating?.kind === 'unit' ? (
            <TimelineForm
              key={`new-unit:${creating.parent ?? ''}`}
              initial={null}
              defaultParent={creating.parent}
              onSaved={() => setCreating(null)}
              onCancel={() => setCreating(null)}
            />
          ) : selectedGroup ? (
            <>
              <ColumnGroupForm
                key={selectedGroup.id}
                initial={selectedGroup}
                levelWord={word(selectedDepth)}
                onSaved={() => undefined}
                onDelete={onDeleteGroup}
                onOpenNote={() => openEditor('colgroup', selectedGroup.id)}
              />
              <div className="form-actions add-inside">
                <span className="muted small">Add inside:</span>
                {selectedDepth + 1 < levels.length - 1 && (
                  <button
                    className="btn small"
                    onClick={() => startCreate('node', selectedGroup.id)}
                  >
                    + {word(selectedDepth + 1)}
                  </button>
                )}
                <button className="btn small" onClick={() => startCreate('unit', selectedGroup.id)}>
                  + {leafWord}
                </button>
              </div>
            </>
          ) : selectedUnit ? (
            <TimelineForm
              key={selectedUnit.id}
              initial={selectedUnit}
              onSaved={() => undefined}
              onDelete={onDeleteUnit}
              onOpenInEditor={() => openEditor('timeline', selectedUnit.id)}
              // Only offered when a deeper level has been named to break it into.
              onBreakUp={selectedDepth + 1 < levels.length ? () => setWrapping(selectedUnit) : undefined}
              breakUpLabel={`Break into ${pluralize(word(selectedDepth + 1).toLowerCase())}…`}
            />
          ) : null}
        </section>
      </div>

      {pendingDelete && (
        <DeleteGroupModal
          group={pendingDelete}
          descendants={collectColumnDescendants(groups, units, pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const id = pendingDelete.id
            setPendingDelete(null)
            setSelected(null)
            void deleteColumnGroup(id)
          }}
        />
      )}
      {wrapping && (
        <WrapColumnModal
          unit={wrapping}
          groupWord={word(tree.depthOf({ kind: 'unit', id: wrapping.id }))}
          onCancel={() => setWrapping(null)}
          onConfirm={(label, moveNote) => {
            const id = wrapping.id
            setWrapping(null)
            void wrapColumnInGroup(id, label, moveNote)
          }}
        />
      )}
    </div>
  )
}
