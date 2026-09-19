import { GROUP_GLOBAL, type GroupManifest } from '@shared/projectGroup'

/**
 * Read the manifest a grouped export's `group.js` assigned to
 * `window.__ZN_GROUP__` (issue #86). Never set by the desktop app or by an
 * ungrouped export — returns `null` rather than throwing, since "not part of
 * a group" is the common case, not an error.
 */
export function readGroupManifest(source: unknown = window): GroupManifest | null {
  const manifest = (source as Record<string, GroupManifest | undefined>)[GROUP_GLOBAL]
  if (!manifest || typeof manifest.name !== 'string' || !Array.isArray(manifest.members)) return null
  return manifest
}
