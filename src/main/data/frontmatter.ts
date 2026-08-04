import matter from 'gray-matter'

/**
 * Frontmatter parse/serialize. Pure (no filesystem) for testability.
 *
 * Decisions log: round-trip via gray-matter. The markdown body
 * (`## Notes` / `## Research`) is preserved verbatim; only frontmatter is
 * rewritten (see Requirements/CLAUDE.md).
 */

export interface ParsedFile {
  /** Parsed YAML frontmatter as a plain object. */
  data: Record<string, unknown>
  /** Raw markdown body, exactly as it followed the frontmatter block. */
  body: string
}

/** Parse a raw `.md` file into its frontmatter data and body. */
export function parseFrontmatter(raw: string): ParsedFile {
  const parsed = matter(raw)
  return { data: parsed.data as Record<string, unknown>, body: parsed.content }
}

/**
 * Serialize frontmatter + body back into a `.md` string.
 * The body is written unchanged; only `data` is re-emitted as YAML.
 */
export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  // Drop keys that are undefined so they don't serialize as `null`/`~`.
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) clean[k] = v
  }
  return matter.stringify(body, clean)
}
