import { describe, it, expect } from 'vitest'
import { isEmptyEntityBody, normalizeEntityBody } from '@shared/entityBody'

describe('entity body emptiness (Issue 33)', () => {
  it('treats a blank body as empty', () => {
    expect(isEmptyEntityBody('')).toBe(true)
    expect(isEmptyEntityBody('\n\n  \n')).toBe(true)
  })

  it('treats the old seed skeleton as empty', () => {
    expect(isEmptyEntityBody('\n## Notes\n\n\n## Research\n\n')).toBe(true)
    expect(isEmptyEntityBody('## Research\n## Notes')).toBe(true)
    expect(isEmptyEntityBody('# notes\n\n### RESEARCH\n')).toBe(true)
  })

  it('is not empty once anything has been written', () => {
    expect(isEmptyEntityBody('## Notes\n\nQuiet, precise.\n')).toBe(false)
    expect(isEmptyEntityBody('Just prose.')).toBe(false)
    // A heading the author chose is content, not boilerplate.
    expect(isEmptyEntityBody('## Backstory\n')).toBe(false)
  })

  it('collapses only empty bodies when normalizing', () => {
    expect(normalizeEntityBody('\n## Notes\n\n\n## Research\n\n')).toBe('')
    expect(normalizeEntityBody('## Notes\n\nQuiet.\n')).toBe('## Notes\n\nQuiet.\n')
  })
})
