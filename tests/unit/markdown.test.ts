import { describe, it, expect } from 'vitest'
import { renderMarkdown, editorStyleVars } from '@renderer/lib/markdown'
import { DEFAULT_EDITOR_STYLES } from '@shared/config'

describe('renderMarkdown', () => {
  it('renders standard markdown (bold)', () => {
    expect(renderMarkdown('a **b** c')).toContain('<strong>b</strong>')
  })

  it('renders ==highlight== as <mark> (custom extension)', () => {
    const html = renderMarkdown('see ==this== now')
    expect(html).toContain('<mark>this</mark>')
  })

  it('supports inline formatting inside a highlight', () => {
    const html = renderMarkdown('==**bold** inside==')
    expect(html).toContain('<mark>')
    expect(html).toContain('<strong>bold</strong>')
  })
})

describe('editorStyleVars', () => {
  it('produces --md-* variables using the light theme colours by default', () => {
    const vars = editorStyleVars(DEFAULT_EDITOR_STYLES)
    expect(vars['--md-h1-size']).toBe('28px')
    expect(vars['--md-h1-color']).toBe(DEFAULT_EDITOR_STYLES.headings[0].color.light)
    expect(vars['--md-h6-size']).toBe('14px')
    expect(vars['--md-highlight-bg']).toBe(DEFAULT_EDITOR_STYLES.highlightBg.light)
    expect(vars['--md-link']).toBe(DEFAULT_EDITOR_STYLES.linkColor.light)
    expect(vars['--md-line-height']).toBe('1.6')
    expect(vars['--md-font']).toContain('sans-serif')
  })

  it('emits the dark-theme colour when theme is dark', () => {
    const vars = editorStyleVars(DEFAULT_EDITOR_STYLES, 'dark')
    expect(vars['--md-h1-color']).toBe(DEFAULT_EDITOR_STYLES.headings[0].color.dark)
    expect(vars['--md-bold']).toBe(DEFAULT_EDITOR_STYLES.bold.dark)
    expect(vars['--md-codeblock-bg']).toBe(DEFAULT_EDITOR_STYLES.codeBlockBg.dark)
  })

  it('falls back to defaults for missing/partial settings', () => {
    const vars = editorStyleVars({})
    expect(vars['--md-h1-color']).toBe(DEFAULT_EDITOR_STYLES.headings[0].color.light)
    expect(vars['--md-bold']).toBe(DEFAULT_EDITOR_STYLES.bold.light)
  })

  it('expands a legacy single-string colour to both themes', () => {
    // Pre-Issue-14 config shape: colours were plain strings.
    const legacy = { bold: '#123456' } as never
    expect(editorStyleVars(legacy, 'light')['--md-bold']).toBe('#123456')
    expect(editorStyleVars(legacy, 'dark')['--md-bold']).toBe('#123456')
  })
})
