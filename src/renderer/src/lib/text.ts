/**
 * Small text helpers for the UI. `pluralize` handles the common English
 * endings so a user-chosen timeline-unit label (Chapter, Scene, Act, Story…)
 * reads correctly when the UI needs its plural — e.g. the Timeline tab title.
 */

export function pluralize(word: string): string {
  const w = word.trim()
  if (!w) return w
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es'
  return w + 's'
}
