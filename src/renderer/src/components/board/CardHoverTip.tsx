import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { placeTip, type Rect } from '../../lib/tooltip'

/** How long the mouse rests on a card before its hover text shows (#111). */
const HOVER_TIP_DELAY = 400

/**
 * A card's hover text (Issue #111), drawn beside the card. Portalled to the body
 * and fixed-positioned so the board's scroll box and zoom can neither clip nor
 * scale it; themed through the app's tokens, unlike a native `title` tooltip.
 */
function CardHoverTip({ text, anchor }: { text: string; anchor: Rect }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Rendered hidden first, measured, then placed — its size depends on the text.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(
      placeTip(
        anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [anchor, text])

  return createPortal(
    <div
      ref={ref}
      className="card-hover-tip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {text}
    </div>,
    document.body
  )
}

/**
 * The hover tip is a single, app-wide element driven by an external store rather
 * than board state (#133). Only one card is ever hovered, so there is only ever
 * one tip; keeping it here means showing or hiding it re-renders just the host
 * below, not the whole `BoardGrid` and its thousands of cells. Cards call
 * `showCardHoverTip` / `hideCardHoverTip` directly — no props to thread, no state
 * to lift.
 */
type TipState = { text: string; anchor: Rect } | null

let current: TipState = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Show the tip for `el` after the usual rest delay. Cancels any pending show. */
export function showCardHoverTip(el: HTMLElement, text: string): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const r = el.getBoundingClientRect()
    current = { text, anchor: { left: r.left, top: r.top, width: r.width, height: r.height } }
    emit()
  }, HOVER_TIP_DELAY)
}

/** Hide the tip now and drop any pending show. Safe to call when nothing is shown. */
export function hideCardHoverTip(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (current) {
    current = null
    emit()
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const getSnapshot = (): TipState => current

/** Renders the current hover tip, if any. Mount once inside the board. */
export function CardHoverTipHost(): JSX.Element | null {
  const tip = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return tip ? <CardHoverTip text={tip.text} anchor={tip.anchor} /> : null
}
