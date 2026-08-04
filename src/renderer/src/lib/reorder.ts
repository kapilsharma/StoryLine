/**
 * Move `draggedId` so it sits immediately before `targetId` in the list.
 * Returns a new array; returns the input unchanged if either id is missing or
 * they are the same. Used for drag-and-drop list reordering.
 */
export function moveBefore(ids: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) return ids
  if (!ids.includes(draggedId) || !ids.includes(targetId)) return ids
  const without = ids.filter((id) => id !== draggedId)
  const at = without.indexOf(targetId)
  without.splice(at, 0, draggedId)
  return without
}

/**
 * Move `draggedId` so it sits immediately after `targetId`. Same guarantees as
 * {@link moveBefore}; used for horizontal drag-and-drop where a drop on the
 * right half of a target should place the item after it (browser-tab feel).
 */
export function moveAfter(ids: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) return ids
  if (!ids.includes(draggedId) || !ids.includes(targetId)) return ids
  const without = ids.filter((id) => id !== draggedId)
  const at = without.indexOf(targetId)
  without.splice(at + 1, 0, draggedId)
  return without
}
