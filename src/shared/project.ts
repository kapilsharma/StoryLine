/**
 * Project-level presentation helpers.
 *
 * `rowLabel` and `kind` are both optional on disk (Issues #62, #63): a
 * project.json written before they existed has neither, and must keep behaving
 * exactly as it did. Every read goes through these accessors so that default
 * lives in one place rather than being re-guessed at each call site.
 */
import type { Project, ProjectKind } from './types'

export const DEFAULT_ROW_LABEL = 'Character'
export const DEFAULT_TIMELINE_LABEL = 'Chapter'

/** The editable subset of project metadata, as the Settings form works with it. */
export interface ProjectMeta {
  name: string
  timelineLabel: string
  rowLabel: string
  kind: ProjectKind
}

/** What a board row is called here — "Character", "Topic", "Phase"… */
export function rowLabel(project: Pick<Project, 'rowLabel'>): string {
  return project.rowLabel?.trim() || DEFAULT_ROW_LABEL
}

/** What a board column is called here — "Chapter", "Scene", "Section"… */
export function timelineLabel(project: Pick<Project, 'timelineLabel'>): string {
  return project.timelineLabel?.trim() || DEFAULT_TIMELINE_LABEL
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
    timelineLabel: timelineLabel(project),
    rowLabel: rowLabel(project),
    kind: projectKind(project)
  }
}

/**
 * Fold edited metadata back into a project.
 *
 * Values equal to the default are written as `undefined` so the key is dropped
 * on save (`serializeFrontmatter`-style): a story project with "Character" rows
 * round-trips byte-identical to how it was before these fields existed.
 */
export function applyMeta(project: Project, meta: ProjectMeta): Project {
  return {
    ...project,
    name: meta.name.trim() || project.name,
    timelineLabel: meta.timelineLabel.trim() || DEFAULT_TIMELINE_LABEL,
    rowLabel: meta.rowLabel.trim() && meta.rowLabel.trim() !== DEFAULT_ROW_LABEL ? meta.rowLabel.trim() : undefined,
    kind: meta.kind === 'general' ? 'general' : undefined
  }
}
