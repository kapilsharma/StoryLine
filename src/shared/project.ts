/**
 * Project-level presentation helpers.
 *
 * `rowLabel` and `kind` are both optional on disk (Issues #62, #63): a
 * project.json written before they existed has neither, and must keep behaving
 * exactly as it did. Every read goes through these accessors so that default
 * lives in one place rather than being re-guessed at each call site.
 */
import type { CardStatus, Project, ProjectKind } from './types'
import {
  DEFAULT_CARD_STATUSES,
  cardStatuses,
  finalizeCardStatuses,
  sameCardStatuses
} from './cardStatus'

export const DEFAULT_ROW_LABEL = 'Character'
export const DEFAULT_TIMELINE_LABEL = 'Chapter'

/** The editable subset of project metadata, as the Settings form works with it. */
export interface ProjectMeta {
  name: string
  /**
   * Column level labels, top → deepest (Issue #104). One entry is a flat board —
   * what every project had before levels existed.
   */
  timelineLevelLabels: string[]
  rowLabel: string
  kind: ProjectKind
  /** Card statuses in display order (Issue #108). A new row has an empty id. */
  cardStatuses: CardStatus[]
}

/** What a board row is called here — "Character", "Topic", "Phase"… */
export function rowLabel(project: Pick<Project, 'rowLabel'>): string {
  return project.rowLabel?.trim() || DEFAULT_ROW_LABEL
}

/**
 * The column level labels, top → deepest. Always at least one: a project with no
 * `timelineLevelLabels` is a single level named by `timelineLabel`.
 */
export function timelineLevelLabels(
  project: Pick<Project, 'timelineLabel' | 'timelineLevelLabels'>
): string[] {
  const set = (project.timelineLevelLabels ?? []).map((l) => (typeof l === 'string' ? l.trim() : ''))
  if (set.length > 0 && set.some((l) => l !== '')) {
    return set.map((l, i) => l || (i === set.length - 1 ? DEFAULT_TIMELINE_LABEL : `Level ${i + 1}`))
  }
  return [project.timelineLabel?.trim() || DEFAULT_TIMELINE_LABEL]
}

/**
 * What a column at `depth` is called — "Novel", "Part", "Chapter", "Scene"…
 * A branch deeper than the configured levels reuses the deepest label rather
 * than showing nothing.
 */
export function levelLabel(
  project: Pick<Project, 'timelineLabel' | 'timelineLevelLabels'>,
  depth: number
): string {
  const labels = timelineLevelLabels(project)
  return labels[Math.max(0, Math.min(depth, labels.length - 1))]
}

/** What the deepest column level is called — "Chapter", "Scene", "Section"… */
export function timelineLabel(
  project: Pick<Project, 'timelineLabel' | 'timelineLevelLabels'>
): string {
  const labels = timelineLevelLabels(project)
  return labels[labels.length - 1]
}

/** Absent `kind` means `story`, so existing projects are unaffected. */
export function projectKind(project: Pick<Project, 'kind'>): ProjectKind {
  return project.kind === 'general' ? 'general' : 'story'
}

/**
 * Whether the family features apply: the Family tab, and the family fields on
 * the character form. False for a `general` project.
 */
export function hasFamilyFeatures(project: Pick<Project, 'kind'>): boolean {
  return projectKind(project) === 'story'
}

/** Read the editable metadata out of a project, defaults applied. */
export function readMeta(project: Project): ProjectMeta {
  return {
    name: project.name,
    timelineLevelLabels: timelineLevelLabels(project),
    rowLabel: rowLabel(project),
    kind: projectKind(project),
    cardStatuses: cardStatuses(project)
  }
}

/**
 * Fold edited metadata back into a project.
 *
 * Values equal to the default are written as `undefined` so the key is dropped
 * on save (`serializeFrontmatter`-style): a story project with "Character" rows
 * round-trips byte-identical to how it was before these fields existed. The same
 * goes for a single level, which is written as plain `timelineLabel` only.
 */
export function applyMeta(project: Project, meta: ProjectMeta): Project {
  const levels = (meta.timelineLevelLabels.length > 0 ? meta.timelineLevelLabels : [''])
    .map((l) => l.trim())
    .map((l, i, all) => l || (i === all.length - 1 ? DEFAULT_TIMELINE_LABEL : `Level ${i + 1}`))
  const statuses = finalizeCardStatuses(meta.cardStatuses)
  return {
    ...project,
    name: meta.name.trim() || project.name,
    // The deepest label, mirrored, so an older reader still names the tab sensibly.
    timelineLabel: levels[levels.length - 1],
    timelineLevelLabels: levels.length > 1 ? levels : undefined,
    rowLabel: meta.rowLabel.trim() && meta.rowLabel.trim() !== DEFAULT_ROW_LABEL ? meta.rowLabel.trim() : undefined,
    kind: meta.kind === 'general' ? 'general' : undefined,
    // The built-in set is the absent key; anything else — including none — is written.
    cardStatuses: sameCardStatuses(statuses, DEFAULT_CARD_STATUSES) ? undefined : statuses
  }
}
