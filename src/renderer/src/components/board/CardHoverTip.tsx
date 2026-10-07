import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { placeTip, type Rect } from '../../lib/tooltip'

/**
 * A card's hover text (Issue #111), drawn beside the card. Portalled to the body
 * and fixed-positioned so the board's scroll box and zoom can neither clip nor
 * scale it; themed through the app's tokens, unlike a native `title` tooltip.
 */
export function CardHoverTip({ text, anchor }: { text: string; anchor: Rect }): JSX.Element {
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
