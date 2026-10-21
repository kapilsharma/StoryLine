import { useDeferredValue, useMemo } from 'react'
import { countWords, formatWordCount } from '@shared/wordCount'
import { useStore } from '../store'

/**
 * The note's word count, for the bottom left of an editor (#194). Hidden when
 * the "Word count in editors" setting is off (Ctrl+Alt+W toggles it).
 *
 * Counted from a deferred copy of the text, so on a long chapter a keystroke
 * paints first and the count catches up a moment later — typing never waits on it.
 */
export function WordCount({ text }: { text: string }): JSX.Element | null {
  const { config } = useStore()
  const show = config?.settings.showWordCount ?? true
  const deferred = useDeferredValue(text)
  const words = useMemo(() => (show ? countWords(deferred) : 0), [show, deferred])
  if (!show) return null
  return (
    <span className="word-count muted small" title="Ctrl+Alt+W to hide">
      {formatWordCount(words)}
    </span>
  )
}
