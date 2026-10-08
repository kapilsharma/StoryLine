/**
 * Flatten one board into a single Markdown document for reading or printing
 * (Issue #125).
 *
 * Two independent sections, either or both:
 *
 *  - **Scenes** — the column hierarchy (Novel ▸ Part ▸ Chapter ▸ Scene…) walked
 *    depth-first, exactly the order the board draws its columns. Each tier's and
 *    each scene's *own* note (the 📝 shown in the Scene/Timeline tab) is the body.
 *  - **Plot rows** — each plot row (Issue #119) as a thread: its cards in column
 *    order, the card's title as the beat and its note body underneath.
 *
 * `includeNotes` is the outline↔full-text switch: off, only the headings/titles
 * are emitted (a skeleton); on, each heading is followed by the matching body.
 *
 * Two things keep the merged document readable (both from the first round of
 * feedback on #125):
 *
 *  - A scene/tier body that is empty — or only the `## Notes` / `## Research`
 *    seed skeleton — is dropped, using the same `isEmptyEntityBody` the rest of
 *    the app uses to decide "no note yet". Otherwise every freshly-created scene
 *    would export two stray headings.
 *  - A body's own headings are re-based so its top heading sits one level *below*
 *    the heading it is embedded under (`shiftHeadings`), clamped at H6. Without
 *    this a scene at `#####` would hold a body whose `# Foo` renders larger than
 *    the scene itself.
 *
 * Pure and shared: no Electron, no filesystem. The main process gathers the full
 * note/entity bodies (they are lazy in the live snapshot) and hands them in, so
 * this is a plain string transform the unit tests can drive directly.
 */
import type { Card, Character, ColumnGroup, Note, TimelineUnit } from './types'
import { isPlotRow } from './types'
import { buildColumnTree, orderedLeaves } from './columns'
import { isEmptyEntityBody } from './entityBody'

/** What to export and how much of it. `format` is a main-process concern (see ipc.ts). */
export interface MarkdownExportOptions {
  /** Include the column tree, each node's own note underneath. */
  scenes: boolean
  /** Include each plot row's cards in column order. */
  plotRows: boolean
  /** Emit note bodies, not just the headings/titles. */
  includeNotes: boolean
}

/** Everything the assembler needs, all resolved up front by the caller. */
export interface MarkdownExportInput {
  boardName: string
  colGroups: ColumnGroup[]
  timeline: TimelineUnit[]
  characters: Character[]
  cards: Card[]
  /** Full notes (with bodies) for the board — used to resolve plot-row cards. */
  notes: Note[]
  /** Column-group id → its note body. Only read when `scenes` is on. */
  groupBodies: Record<string, string>
  /** Timeline-unit id → its note body. Only read when `scenes` is on. */
  unitBodies: Record<string, string>
}

/** Markdown caps at six `#`; deeper tiers all render at the deepest level. */
const MAX_HEADING = 6

/** `#`×level + text, clamped to a legal heading depth. */
function heading(level: number, text: string): string {
  return `${'#'.repeat(Math.min(Math.max(level, 1), MAX_HEADING))} ${text}`.trimEnd()
}

const FENCE = /^(```|~~~)/
/** An ATX heading: 1–6 `#` then whitespace then the title. */
const ATX = /^(#{1,6})(\s.*)$/

/**
 * Re-base a body's ATX headings so its shallowest heading sits at `parentLevel + 1`,
 * preserving the body's own relative structure and clamping at H6. `#` inside a
 * fenced code block is left alone. A body with no headings comes back untouched.
 */
export function shiftHeadings(body: string, parentLevel: number): string {
  const lines = body.split('\n')

  // Smallest heading depth (= shallowest heading) outside code fences.
  let inFence = false
  let shallowest = Number.POSITIVE_INFINITY
  for (const line of lines) {
    const t = line.trimStart()
    if (FENCE.test(t)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = ATX.exec(t)
    if (m) shallowest = Math.min(shallowest, m[1].length)
  }
  if (!Number.isFinite(shallowest)) return body

  const shift = parentLevel + 1 - shallowest
  if (shift === 0) return body

  inFence = false
  return lines
    .map((line) => {
      const t = line.trimStart()
      if (FENCE.test(t)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const m = ATX.exec(t)
      if (!m) return line
      const level = Math.min(Math.max(m[1].length + shift, 1), MAX_HEADING)
      return '#'.repeat(level) + m[2]
    })
    .join('\n')
}

export function buildMarkdownExport(
  input: MarkdownExportInput,
  options: MarkdownExportOptions
): string {
  const blocks: string[] = [heading(1, input.boardName || 'Export')]

  // A scene/tier body is pushed only when it holds real prose — an empty body,
  // or the `## Notes` / `## Research` seed skeleton, counts as "no note" exactly
  // as it does everywhere else in the app — and its headings are re-based to sit
  // under the heading it follows.
  const pushEntityBody = (body: string | undefined, parentLevel: number): void => {
    if (!body || isEmptyEntityBody(body)) return
    blocks.push(shiftHeadings(body.trim(), parentLevel))
  }
  // A card's note is plain content (never seed-templated), so blank is the only
  // thing to drop; its headings are re-based the same way.
  const pushNoteBody = (body: string | undefined, parentLevel: number): void => {
    const trimmed = body?.trim()
    if (trimmed) blocks.push(shiftHeadings(trimmed, parentLevel))
  }

  if (options.scenes) {
    blocks.push(heading(2, 'Scenes'))
    const before = blocks.length
    const tree = buildColumnTree(input.colGroups, input.timeline)
    const walk = (parentId: string | null, depth: number): void => {
      const level = Math.min(3 + depth, MAX_HEADING)
      for (const item of tree.childrenOf(parentId)) {
        if (item.kind === 'node') {
          blocks.push(heading(level, item.node.label))
          if (options.includeNotes) pushEntityBody(input.groupBodies[item.node.id], level)
          walk(item.node.id, depth + 1)
        } else {
          blocks.push(heading(level, item.unit.label))
          if (options.includeNotes) pushEntityBody(input.unitBodies[item.unit.id], level)
        }
      }
    }
    walk(null, 0)
    if (blocks.length === before) blocks.push('_No scenes yet._')
  }

  if (options.plotRows) {
    blocks.push(heading(2, 'Plot rows'))
    const plotRows = input.characters.filter(isPlotRow)
    if (plotRows.length === 0) {
      blocks.push('_No plot rows yet._')
    } else {
      // A card sits on a span; its position in the read-through is where that
      // span starts in the one true column order.
      const order = new Map(orderedLeaves(input.colGroups, input.timeline).map((u, i) => [u.id, i]))
      const unitLabel = new Map(input.timeline.map((u) => [u.id, u.label]))
      const noteByUid = new Map(
        input.notes.filter((n): n is Note & { uid: string } => Boolean(n.uid)).map((n) => [n.uid, n])
      )
      for (const row of plotRows) {
        blocks.push(heading(3, row.name))
        const rowCards = input.cards
          .filter((c) => c.rowId === row.id)
          .sort(
            (a, b) =>
              (order.get(a.colStart) ?? Number.POSITIVE_INFINITY) -
              (order.get(b.colStart) ?? Number.POSITIVE_INFINITY)
          )
        for (const card of rowCards) {
          const note = noteByUid.get(card.noteUid)
          const title = note?.title?.trim() || '(untitled)'
          const scene = unitLabel.get(card.colStart)?.trim()
          blocks.push(heading(4, scene ? `${title} — ${scene}` : title))
          if (options.includeNotes) pushNoteBody(note?.body, 4)
        }
      }
    }
  }

  return blocks.join('\n\n') + '\n'
}
