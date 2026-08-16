import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MAX_ASSET_BYTES } from '@shared/assets'
import { assetPath, ensureBoardDirs, listAssets, writeAsset } from '@main/data/repository'

/**
 * Writing note assets to disk (Issue #61) — the half of the feature that can
 * corrupt a project folder, so it is tested against a real one.
 */

let root: string
const BID = 'main'

/** A 1×1 PNG, as base64. Small enough to keep the fixtures readable. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'zn-assets-'))
  await ensureBoardDirs(root, BID)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('listAssets', () => {
  it('is empty when the board has no assets folder at all', async () => {
    expect(await listAssets(root, BID)).toEqual([])
  })

  it('is empty for a board that does not exist', async () => {
    expect(await listAssets(root, 'nope')).toEqual([])
  })

  it('lists written assets in sorted order and hides dotfiles', async () => {
    await writeAsset(root, BID, { name: 'b.png', data: PNG })
    await writeAsset(root, BID, { name: 'a.png', data: PNG })
    await fs.writeFile(join(root, 'boards', BID, 'assets', '.DS_Store'), 'x')
    expect(await listAssets(root, BID)).toEqual(['a.png', 'b.png'])
  })
})

describe('writeAsset', () => {
  it('writes the file and returns the markdown path to insert', async () => {
    const ref = await writeAsset(root, BID, { name: 'diagram.png', data: PNG })
    expect(ref).toMatchObject({ boardId: BID, file: 'diagram.png', markdownPath: 'assets/diagram.png' })
    expect(ref.bytes).toBeGreaterThan(0)
    await expect(fs.access(assetPath(root, BID, 'diagram.png'))).resolves.toBeUndefined()
  })

  it('writes the real bytes, not the base64 text', async () => {
    await writeAsset(root, BID, { name: 'd.png', data: PNG })
    const written = await fs.readFile(assetPath(root, BID, 'd.png'))
    expect(written.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('slugifies an awkward filename but keeps the extension', async () => {
    const ref = await writeAsset(root, BID, { name: 'Screen Shot 2026 @2x.PNG', data: PNG })
    expect(ref.file).toBe('screen-shot-2026-2x.png')
  })

  it('de-duplicates rather than overwriting an existing asset', async () => {
    const a = await writeAsset(root, BID, { name: 'x.png', data: PNG })
    const b = await writeAsset(root, BID, { name: 'x.png', data: PNG })
    const c = await writeAsset(root, BID, { name: 'x.png', data: PNG })
    expect([a.file, b.file, c.file]).toEqual(['x.png', 'x-2.png', 'x-3.png'])
    expect(await listAssets(root, BID)).toHaveLength(3)
  })

  it('creates the assets folder on demand', async () => {
    await fs.rm(join(root, 'boards', BID, 'assets'), { recursive: true, force: true })
    await writeAsset(root, BID, { name: 'x.png', data: PNG })
    expect(await listAssets(root, BID)).toEqual(['x.png'])
  })

  it('keeps each board’s assets separate', async () => {
    await ensureBoardDirs(root, 'other')
    await writeAsset(root, BID, { name: 'x.png', data: PNG })
    await writeAsset(root, 'other', { name: 'y.png', data: PNG })
    expect(await listAssets(root, BID)).toEqual(['x.png'])
    expect(await listAssets(root, 'other')).toEqual(['y.png'])
  })

  it('refuses a file type that is not on the allow-list', async () => {
    await expect(writeAsset(root, BID, { name: 'evil.exe', data: PNG })).rejects.toThrow(
      /Unsupported file type/
    )
    expect(await listAssets(root, BID)).toEqual([])
  })

  it('refuses a file with no extension', async () => {
    await expect(writeAsset(root, BID, { name: 'noext', data: PNG })).rejects.toThrow(
      /Unsupported file type/
    )
  })

  it('refuses a file over the size cap, and writes nothing', async () => {
    const tooBig = Buffer.alloc(MAX_ASSET_BYTES + 1).toString('base64')
    await expect(writeAsset(root, BID, { name: 'huge.png', data: tooBig })).rejects.toThrow(
      /the limit is/
    )
    expect(await listAssets(root, BID)).toEqual([])
  })

  it('accepts a pdf, which is on the allow-list', async () => {
    const ref = await writeAsset(root, BID, { name: 'spec.pdf', data: PNG })
    expect(ref.markdownPath).toBe('assets/spec.pdf')
  })

  it('does not let a crafted name escape the assets folder', async () => {
    const ref = await writeAsset(root, BID, { name: '../../../etc/passwd.png', data: PNG })
    expect(ref.file).not.toContain('/')
    expect(ref.file).not.toContain('..')
    expect(await listAssets(root, BID)).toEqual([ref.file])
  })
})
