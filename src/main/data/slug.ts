/**
 * Slug generation for entity ids / filenames.
 *
 * Decisions log: `id`/filename is a lowercase-kebab slug from the name/title.
 * On collision, append `-2`, `-3`, … (see Requirements/CLAUDE.md).
 */

/** Convert an arbitrary string into a lowercase-kebab slug. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    // strip combining diacritical marks
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    // non-alphanumerics become hyphens
    .replace(/[^a-z0-9]+/g, '-')
    // collapse and trim hyphens
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'untitled'
}

/**
 * Return a slug for `input` that does not collide with any value in `taken`.
 * Appends `-2`, `-3`, … until unique. `taken` is matched case-insensitively.
 */
export function uniqueSlug(input: string, taken: Iterable<string>): string {
  const used = new Set<string>()
  for (const t of taken) used.add(t.toLowerCase())

  const base = slugify(input)
  if (!used.has(base)) return base

  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}
