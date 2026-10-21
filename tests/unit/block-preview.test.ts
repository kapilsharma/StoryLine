import { describe, it, expect } from 'vitest'
import { previewParts, renderBlock } from '@renderer/lib/blockPreview'
import { markBrokenWikiLinks, renderFootnotes, renderMarkdown } from '@renderer/lib/markdown'

/**
 * The fullscreen editor's block-by-block preview (Issue #201). The point of
 * these is parity: a note rendered in blocks must read the same as one rendered
 * whole, including the two features that reach across blocks.
 */

describe('previewParts', () => {
  it('cuts the note into the same blocks as the live editor', () => {
    const parts = previewParts('One.\n\nTwo.\n\n# Three')
    expect(parts.blocks.map((b) => b.text)).toEqual(['One.', 'Two.', '# Three'])
  })

  it('collects reference-link definitions from anywhere in the note', () => {
    const parts = previewParts('See [the map][m].\n\n[m]: https://example.com/map\n\nMore.')
    expect(parts.linkDefs).toBe('[m]: https://example.com/map')
  })

  it('does not mistake a footnote definition for a link definition', () => {
    const parts = previewParts('Text[^1].\n\n[^1]: The note.')
    expect(parts.linkDefs).toBe('')
    expect(parts.footnotes).toEqual([{ label: '1', body: 'The note.' }])
  })

  it('ignores a definition-shaped line inside a code fence', () => {
    expect(previewParts('```\n[x]: not a link\n```').linkDefs).toBe('')
  })
})

describe('renderBlock', () => {
  it('resolves a reference link defined in another block', () => {
    const { linkDefs } = previewParts('See [the map][m].\n\n[m]: https://example.com/map')
    expect(renderBlock('See [the map][m].', linkDefs)).toContain(
      '<a href="https://example.com/map">the map</a>'
    )
  })

  it('renders a definition-only block as nothing', () => {
    const { linkDefs } = previewParts('[m]: https://example.com/map')
    expect(renderBlock('[m]: https://example.com/map', linkDefs).trim()).toBe('')
  })

  it('leaves footnote definitions for the list at the end', () => {
    const html = renderBlock('Text[^1].\n[^1]: The note.', '')
    expect(html).toContain('footnote-ref')
    expect(html).not.toContain('class="footnotes"')
  })

  it('does not append definitions to a code block', () => {
    const html = renderBlock('```\nunclosed', '[m]: https://example.com')
    expect(html).not.toContain('example.com')
  })

  it('matches a whole-note render for plain prose', () => {
    const src = '# Chapter\n\nShe *ran*.\n\nHe **stayed**.'
    const { blocks, linkDefs } = previewParts(src)
    const joined = blocks.map((b) => renderBlock(b.text, linkDefs)).join('')
    expect(joined.replace(/\s/g, '')).toBe(renderMarkdown(src).replace(/\s/g, ''))
  })
})

describe('renderFootnotes', () => {
  it('is empty when there are no footnotes', () => {
    expect(renderFootnotes([])).toBe('')
  })

  it('lists each footnote with a link back to its reference', () => {
    const html = renderFootnotes([{ label: 'a', body: '*Hi*' }])
    expect(html).toContain('<li id="fn-a"><em>Hi</em>')
    expect(html).toContain('href="#fnref-a"')
  })
})

describe('markBrokenWikiLinks', () => {
  it('marks only links to notes that do not exist', () => {
    const html = renderMarkdown('[[here]] and [[gone]]')
    const marked = markBrokenWikiLinks(html, new Set(['here']))
    expect(marked).toContain('class="wikilink" data-note-id="here"')
    expect(marked).toContain('class="wikilink broken" data-note-id="gone"')
  })
})
