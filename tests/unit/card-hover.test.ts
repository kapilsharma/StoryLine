import { describe, it, expect } from 'vitest'
import { frontmatterToNote, noteToFrontmatter } from '@main/data/mappers'
import { parseFrontmatter, serializeFrontmatter } from '@main/data/frontmatter'
import { placeTip, TIP_GAP } from '@renderer/lib/tooltip'

/** Card hover text (Issue #111): the `hover:` frontmatter field and where its tooltip goes. */

describe('hover frontmatter', () => {
  it('reads and writes it, trimmed at the ends', () => {
    const note = frontmatterToNote({ uid: 'n_1', title: 'T', hover: '  Ana lies.  ' }, 't', '')
    expect(note.hover).toBe('Ana lies.')
    expect(noteToFrontmatter(note)).toMatchObject({ hover: 'Ana lies.' })
  })

  it('treats absent, blank or non-string as no hover text, and writes nothing', () => {
    for (const hover of [undefined, '', '   \n ', 42]) {
      const note = frontmatterToNote({ uid: 'n_1', title: 'T', hover }, 't', '')
      expect(note.hover).toBeUndefined()
    }
    expect('hover' in noteToFrontmatter({ id: 't', title: 'T', hover: '  ', body: '' })).toBe(false)
  })

  it('keeps line breaks through a full file round trip', () => {
    const hover = 'Ana lies about the letter.\nSets up chapter 12.'
    const raw = serializeFrontmatter(noteToFrontmatter({ id: 't', title: 'T', hover, body: '' }), 'Body')
    const { data, body } = parseFrontmatter(raw)
    expect(frontmatterToNote(data, 't', body).hover).toBe(hover)
  })
})

describe('placeTip', () => {
  const viewport = { width: 1000, height: 800 }
  const tip = { width: 200, height: 60 }

  it('sits below the anchor, left edges aligned', () => {
    const anchor = { left: 100, top: 100, width: 150, height: 50 }
    expect(placeTip(anchor, tip, viewport)).toEqual({ left: 100, top: 150 + TIP_GAP })
  })

  it('flips above when it would run off the bottom', () => {
    const anchor = { left: 100, top: 720, width: 150, height: 50 }
    expect(placeTip(anchor, tip, viewport)).toEqual({ left: 100, top: 720 - TIP_GAP - 60 })
  })

  it('stays below when there is even less room above', () => {
    const anchor = { left: 100, top: 20, width: 150, height: 760 }
    expect(placeTip(anchor, tip, viewport).top).toBe(780 + TIP_GAP)
  })

  it('slides left to stay inside the window, but never past its left edge', () => {
    const anchor = { left: 900, top: 100, width: 150, height: 50 }
    expect(placeTip(anchor, tip, viewport).left).toBe(1000 - TIP_GAP - 200)
    expect(placeTip({ ...anchor, left: -40 }, tip, viewport).left).toBe(TIP_GAP)
    expect(placeTip(anchor, { width: 2000, height: 60 }, viewport).left).toBe(TIP_GAP)
  })
})
