import { marked, type Tokens } from 'marked'
import hljs from 'highlight.js/lib/common'
import {
  normalizeEditorStyles,
  type EditorStyles,
  type PreviewFont,
  type Theme
} from '@shared/config'
import { isAssetPath, type AssetResolver } from '@shared/assets'

/**
 * Markdown rendering for previews (editor + note popup) plus the CSS variables
 * that colour it.
 *
 * Beyond CommonMark + GFM, four things are added here:
 *
 *  - `==highlight==` → `<mark>` (the original custom extension).
 *  - **Fenced-code syntax highlighting** via highlight.js (Issue #64).
 *  - **Footnotes** — `[^1]` references and `[^1]: …` definitions (Issue #64).
 *  - **`[[wiki-links]]`** between notes, with optional `|label` (Issue #65).
 *
 * Math (KaTeX/MathJax) is deliberately *not* included — see the note on
 * {@link renderMarkdown}.
 */

/**
 * Fenced-code highlighting uses highlight.js's **common** bundle (Issue #64):
 * 36 languages including php, ruby, c/c++/c#, swift, kotlin and the shells.
 *
 * An earlier attempt registered a hand-picked 14 to save bundle weight, and the
 * first code block anyone wrote — php — fell straight through it to
 * unhighlighted text. The saving was ~30KB gzipped on the published page, which
 * is not worth a feature that silently does nothing for two thirds of languages.
 *
 * A language outside the set still renders as a plain, readable code block; see
 * the explicit `.hljs` colour in index.css.
 */
hljs.registerAliases(['zsh'], { languageName: 'bash' })

interface HighlightToken extends Tokens.Generic {
  type: 'highlight'
  text: string
  tokens: Tokens.Generic[]
}

interface WikiLinkToken extends Tokens.Generic {
  type: 'wikilink'
  target: string
  label: string
}

interface FootnoteRefToken extends Tokens.Generic {
  type: 'footnoteRef'
  label: string
}

/** Escape for use in an HTML attribute or text node. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

marked.use({
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      start(src: string) {
        const i = src.indexOf('==')
        return i < 0 ? undefined : i
      },
      tokenizer(src: string) {
        const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src)
        if (!m) return undefined
        const token: HighlightToken = { type: 'highlight', raw: m[0], text: m[1], tokens: [] }
        this.lexer.inline(token.text, token.tokens)
        return token
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline((token as HighlightToken).tokens)}</mark>`
      }
    },
    {
      // `[[note-id]]` or `[[note-id|Some label]]` (Issue #65).
      //
      // The target is a note's *filename stem*, matching how `related:` in
      // frontmatter already works, so the two spellings agree. Resolution
      // happens at click time in the renderer, not here: whether a note exists
      // depends on the board being viewed, and this function is board-agnostic.
      name: 'wikilink',
      level: 'inline',
      start(src: string) {
        const i = src.indexOf('[[')
        return i < 0 ? undefined : i
      },
      tokenizer(src: string) {
        const m = /^\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/.exec(src)
        if (!m) return undefined
        const target = m[1].trim()
        if (!target) return undefined
        const token: WikiLinkToken = {
          type: 'wikilink',
          raw: m[0],
          target,
          label: (m[2] ?? m[1]).trim()
        }
        return token
      },
      renderer(token) {
        const t = token as WikiLinkToken
        return `<a href="#" class="wikilink" data-note-id="${esc(t.target)}">${esc(t.label)}</a>`
      }
    },
    {
      // Footnote *reference*: `[^label]` (Issue #64). Definitions are lifted out
      // before parsing — see `extractFootnotes`.
      name: 'footnoteRef',
      level: 'inline',
      start(src: string) {
        const i = src.indexOf('[^')
        return i < 0 ? undefined : i
      },
      tokenizer(src: string) {
        const m = /^\[\^([^\]\s]+)\]/.exec(src)
        if (!m) return undefined
        const token: FootnoteRefToken = { type: 'footnoteRef', raw: m[0], label: m[1] }
        return token
      },
      renderer(token) {
        const label = (token as FootnoteRefToken).label
        const id = esc(label)
        return (
          `<sup class="footnote-ref"><a href="#fn-${id}" id="fnref-${id}">` +
          `${esc(label)}</a></sup>`
        )
      }
    }
  ],
  renderer: {
    /** Syntax-highlight fenced code when the language is one hljs knows (#64). */
    code({ text, lang }: Tokens.Code): string {
      const language = (lang ?? '').trim().split(/\s+/)[0]
      if (language && hljs.getLanguage(language)) {
        const { value } = hljs.highlight(text, { language, ignoreIllegals: true })
        return `<pre><code class="hljs language-${esc(language)}">${value}</code></pre>`
      }
      return `<pre><code class="hljs">${esc(text)}</code></pre>`
    }
  }
})

/** A footnote definition lifted out of the source before parsing. */
interface Footnote {
  label: string
  body: string
}

/**
 * Pull `[^label]: body` definitions out of the markdown.
 *
 * Done as a pre-pass rather than a block extension because a definition can run
 * over several indented lines, and marked's block tokenizer would have already
 * claimed them as a paragraph.
 */
export function extractFootnotes(md: string): { body: string; notes: Footnote[] } {
  const notes: Footnote[] = []
  const lines = md.split('\n')
  const kept: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const m = /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(lines[i])
    if (!m) {
      kept.push(lines[i])
      continue
    }
    // Continuation lines are those indented under the definition.
    const parts = [m[2]]
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
      parts.push(lines[++i].trim())
    }
    notes.push({ label: m[1], body: parts.join(' ').trim() })
  }

  return { body: kept.join('\n'), notes }
}

export interface RenderOptions {
  /**
   * Rewrites `assets/x.png` into something the host can load (Issue #61).
   * Omitted leaves the path untouched, which is what a plain markdown editor
   * outside the app would resolve.
   */
  resolveAsset?: AssetResolver
  /** Board the markdown belongs to; needed to resolve its assets. */
  boardId?: string
}

/**
 * Render markdown to HTML.
 *
 * **No math.** KaTeX/MathJax were considered for Issue #64 and left out: both
 * need web fonts, and a published export is a self-contained folder whose CSP is
 * `default-src 'self'` — shipping and wiring the font files is a bigger change
 * than the feature earns for a story-planning tool. Reopen if a project turns
 * out to need formulae.
 */
export function renderMarkdown(md: string, options: RenderOptions = {}): string {
  const { body, notes } = extractFootnotes(md)
  let html = marked.parse(body, { async: false }) as string

  if (options.resolveAsset && options.boardId) {
    html = resolveAssetUrls(html, options.boardId, options.resolveAsset)
  }

  if (notes.length > 0) {
    const items = notes
      .map((n) => {
        const id = esc(n.label)
        const inner = marked.parseInline(n.body, { async: false }) as string
        return (
          `<li id="fn-${id}">${inner} ` +
          `<a href="#fnref-${id}" class="footnote-back" aria-label="Back to reference">↩</a></li>`
        )
      })
      .join('\n')
    html += `\n<hr class="footnotes-sep" />\n<ol class="footnotes">\n${items}\n</ol>\n`
  }

  return html
}

/**
 * Rewrite `src="assets/…"` / `href="assets/…"` in rendered HTML.
 *
 * Post-processing the HTML rather than hooking marked's image renderer keeps the
 * asset concern out of the token layer, and catches links to a PDF as well as
 * inline images.
 */
export function resolveAssetUrls(html: string, boardId: string, resolve: AssetResolver): string {
  return html.replace(/(src|href)="([^"]+)"/g, (whole, attr: string, url: string) => {
    const decoded = url.replace(/&amp;/g, '&')
    return isAssetPath(decoded) ? `${attr}="${esc(resolve(boardId, decoded))}"` : whole
  })
}

const FONT_STACKS: Record<PreviewFont, string> = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, Cambria, 'Times New Roman', Times, serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
}

/**
 * Build the `--md-*` CSS custom properties from the editor-style settings for
 * the given theme. Each colour has separate light/dark values (Issue 14); the
 * active theme selects which one is emitted. Tolerant of partial/legacy
 * settings — `normalizeEditorStyles` fills gaps and expands old string colours.
 */
export function editorStyleVars(
  styles: Partial<EditorStyles> | undefined,
  theme: Theme = 'light'
): Record<string, string> {
  const s = normalizeEditorStyles(styles)
  const vars: Record<string, string> = {
    '--md-bold': s.bold[theme],
    '--md-italic': s.italic[theme],
    '--md-bolditalic': s.boldItalic[theme],
    '--md-strike': s.strikethrough[theme],
    '--md-highlight-bg': s.highlightBg[theme],
    '--md-code-bg': s.inlineCodeBg[theme],
    '--md-codeblock-bg': s.codeBlockBg[theme],
    '--md-link': s.linkColor[theme],
    '--md-quote': s.blockquoteColor[theme],
    '--md-font': FONT_STACKS[s.bodyFont] ?? FONT_STACKS.sans,
    '--md-line-height': String(s.lineHeight)
  }
  for (let i = 0; i < 6; i++) {
    const h = s.headings[i]
    vars[`--md-h${i + 1}-size`] = `${h.size}px`
    vars[`--md-h${i + 1}-color`] = h.color[theme]
  }
  return vars
}
