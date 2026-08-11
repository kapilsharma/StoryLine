/**
 * What counts as "no note yet" for a character/timeline markdown body.
 *
 * Files created before issue #33 were seeded with a `## Notes` / `## Research`
 * skeleton, so "the file has a body" was true for every character ever created
 * and could not be used to decide whether anything had actually been written.
 * A body that is nothing but those empty headings is therefore treated as
 * empty — and dropped from the file the next time it is written, so the
 * boilerplate does not linger in projects that never wanted it.
 */

/** A heading that carries no information on its own — the old seed template. */
const TEMPLATE_HEADING = /^#{1,6}\s*(notes|research)\s*$/i

/** True when the body holds no prose: blank, or only empty template headings. */
export function isEmptyEntityBody(body: string): boolean {
  return body.split('\n').every((line) => {
    const trimmed = line.trim()
    return trimmed === '' || TEMPLATE_HEADING.test(trimmed)
  })
}

/** The body to persist: template-only bodies collapse to nothing. */
export function normalizeEntityBody(body: string): string {
  return isEmptyEntityBody(body) ? '' : body
}
