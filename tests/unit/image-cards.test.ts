import { describe, it, expect } from 'vitest'
import { frontmatterToNote, noteToFrontmatter } from '@main/data/mappers'
import {
  CARD_IMAGE_HEIGHT_MAX,
  CARD_IMAGE_HEIGHT_MIN,
  DEFAULT_SETTINGS,
  clampCardImageHeight,
  normalizeCardImageTitle
} from '@shared/config'
import { isImageAsset } from '@shared/assets'

/** Image cards (Issue #218): the `image:` frontmatter field and the two settings. */

describe('image frontmatter', () => {
  it('reads and writes a board asset reference', () => {
    const note = frontmatterToNote({ uid: 'n_1', title: 'T', image: ' assets/map.png ' }, 't', '')
    expect(note.image).toBe('assets/map.png')
    expect(noteToFrontmatter(note)).toMatchObject({ image: 'assets/map.png' })
  })

  it('ignores anything that is not a board asset, so the card stays a text card', () => {
    for (const image of [undefined, '', 42, 'https://x.test/a.png', '/abs/a.png', 'assets/../x.png', 'assets/a/b.png']) {
      expect(frontmatterToNote({ uid: 'n_1', title: 'T', image }, 't', '').image).toBeUndefined()
    }
  })

  it('writes nothing for a text card', () => {
    expect('image' in noteToFrontmatter({ id: 't', title: 'T', body: '' })).toBe(false)
    expect('image' in noteToFrontmatter({ id: 't', title: 'T', image: undefined, body: '' })).toBe(false)
  })
})

describe('image card settings', () => {
  it('clamps the height and falls back on nonsense', () => {
    expect(clampCardImageHeight(5)).toBe(CARD_IMAGE_HEIGHT_MIN)
    expect(clampCardImageHeight(9999)).toBe(CARD_IMAGE_HEIGHT_MAX)
    expect(clampCardImageHeight(150.4)).toBe(150)
    expect(clampCardImageHeight('tall')).toBe(DEFAULT_SETTINGS.cardImageMaxHeight)
    expect(clampCardImageHeight(undefined)).toBe(DEFAULT_SETTINGS.cardImageMaxHeight)
  })

  it('keeps a known title position and defaults the rest to right', () => {
    expect(normalizeCardImageTitle('below')).toBe('below')
    expect(normalizeCardImageTitle('none')).toBe('none')
    expect(normalizeCardImageTitle('left')).toBe('right')
    expect(DEFAULT_SETTINGS.cardImageTitle).toBe('right')
  })
})

describe('isImageAsset', () => {
  it('accepts the picture types and refuses PDFs and the rest', () => {
    expect(isImageAsset('a.PNG')).toBe(true)
    expect(isImageAsset('a.webp')).toBe(true)
    expect(isImageAsset('a.pdf')).toBe(false)
    expect(isImageAsset('a.txt')).toBe(false)
  })
})
