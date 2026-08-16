/**
 * Note assets — images and other files referenced from markdown (Issue #61).
 *
 * An asset lives at `boards/<boardId>/assets/<file>` and is referenced from
 * markdown with a project-relative path:
 *
 *     ![Diagram](assets/adm-cycle.png)
 *
 * That spelling is deliberate. It is what a plain markdown editor outside the
 * app resolves correctly when the file sits next to the note, it survives the
 * project folder being moved, and it carries no absolute path that would leak
 * into a published export.
 *
 * Resolving it to something a browser will load differs by host, which is what
 * {@link AssetResolver} is for:
 *
 *  - **Desktop** — the main process registers a `zn-asset://` protocol and the
 *    renderer rewrites `assets/x.png` to `zn-asset://<boardId>/x.png`. A custom
 *    scheme is needed because the renderer's CSP is `img-src 'self' data:` and
 *    `file://` is neither.
 *  - **Static export** — the exporter copies each board's `assets/` folder into
 *    the output as `assets/<boardId>/`, so a plain relative URL satisfies
 *    `'self'` with no scheme at all.
 */

/** Folder name under a board that holds its assets. */
export const ASSETS_DIR = 'assets'

/** Custom scheme the desktop app serves assets over. */
export const ASSET_SCHEME = 'zn-asset'

/** Extensions accepted on import. Images plus the documents worth linking to. */
export const ALLOWED_ASSET_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.pdf'
] as const

/** Cap on a single imported file. Keeps a published export a sane size. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024

/** An asset as stored on disk, as returned to the renderer after an import. */
export interface AssetRef {
  boardId: string
  /** Filename within the board's assets folder, e.g. `adm-cycle.png`. */
  file: string
  /** What to write in markdown, e.g. `assets/adm-cycle.png`. */
  markdownPath: string
  bytes: number
}

/** A file being imported. `data` is the raw bytes as a base64 string. */
export interface AssetImport {
  /** Original filename; only its extension and stem are used. */
  name: string
  data: string
}

/** True when `src` is a project-relative asset reference rather than a URL. */
export function isAssetPath(src: string): boolean {
  return src.startsWith(`${ASSETS_DIR}/`) || src.startsWith(`./${ASSETS_DIR}/`)
}

/** The bare filename out of an asset reference, or null if it isn't one. */
export function assetFile(src: string): string | null {
  if (!isAssetPath(src)) return null
  const file = src.replace(/^\.\//, '').slice(ASSETS_DIR.length + 1)
  // No traversal, no nesting — assets are a flat folder per board.
  return file && !file.includes('/') && !file.includes('..') ? file : null
}

/** Turns an in-markdown asset reference into a URL the current host can load. */
export type AssetResolver = (boardId: string, src: string) => string

/** Desktop: serve through the custom scheme registered in the main process. */
export const desktopAssetResolver: AssetResolver = (boardId, src) => {
  const file = assetFile(src)
  return file ? `${ASSET_SCHEME}://${boardId}/${encodeURIComponent(file)}` : src
}

/** Static export: assets are copied to `assets/<boardId>/` beside index.html. */
export const staticAssetResolver: AssetResolver = (boardId, src) => {
  const file = assetFile(src)
  return file ? `${ASSETS_DIR}/${boardId}/${encodeURIComponent(file)}` : src
}

/** True if the extension is one we accept. Case-insensitive. */
export function isAllowedAsset(name: string): boolean {
  const lower = name.toLowerCase()
  return ALLOWED_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
