/**
 * App-level configuration — stored outside any project folder (in Electron's
 * userData dir). Holds recent projects and global preferences (Requirements §12).
 */

export type ExternalEditor = 'vscode' | 'obsidian' | 'system'
export type Theme = 'light' | 'dark'
/** Which side the rendered preview sits on in the dedicated editor. */
export type PreviewPosition = 'left' | 'right'

export interface RecentProject {
  name: string
  /** Absolute path to the project folder. */
  path: string
  /** ISO date of the last time it was opened. */
  lastOpened: string
}

export interface AppSettings {
  /** @deprecated External editing was removed in v0.4.0; kept for config back-compat. */
  editor: ExternalEditor
  /** @deprecated External editing was removed in v0.4.0; kept for config back-compat. */
  obsidianVault: string | null
  theme: Theme
  /** Base font size (px) for board card text at 100% zoom; scales with zoom. */
  cardFontSize: number
  /** Side the preview pane sits on in the dedicated editor. */
  previewPosition: PreviewPosition
  /** Colours/sizes for the markdown preview. */
  editorStyles: EditorStyles
}

/** Clamp range for the card font size, shared by UI and rendering. */
export const CARD_FONT_MIN = 9
export const CARD_FONT_MAX = 24

export type PreviewFont = 'sans' | 'serif' | 'mono'

/** A colour that can differ between the light and dark themes (Issue 14). */
export interface ThemeColor {
  light: string
  dark: string
}

/** One heading level's style in the markdown preview. Size is theme-independent. */
export interface HeadingStyle {
  /** Font size in px. */
  size: number
  color: ThemeColor
}

/** Configurable colours/sizes for the markdown preview (editor + note popup). */
export interface EditorStyles {
  /** H1–H6, index 0 = H1. */
  headings: HeadingStyle[]
  bold: ThemeColor
  italic: ThemeColor
  boldItalic: ThemeColor
  strikethrough: ThemeColor
  /** `==highlight==` background. */
  highlightBg: ThemeColor
  /** Inline `code` background. */
  inlineCodeBg: ThemeColor
  /** Fenced code-block background. */
  codeBlockBg: ThemeColor
  linkColor: ThemeColor
  /** Blockquote accent (left border + text tint). */
  blockquoteColor: ThemeColor
  bodyFont: PreviewFont
  lineHeight: number
}

/** Colour-valued keys of {@link EditorStyles} (everything except headings/font/line-height). */
export type EditorColorKey =
  | 'bold'
  | 'italic'
  | 'boldItalic'
  | 'strikethrough'
  | 'highlightBg'
  | 'inlineCodeBg'
  | 'codeBlockBg'
  | 'linkColor'
  | 'blockquoteColor'

/**
 * Tasteful, colourful defaults with a distinct palette per theme: brighter,
 * higher-contrast text colours and darker backgrounds for the dark theme.
 */
export const DEFAULT_EDITOR_STYLES: EditorStyles = {
  headings: [
    { size: 28, color: { light: '#3b82f6', dark: '#60a5fa' } },
    { size: 24, color: { light: '#8b5cf6', dark: '#a78bfa' } },
    { size: 20, color: { light: '#06b6d4', dark: '#22d3ee' } },
    { size: 17, color: { light: '#10b981', dark: '#34d399' } },
    { size: 15, color: { light: '#f59e0b', dark: '#fbbf24' } },
    { size: 14, color: { light: '#ec4899', dark: '#f472b6' } }
  ],
  bold: { light: '#1d4ed8', dark: '#93c5fd' },
  italic: { light: '#7c3aed', dark: '#c4b5fd' },
  boldItalic: { light: '#be123c', dark: '#fda4af' },
  strikethrough: { light: '#9ca3af', dark: '#6b7280' },
  highlightBg: { light: '#fef08a', dark: '#78350f' },
  inlineCodeBg: { light: '#eef2ff', dark: '#312e5b' },
  codeBlockBg: { light: '#f1f5f9', dark: '#1e293b' },
  linkColor: { light: '#2563eb', dark: '#60a5fa' },
  blockquoteColor: { light: '#94a3b8', dark: '#64748b' },
  bodyFont: 'sans',
  lineHeight: 1.6
}

/**
 * Coerce a possibly-legacy editor-styles object into the current per-theme
 * shape. Pre-Issue-14 configs stored each colour as a single string; those are
 * expanded to `{ light, dark }` (same value both ways) so nothing is lost.
 * Missing fields fall back to {@link DEFAULT_EDITOR_STYLES}.
 */
export function normalizeEditorStyles(raw: unknown): EditorStyles {
  const toThemeColor = (v: unknown, fallback: ThemeColor): ThemeColor => {
    if (typeof v === 'string') return { light: v, dark: v }
    if (v && typeof v === 'object') {
      const o = v as Partial<ThemeColor>
      return {
        light: typeof o.light === 'string' ? o.light : fallback.light,
        dark: typeof o.dark === 'string' ? o.dark : fallback.dark
      }
    }
    return fallback
  }

  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<string, unknown>>
  const d = DEFAULT_EDITOR_STYLES

  const rawHeadings = Array.isArray(src.headings) ? src.headings : []
  const headings = d.headings.map((dh, i) => {
    const rh = (rawHeadings[i] ?? {}) as { size?: unknown; color?: unknown }
    return {
      size: typeof rh.size === 'number' ? rh.size : dh.size,
      color: toThemeColor(rh.color, dh.color)
    }
  })

  const colorKeys: EditorColorKey[] = [
    'bold',
    'italic',
    'boldItalic',
    'strikethrough',
    'highlightBg',
    'inlineCodeBg',
    'codeBlockBg',
    'linkColor',
    'blockquoteColor'
  ]
  const colors = {} as Record<EditorColorKey, ThemeColor>
  for (const k of colorKeys) colors[k] = toThemeColor(src[k], d[k])

  const bodyFont =
    src.bodyFont === 'serif' || src.bodyFont === 'mono' || src.bodyFont === 'sans'
      ? src.bodyFont
      : d.bodyFont

  return {
    headings,
    ...colors,
    bodyFont,
    lineHeight: typeof src.lineHeight === 'number' ? src.lineHeight : d.lineHeight
  }
}

export interface AppConfig {
  recents: RecentProject[]
  settings: AppSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  editor: 'vscode',
  obsidianVault: null,
  theme: 'light',
  cardFontSize: 13,
  previewPosition: 'left',
  editorStyles: DEFAULT_EDITOR_STYLES
}
