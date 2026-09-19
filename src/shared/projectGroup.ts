/**
 * Project groups — a static-export-only feature (docs/issue86). A hand-written
 * `projectgroup.json`, sibling to a set of project folders, lets their published
 * static sites cross-link via a dropdown. Never read by the desktop app itself;
 * only `scripts/export-static.mts` (via `src/main/data/projectGroup.ts`) and the
 * published web build (which reads the `group.js` this produces) care about it.
 */

/** Global that the generated `group.js` assigns the manifest to. */
export const GROUP_GLOBAL = '__ZN_GROUP__'

/** Bumped only if `projectgroup.json`'s shape changes in a way an older reader can't parse. */
export const PROJECT_GROUP_SCHEMA_VERSION = 1

/**
 * `projectgroup.json`, hand-written by the user in a folder whose direct
 * children are the member projects. Validated (not migrated) at export time —
 * see {@link PROJECT_GROUP_SCHEMA_VERSION}.
 */
export interface ProjectGroupFile {
  schemaVersion: number
  /** The group's display name — the dropdown's heading. */
  name: string
  /** Folder names of every member, direct children of the group root, this project included. */
  projects: string[]
}

export interface GroupManifestMember {
  /** From that member's own `project.json` `name`. */
  name: string
  /** Its folder name — also its output subfolder name, by convention. */
  folder: string
}

/**
 * What `group.js` assigns to `window.__ZN_GROUP__`. Written fresh by every
 * grouped export into the shared output parent (one file, not a copy per
 * member), so every sibling site's dropdown reads the same data.
 */
export interface GroupManifest {
  name: string
  members: GroupManifestMember[]
}
