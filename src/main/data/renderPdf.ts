/**
 * Turn an exported Markdown document into a PDF (Issue #125).
 *
 * Electron can already print a web page to PDF, so the cheapest faithful route
 * is: Markdown → HTML (via `marked`, already a dependency) → a hidden, offscreen
 * `BrowserWindow` → `webContents.printToPDF()`. No extra dependency, no external
 * binary.
 *
 * The HTML is loaded from a short-lived temp file rather than a `data:` URL so a
 * long novel can't run into URL-length limits, and the window + file are always
 * torn down, success or failure.
 */
import { app, BrowserWindow } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { marked } from 'marked'

/** Minimal, theme-neutral print styling — readable on paper, no app chrome. */
const PRINT_CSS = `
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
    color: #1b1c1f;
    max-width: 48rem;
    margin: 0 auto;
    padding: 1rem 0;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; }
  h1 { font-size: 1.9rem; }
  h2 { font-size: 1.5rem; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
  h3 { font-size: 1.25rem; }
  h4 { font-size: 1.1rem; }
  p, ul, ol, blockquote { margin: 0.6em 0; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
  pre { background: #f4f4f5; padding: 0.75em 1em; border-radius: 6px; overflow-x: auto; }
  blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #555; margin-left: 0; }
  img { max-width: 100%; }
`

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
  )
}

export async function markdownToPdf(markdown: string, title: string): Promise<Buffer> {
  const body = await marked.parse(markdown, { gfm: true })
  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head>` +
    `<body>${body}</body></html>`

  const tmpFile = join(app.getPath('temp'), `zn-story-line-export-${randomUUID()}.html`)
  await fsp.writeFile(tmpFile, html, 'utf8')

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false }
  })
  try {
    await win.loadFile(tmpFile)
    return await win.webContents.printToPDF({ printBackground: true })
  } finally {
    win.destroy()
    await fsp.unlink(tmpFile).catch(() => undefined)
  }
}
