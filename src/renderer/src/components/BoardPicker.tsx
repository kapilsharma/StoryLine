import { useStore } from '../store'

/**
 * Board selector shown at the top of the entity tabs (Characters / Timeline /
 * Notes). Since v0.2.0 those entities are per-board, so these tabs are scoped
 * to the selected board — this picker chooses which one.
 */
export function BoardPicker(): JSX.Element {
  const { boards, activeBoardId, setActiveBoard } = useStore()
  return (
    <div className="board-picker">
      <label>Board</label>
      <select value={activeBoardId ?? ''} onChange={(e) => setActiveBoard(e.target.value)}>
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  )
}
