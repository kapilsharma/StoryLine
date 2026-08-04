import { describe, it, expect } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from '@main/data/frontmatter'
import {
  frontmatterToCharacter,
  characterToFrontmatter,
  frontmatterToNote,
  noteToFrontmatter,
  frontmatterToTimelineUnit,
  timelineUnitToFrontmatter
} from '@main/data/mappers'

describe('frontmatter round-trip', () => {
  it('parses frontmatter and body', () => {
    const raw = '---\ntitle: Hi\n---\n\nBody text\n'
    const { data, body } = parseFrontmatter(raw)
    expect(data.title).toBe('Hi')
    expect(body).toContain('Body text')
  })

  it('preserves the body verbatim when only frontmatter changes', () => {
    const raw = '---\nid: kapil\nname: Kapil\n---\n\n## Notes\n\nHand-written.\n'
    const { body } = parseFrontmatter(raw)
    const out = serializeFrontmatter({ id: 'kapil', name: 'Kapil Sharma' }, body)
    expect(out).toContain('Hand-written.')
    expect(out).toContain('name: Kapil Sharma')
  })

  it('drops undefined keys instead of emitting null', () => {
    const out = serializeFrontmatter({ a: 1, b: undefined }, 'x')
    expect(out).not.toContain('b:')
  })
})

describe('character mapper', () => {
  it('round-trips known fields, group and custom', () => {
    const fm = characterToFrontmatter({
      id: 'k',
      type: 'character',
      name: 'K',
      colour: '#fff',
      group: 'Fae',
      custom: { homeland: 'North' }
    })
    const back = frontmatterToCharacter(fm, 'k')
    expect(back.group).toBe('Fae')
    expect(back.custom?.homeland).toBe('North')
  })

  it('defaults missing required fields gracefully', () => {
    const c = frontmatterToCharacter({}, 'fallback')
    expect(c.id).toBe('fallback')
    expect(c.name).toBe('fallback')
    expect(c.type).toBe('character')
  })
})

describe('timeline mapper', () => {
  it('keeps group and order', () => {
    const u = frontmatterToTimelineUnit({ label: 'X', order: 2, group: 'Act 1' }, 'x')
    expect(u.group).toBe('Act 1')
    expect(u.order).toBe(2)
  })

  it('ignores the retired `type` field — not read, not preserved as custom, dropped on write', () => {
    // A leftover `type:` from a pre-v0.6.1 file (or external edit) must not resurface.
    const u = frontmatterToTimelineUnit({ type: 'chapter', label: 'X', order: 1 }, 'x')
    expect('type' in u).toBe(false)
    expect(u.custom).toBeUndefined()
    expect('type' in timelineUnitToFrontmatter(u)).toBe(false)
  })
})

describe('note related normalization', () => {
  it('coerces a bare string to {file, comment:null}', () => {
    const n = frontmatterToNote({ title: 'T', related: ['wolf-ch4.md'] }, 'n', '')
    expect(n.related).toEqual([{ file: 'wolf-ch4.md', comment: null }])
  })
  it('keeps object form and nulls a missing comment', () => {
    const n = frontmatterToNote(
      { title: 'T', related: [{ file: 'a.md', comment: 'x' }, { file: 'b.md' }] },
      'n',
      ''
    )
    expect(n.related).toEqual([
      { file: 'a.md', comment: 'x' },
      { file: 'b.md', comment: null }
    ])
  })
  it('writes object form back', () => {
    const fm = noteToFrontmatter({
      id: 'n',
      title: 'T',
      related: [{ file: 'a.md', comment: null }],
      body: ''
    })
    expect(fm.related).toEqual([{ file: 'a.md', comment: null }])
  })
})
