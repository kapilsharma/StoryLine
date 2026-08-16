/**
 * The main-process search index (Issues #59, #60).
 *
 * Note bodies are deliberately *not* in the project snapshot — `listNoteMetas`
 * drops them so opening a project stays fast. Search still needs them, so they
 * are read here into a per-root cache and matched with the shared, pure matcher
 * in `@shared/search`.
 *
 * Cache lifetime: invalidated whenever the app writes (every mutating IPC call
 * funnels through `snap`) and whenever the filesystem watcher reports an
 * external edit. Both hooks live in `src/main/ipc.ts`.
 */
import { SEARCH_KINDS, searchEntries, type SearchEntry, type SearchHit, type SearchScope } from '@shared/search'
import { listBoardIds, listCharacters, listNotes, listTimeline, readEntityBody } from './repository'
import { normalizeEntityBody } from '@shared/entityBody'

const cache = new Map<string, SearchEntry[]>()

/** Drop the cached index for `root`, or every root when called with nothing. */
export function invalidateSearchIndex(root?: string): void {
  if (root === undefined) cache.clear()
  else cache.delete(root)
}

/** Read every searchable body in the project. Cached; see the module comment. */
async function entriesFor(root: string): Promise<SearchEntry[]> {
  const cached = cache.get(root)
  if (cached) return cached

  const entries: SearchEntry[] = []
  for (const boardId of await listBoardIds(root)) {
    const [notes, characters, timeline] = await Promise.all([
      listNotes(root, boardId),
      listCharacters(root, boardId),
      listTimeline(root, boardId)
    ])

    for (const note of notes) {
      entries.push({
        boardId,
        kind: 'note',
        id: note.id,
        title: note.title,
        tags: note.tags ?? [],
        body: note.body ?? ''
      })
    }

    // A character's markdown body *is* its note (#33), and a timeline unit keeps
    // its seed template — so both are searchable alongside notes.
    for (const character of characters) {
      const raw = await readEntityBody(root, boardId, 'character', character.id)
      entries.push({
        boardId,
        kind: 'character',
        id: character.id,
        title: character.name,
        tags: character.tags ?? [],
        body: normalizeEntityBody(raw)
      })
    }
    for (const unit of timeline) {
      const raw = await readEntityBody(root, boardId, 'timeline', unit.id)
      entries.push({
        boardId,
        kind: 'timeline',
        id: unit.id,
        title: unit.label,
        tags: unit.tags ?? [],
        body: normalizeEntityBody(raw)
      })
    }
  }

  cache.set(root, entries)
  return entries
}

/** Run a search. `scope.boardIds` empty means "every board" (#60). */
export async function searchProject(
  root: string,
  query: string,
  scope: SearchScope = {}
): Promise<SearchHit[]> {
  const entries = await entriesFor(root)
  return searchEntries(entries, query, { kinds: SEARCH_KINDS, ...scope })
}
