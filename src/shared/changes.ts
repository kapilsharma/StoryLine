/** Filesystem change descriptors, shared between the watcher and the renderer. */

export type EntityKind = 'project' | 'character' | 'timeline' | 'note' | 'board' | 'view'
export type ChangeType = 'add' | 'change' | 'unlink'

export interface ProjectChange {
  kind: EntityKind
  /** Entity id (filename stem), or 'project' for project.json. */
  id: string
  type: ChangeType
}
