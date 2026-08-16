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

/**
 * The extensions added for Issues #64 (code highlighting, footnotes) and #65
 * (wiki-links), plus asset-URL rewriting for #61.
 */

describe('syntax highlighting (#64)', () => {
  it('highlights a fenced block whose language is known', () => {
    const html = renderMarkdown('```js\nconst x = 1\n```')
    expect(html).toContain('class="hljs language-js"')
    expect(html).toContain('hljs-keyword')
  })

  it('falls back to plain code for an unknown language', () => {
    const html = renderMarkdown('```notalang\nsome text\n```')
    expect(html).toContain('<code class="hljs">')
    expect(html).not.toContain('hljs-keyword')
  })

  it('escapes html inside an unhighlighted block', () => {
    expect(renderMarkdown('```\n<script>x</script>\n```')).toContain('&lt;script&gt;')
  })

  it('handles a fence with no language at all', () => {
    expect(renderMarkdown('```\nplain\n```')).toContain('<code class="hljs">plain')
  })
})

describe('footnotes (#64)', () => {
  it('renders a reference and a definition list', () => {
    const html = renderMarkdown('Text[^1]\n\n[^1]: The note.')
    expect(html).toContain('class="footnote-ref"')
    expect(html).toContain('id="fnref-1"')
    expect(html).toContain('id="fn-1"')
    expect(html).toContain('The note.')
    expect(html).toContain('ol class="footnotes"')
  })

  it('does not leave the definition in the body text', () => {
    expect(renderMarkdown('Text[^1]\n\n[^1]: The note.')).not.toContain('<p>[^1]: The note.</p>')
  })

  it('supports named labels and inline markup in the definition', () => {
    const html = renderMarkdown('See[^src]\n\n[^src]: From **C220**.')
    expect(html).toContain('id="fn-src"')
    expect(html).toContain('<strong>C220</strong>')
  })

  it('adds nothing when there are no footnotes', () => {
    expect(renderMarkdown('plain text')).not.toContain('ol class="footnotes"')
  })
})

describe('wiki-links (#65)', () => {
  it('renders [[id]] with the id as the label', () => {
    const html = renderMarkdown('see [[phase-a]] now')
    expect(html).toContain('data-note-id="phase-a"')
    expect(html).toContain('>phase-a</a>')
  })

  it('supports [[id|label]]', () => {
    const html = renderMarkdown('see [[phase-a|Phase A]]')
    expect(html).toContain('data-note-id="phase-a"')
    expect(html).toContain('>Phase A</a>')
  })

  it('escapes a crafted id rather than injecting markup', () => {
    const html = renderMarkdown('[[a"><img src=x onerror=alert(1)>]]')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&quot;')
  })

  it('leaves a lone bracket pair alone', () => {
    expect(renderMarkdown('[[]]')).not.toContain('wikilink')
  })
})

describe('asset URLs (#61)', () => {
  it('rewrites an image path through the resolver', () => {
    const html = renderMarkdown('![d](assets/x.png)', {
      boardId: 'adm',
      resolveAsset: (boardId, src) => `resolved:${boardId}:${src}`
    })
    expect(html).toContain('src="resolved:adm:assets/x.png"')
  })

  it('rewrites a link to a PDF too', () => {
    const html = renderMarkdown('[spec](assets/c220.pdf)', {
      boardId: 'adm',
      resolveAsset: (boardId, src) => `resolved:${boardId}:${src}`
    })
    expect(html).toContain('href="resolved:adm:assets/c220.pdf"')
  })

  it('leaves remote and data URLs untouched', () => {
    const html = renderMarkdown('![a](https://example.com/x.png)', {
      boardId: 'adm',
      resolveAsset: () => 'SHOULD-NOT-APPEAR'
    })
    expect(html).toContain('https://example.com/x.png')
    expect(html).not.toContain('SHOULD-NOT-APPEAR')
  })

  it('leaves paths untouched when no resolver is given', () => {
    expect(renderMarkdown('![a](assets/x.png)')).toContain('src="assets/x.png"')
  })
})

/**
 * Regression for the first real code block written in the app — PHP, which an
 * earlier hand-picked language list did not cover, so it silently rendered as
 * plain text (Issue #64 follow-up).
 */
describe('language coverage (#64)', () => {
  it('highlights php', () => {
    const html = renderMarkdown('```php\nclass Zoey {\n  const name = "Zoey";\n}\n```')
    expect(html).toContain('class="hljs language-php"')
    expect(html).toContain('hljs-')
  })

  it.each([
    ['python', 'def f():\n  return 1'],
    ['ruby', 'def f\n  1\nend'],
    ['java', 'class A {}'],
    ['csharp', 'class A {}'],
    ['cpp', 'int main() { return 0; }'],
    ['go', 'func main() {}'],
    ['rust', 'fn main() {}'],
    ['swift', 'let x = 1'],
    ['kotlin', 'val x = 1'],
    ['bash', 'echo hi'],
    ['sql', 'SELECT 1'],
    ['yaml', 'a: 1'],
    ['json', '{"a":1}'],
    ['xml', '<a></a>']
  ])('highlights %s', (lang, code) => {
    const html = renderMarkdown('```' + lang + '\n' + code + '\n```')
    expect(html).toContain(`class="hljs language-${lang}"`)
  })

  it('treats zsh as bash', () => {
    expect(renderMarkdown('```zsh\necho hi\n```')).toContain('class="hljs language-zsh"')
  })
})
