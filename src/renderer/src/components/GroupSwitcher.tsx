import { readGroupManifest } from '../lib/projectGroup'

/**
 * Cross-project dropdown for a published static site that's part of a project
 * group (issue #86). Renders nothing on the desktop app (`window.__ZN_GROUP__`
 * is never set there) or for an ungrouped/single-member export.
 *
 * `currentName` is matched against each member's `project.json` name to mark
 * the current site in the list — the manifest itself carries no notion of
 * "which one is this". Two members sharing an identical project name only
 * affects which option shows as selected, never which folder a link points
 * at, so it's a cosmetic edge case rather than a broken one.
 */
export function GroupSwitcher({ currentName }: { currentName: string }): JSX.Element | null {
  const manifest = readGroupManifest()
  if (!manifest || manifest.members.length <= 1) return null

  const current = manifest.members.find((m) => m.name === currentName)

  return (
    <label className="group-switcher">
      {manifest.name}
      <select
        value={current?.folder ?? ''}
        onChange={(e) => {
          const folder = e.target.value
          // Not just `../<folder>/` — plenty of static hosts (and a plain
          // directory listing with no default-document rule) don't resolve a
          // bare folder to its index.html, so link to the file directly.
          if (folder) window.location.href = `../${folder}/index.html`
        }}
      >
        {!current && <option value="" disabled />}
        {manifest.members.map((m) => (
          <option key={m.folder} value={m.folder}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  )
}
