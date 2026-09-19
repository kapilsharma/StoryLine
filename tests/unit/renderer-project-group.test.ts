import { describe, it, expect } from 'vitest'
import { readGroupManifest } from '@renderer/lib/projectGroup'
import { GROUP_GLOBAL } from '@shared/projectGroup'

describe('readGroupManifest', () => {
  it('returns null when the global is absent', () => {
    expect(readGroupManifest({})).toBeNull()
  })

  it('returns null for a malformed value', () => {
    expect(readGroupManifest({ [GROUP_GLOBAL]: { name: 'x' } })).toBeNull()
    expect(readGroupManifest({ [GROUP_GLOBAL]: { members: [] } })).toBeNull()
  })

  it('returns the manifest when present and well-formed', () => {
    const manifest = { name: 'My Story Universe', members: [{ name: 'Thettana', folder: 'thettana' }] }
    expect(readGroupManifest({ [GROUP_GLOBAL]: manifest })).toEqual(manifest)
  })
})
