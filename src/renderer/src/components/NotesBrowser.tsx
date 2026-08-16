import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit, SearchKind } from '@shared/search'
import { highlightRuns, parseQuery } from '@shared/search'
import { useStore } from '../store'
import { NotePopup } from './NotePopup'
import { BoardPicker } from './BoardPicker'

/** How long to wait after the last keystroke before asking the main process. */
const DEBOUNCE_MS = 180

const KIND_LABEL: Record<SearchKind, string> = {
  note: 'Note',
  character: 'Row',
  timeline: 'Column'
}

/** Render text with the matched runs marked, without building HTML by hand. */
function Highlighted({ text, terms }: { text: string; terms: string[] }): JSX.Element {
  return (
    <>
      {highlightRuns(text, terms).map((run, i) =>
        run.hit ? <mark key={i}>{run.text}</mark> : <span key={i}>{run.text}</span>
      )}
    </>
  )
}

/**
 * The Notes tab.
 *
 * Search runs through `api.searchNotes` rather than filtering the snapshot,
 * because note bodies are not in the snapshot — `listNoteMetas` drops them so
 * opening a project stays fast (Issue #59). The same call searches every board
 * when the scope is set to All (Issue #60), which the snapshot could not do
 * either, since the store only ever holds one active board's notes.
 */
export function NotesBrowser(): JSX.Element {
  const { snapshot, boards, activeBoard, activeBoardId, setActiveBoard, openEditor, searchNotes } =
    useStore()

  const [query, setQuery] = useState('')
  const [allBoards, setAllBoards] = useState(false)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<SearchKind | null>(null)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [openNoteId, setOpenNoteId] = useState<{ boardId: string; id: string } | null>(null)

  const terms = useMemo(() => parseQuery(query), [query])

  // Tags come from the active board when scoped to it, and from every board when
  // not — so the chip row always matches what a search would actually return.
  const allTags = useMemo(() => {
    const set = new Set<string>()
    const source = allBoards ? snapshot?.boards ?? [] : activeBoard ? [activeBoard] : []
    for (const bd of source) {
      bd.notes.forEach((n) => n.tags?.forEach((t) => set.add(t)))
      bd.characters.forEach((c) => c.tags?.forEach((t) => set.add(t)))
      bd.timeline.forEach((t) => t.tags?.forEach((x) => set.add(x)))
    }
    return [...set].sort()
  }, [snapshot, activeBoard, allBoards])

  const boardName = useMemo(() => {
    const map = new Map(boards.map((b) => [b.id, b.name]))
    return (id: string): string => map.get(id) ?? id
  }, [boards])

  // Debounced, and guarded against out-of-order responses: a slow search for an
  // earlier query must not overwrite the results of a later one.
  const seq = useRef(0)
  useEffect(() => {
    const mine = ++seq.current
    const scopeBoards = allBoards ? [] : activeBoardId ? [activeBoardId] : []
    const run = async (): Promise<void> => {
      setBusy(true)
      try {
        const found = await searchNotes(query, {
          boardIds: scopeBoards,
          tag: tagFilter,
          kinds: kindFilter ? [kindFilter] : undefined
        })
        if (seq.current === mine) setHits(found)
      } finally {
        if (seq.current === mine) setBusy(false)
      }
    }
    const timer = setTimeout(run, query ? DEBOUNCE_MS : 0)
    return () => clearTimeout(timer)
  }, [query, allBoards, activeBoardId, tagFilter, kindFilter, searchNotes, snapshot])

  const open = (hit: SearchHit): void => {
    if (hit.kind === 'note') {
      // Opening a hit on another board switches to it, so "Open in editor" and
      // the popup's related-note links resolve against the right board.
      if (hit.boardId !== activeBoardId) setActiveBoard(hit.boardId)
      setOpenNoteId({ boardId: hit.boardId, id: hit.id })
    } else {
      if (hit.boardId !== activeBoardId) setActiveBoard(hit.boardId)
      openEditor(hit.kind, hit.id)
    }
  }

  const openNote = useMemo(() => {
    if (!openNoteId) return null
    const bd = snapshot?.boards.find((b) => b.board.id === openNoteId.boardId)
    return bd?.notes.find((n) => n.id === openNoteId.id) ?? null
  }, [snapshot, openNoteId])

  return (
    <div className="notes-browser">
      <BoardPicker />
      <div className="notes-toolbar">
        <input
          className="search"
          placeholder={allBoards ? 'Search every board…' : 'Search this board…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="search-scope">
          <button
            className={`tag-chip${allBoards ? '' : ' active'}`}
            onClick={() => setAllBoards(false)}
            title="Search only the board you are on"
          >
            This board
          </button>
          <button
            className={`tag-chip${allBoards ? ' active' : ''}`}
            onClick={() => setAllBoards(true)}
            title="Search every board in this project"
          >
            All boards
          </button>
        </div>
        <div className="tag-filter">
          <button
            className={`tag-chip${kindFilter === null ? ' active' : ''}`}
            onClick={() => setKindFilter(null)}
          >
            Everything
          </button>
          {(['note', 'character', 'timeline'] as SearchKind[]).map((k) => (
            <button
              key={k}
              className={`tag-chip${kindFilter === k ? ' active' : ''}`}
              onClick={() => setKindFilter(kindFilter === k ? null : k)}
            >
              {KIND_LABEL[k]}s
            </button>
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="tag-filter">
            <button
              className={`tag-chip${tagFilter === null ? ' active' : ''}`}
              onClick={() => setTagFilter(null)}
            >
              All tags
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                className={`tag-chip${tagFilter === t ? ' active' : ''}`}
                onClick={() => setTagFilter(tagFilter === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="muted small search-count">
        {busy ? 'Searching…' : `${hits.length} result${hits.length === 1 ? '' : 's'}`}
        {query && ' — matches in titles, tags and note text'}
      </p>

      {hits.length === 0 ? (
        <p className="muted placeholder">{busy ? '' : 'Nothing matches.'}</p>
      ) : (
        <ul className="note-grid">
          {hits.map((hit) => (
            <li key={`${hit.boardId}:${hit.kind}:${hit.id}`} className="note-card">
              <button className="note-card-main" onClick={() => open(hit)}>
                <span className="note-card-title">
                  <Highlighted text={hit.title} terms={terms} />
                </span>
                {hit.snippet && (
                  <span className="note-card-snippet">
                    <Highlighted text={hit.snippet} terms={terms} />
                  </span>
                )}
                <span className="note-card-tags">
                  {hit.kind !== 'note' && <span className="tag kind">{KIND_LABEL[hit.kind]}</span>}
                  {allBoards && <span className="tag board">{boardName(hit.boardId)}</span>}
                  {hit.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </span>
              </button>
              <button className="link-btn note-card-edit" onClick={() => open(hit)}>
                Open in editor
              </button>
            </li>
          ))}
        </ul>
      )}

      {openNote && (
        <NotePopup
          note={openNote}
          onClose={() => setOpenNoteId(null)}
          onOpenNote={(id) => setOpenNoteId({ boardId: openNoteId!.boardId, id })}
        />
      )}
    </div>
  )
}
