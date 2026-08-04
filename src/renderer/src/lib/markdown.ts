import { marked, type Tokens } from 'marked'
import {
  normalizeEditorStyles,
  type EditorStyles,
  type PreviewFont,
  type Theme
} from '@shared/config'

/**
 * Markdown rendering for previews (editor + note popup) plus the CSS variables
 * that colour it. `==highlight==` isn't standard Markdown, so it's added here as
 * a small inline extension → `<mark>`.
 */

interface HighlightToken extends Tokens.Generic {
  type: 'highlight'
  text: string
  tokens: Tokens.Generic[]
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
    }
  ]
})

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string
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
