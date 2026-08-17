import { describe, it, expect } from 'vitest'
import {
  headingLevelAt,
  insertAt,
  setHeading,
  toggleInline,
  type MdSelection
} from '@renderer/lib/mdFormat'

/**
 * The editor toolbar's formatting actions (Issue #72).
 *
 * Written against a `|`-marked notation so a case reads as what the user sees:
 * `sel('a |b| c')` is the text `a b c` with `b` selected, and `out()` renders a
 * result back the same way. A bare caret is a single `|`.
 */
function sel(marked: string): MdSelection {
  const first = marked.indexOf('|')
  const rest = marked.indexOf('|', first + 1)
  const text = marked.replace(/\|/g, '')
  return { text, start: first, end: rest === -1 ? first : rest - 1 }
}

function out(s: MdSelection): string {
  return s.start === s.end
    ? s.text.slice(0, s.start) + '|' + s.text.slice(s.start)
    : s.text.slice(0, s.start) + '|' + s.text.slice(s.start, s.end) + '|' + s.text.slice(s.end)
}

describe('insertAt', () => {
  it('inserts at a bare caret', () => {
    expect(out(insertAt(sel('start |end'), 'X'))).toBe('start X|end')
  })

  it('replaces the selection and leaves the caret after it', () => {
    expect(out(insertAt(sel('a |bbb| c'), 'X'))).toBe('a X| c')
  })
})

describe('headingLevelAt', () => {
  it('reads the level of the line the caret is on', () => {
    const text = 'intro\n### Deep\ntail'
    expect(headingLevelAt(text, 0)).toBe(0)
    expect(headingLevelAt(text, 9)).toBe(3)
    expect(headingLevelAt(text, text.length)).toBe(0)
  })

  it('needs a space after the hashes, as CommonMark does', () => {
    expect(headingLevelAt('#nothashtag', 4)).toBe(0)
  })
})

describe('setHeading', () => {
  it('adds a heading to the caret line', () => {
    expect(setHeading(sel('one\ntw|o\nthree'), 2).text).toBe('one\n## two\nthree')
  })

  it('keeps the caret on the same character', () => {
    expect(out(setHeading(sel('tw|o'), 2))).toBe('## tw|o')
  })

  it('replaces an existing level rather than stacking hashes', () => {
    expect(setHeading(sel('## t|itle'), 4).text).toBe('#### title')
  })

  it('strips the heading at level 0', () => {
    expect(setHeading(sel('### t|itle'), 0).text).toBe('title')
  })

  it('clamps the caret to the line start when the prefix it sat in goes away', () => {
    expect(out(setHeading(sel('##| title'), 0))).toBe('|title')
  })

  it('applies to every line the selection touches', () => {
    expect(setHeading(sel('a|lpha\nbeta\ngam|ma'), 1).text).toBe('# alpha\n# beta\n# gamma')
  })

  it('leaves blank lines inside a multi-line selection alone', () => {
    expect(setHeading(sel('a|lpha\n\nbet|a'), 1).text).toBe('# alpha\n\n# beta')
  })

  it('still heads a single empty line, which is someone starting one', () => {
    expect(out(setHeading(sel('|'), 3))).toBe('### |')
  })

  it('grows the selection to cover the added prefixes', () => {
    expect(out(setHeading(sel('|alpha\nbeta|'), 1))).toBe('# |alpha\n# beta|')
  })
})

describe('toggleInline', () => {
  it('wraps the selection and keeps the text selected', () => {
    expect(out(toggleInline(sel('say |hello| now'), 'bold'))).toBe('say **|hello|** now')
  })

  it('unwraps when the markers are inside the selection', () => {
    expect(out(toggleInline(sel('say |**hello**| now'), 'bold'))).toBe('say |hello| now')
  })

  it('unwraps when the markers sit just outside the selection', () => {
    expect(out(toggleInline(sel('say **|hello|** now'), 'bold'))).toBe('say |hello| now')
  })

  it('does not demote bold to italic when italic is toggled over it', () => {
    expect(toggleInline(sel('|**hello**|'), 'italic').text).toBe('***hello***')
    expect(toggleInline(sel('**|hello|**'), 'italic').text).toBe('***hello***')
  })

  it('trims whitespace out of the selection, which would break the markers', () => {
    expect(out(toggleInline(sel('a| bold |z'), 'strikethrough'))).toBe('a ~~|bold|~~ z')
  })

  it('does nothing when only whitespace is selected', () => {
    expect(out(toggleInline(sel('a |   | z'), 'bold'))).toBe('a |   | z')
  })

  it('opens an empty pair at a bare caret and puts the caret inside', () => {
    expect(out(toggleInline(sel('note: |'), 'highlight'))).toBe('note: ==|==')
  })

  it('closes that empty pair again when clicked twice', () => {
    expect(out(toggleInline(sel('note: ==|=='), 'highlight'))).toBe('note: |')
  })

  it('handles each marker', () => {
    expect(toggleInline(sel('|x|'), 'italic').text).toBe('*x*')
    expect(toggleInline(sel('|x|'), 'strikethrough').text).toBe('~~x~~')
    expect(toggleInline(sel('|x|'), 'highlight').text).toBe('==x==')
  })

  it('treats a selection that is only the markers as text to wrap, not unwrap', () => {
    // `**` selected: too short to be a wrapped run, so it gets wrapped.
    expect(toggleInline(sel('|**|'), 'bold').text).toBe('******')
  })
})
