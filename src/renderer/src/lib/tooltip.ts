/** A rectangle in viewport (client) coordinates. */
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Space kept between the anchor and the tip, and between the tip and the window edge. */
export const TIP_GAP = 6

/**
 * Where to put a tooltip for `anchor` (Issue #111). Below the anchor, left edges
 * aligned; flipped above when it would run off the bottom and there is more room
 * up there; slid left (never past the left edge) when it would run off the right.
 * Pure, so it is tested without a layout engine.
 */
export function placeTip(
  anchor: Rect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const below = anchor.top + anchor.height + TIP_GAP
  const above = anchor.top - TIP_GAP - tip.height
  const fitsBelow = below + tip.height <= viewport.height - TIP_GAP
  const roomAbove = anchor.top
  const roomBelow = viewport.height - (anchor.top + anchor.height)
  const top = fitsBelow || roomBelow >= roomAbove ? below : Math.max(TIP_GAP, above)

  const maxLeft = viewport.width - TIP_GAP - tip.width
  const left = Math.max(TIP_GAP, Math.min(anchor.left, maxLeft))
  return { left, top }
}
