import { describe, it, expect } from 'vitest'
import {
  ASSETS_DIR,
  ASSET_SCHEME,
  assetFile,
  desktopAssetResolver,
  isAllowedAsset,
  isAssetPath,
  staticAssetResolver
} from '@shared/assets'

/**
 * Note assets (Issue #61).
 *
 * The path spelling is deliberately the one a plain markdown editor resolves,
 * with each host rewriting it at render time — so most of what matters here is
 * that a crafted path cannot escape the board's assets folder.
 */

describe('isAssetPath', () => {
  it('accepts the bare and dot-prefixed forms', () => {
    expect(isAssetPath('assets/x.png')).toBe(true)
    expect(isAssetPath('./assets/x.png')).toBe(true)
  })

  it('rejects URLs and unrelated paths', () => {
    expect(isAssetPath('https://example.com/x.png')).toBe(false)
    expect(isAssetPath('data:image/png;base64,AAAA')).toBe(false)
    expect(isAssetPath('../assets/x.png')).toBe(false)
    expect(isAssetPath('notes/x.md')).toBe(false)
  })
})

describe('assetFile', () => {
  it('returns the bare filename', () => {
    expect(assetFile('assets/adm-cycle.png')).toBe('adm-cycle.png')
    expect(assetFile('./assets/adm-cycle.png')).toBe('adm-cycle.png')
  })

  it('refuses traversal and nesting', () => {
    expect(assetFile('assets/../../secret')).toBeNull()
    expect(assetFile('assets/sub/x.png')).toBeNull()
    expect(assetFile('assets/')).toBeNull()
  })

  it('returns null for a non-asset path', () => {
    expect(assetFile('https://example.com/x.png')).toBeNull()
  })
})

describe('resolvers', () => {
  it('desktop rewrites to the custom scheme', () => {
    expect(desktopAssetResolver('adm', 'assets/x.png')).toBe(`${ASSET_SCHEME}://adm/x.png`)
  })

  it('static rewrites to a relative per-board folder', () => {
    expect(staticAssetResolver('adm', 'assets/x.png')).toBe(`${ASSETS_DIR}/adm/x.png`)
  })

  it('encodes a filename with a space', () => {
    expect(staticAssetResolver('adm', 'assets/my file.png')).toBe(`${ASSETS_DIR}/adm/my%20file.png`)
  })

  it('leaves a non-asset src untouched', () => {
    const url = 'https://example.com/x.png'
    expect(desktopAssetResolver('adm', url)).toBe(url)
    expect(staticAssetResolver('adm', url)).toBe(url)
  })
})

describe('isAllowedAsset', () => {
  it('accepts images and PDF, case-insensitively', () => {
    expect(isAllowedAsset('a.PNG')).toBe(true)
    expect(isAllowedAsset('a.svg')).toBe(true)
    expect(isAllowedAsset('a.pdf')).toBe(true)
  })

  it('rejects anything executable or unknown', () => {
    expect(isAllowedAsset('a.exe')).toBe(false)
    expect(isAllowedAsset('a.sh')).toBe(false)
    expect(isAllowedAsset('noextension')).toBe(false)
  })
})
