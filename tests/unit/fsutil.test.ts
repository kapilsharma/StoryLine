import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readText, writeTextGuarded, exists, StaleWriteError } from '@main/data/fsutil'

let dir: string
const file = (name = 'a.txt'): string => join(dir, name)

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-fsutil-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('writeTextGuarded / readText', () => {
  it('creates parent dirs and round-trips text, returning the new mtime', async () => {
    const p = join(dir, 'nested', 'deep', 'note.md')
    const mtime = await writeTextGuarded(p, 'hello')
    const { text, mtimeMs } = await readText(p)
    expect(text).toBe('hello')
    expect(mtimeMs).toBe(mtime)
  })

  it('allows a guarded write when the expected mtime matches', async () => {
    const p = file()
    const mtime = await writeTextGuarded(p, 'v1')
    await expect(writeTextGuarded(p, 'v2', mtime)).resolves.toBeTypeOf('number')
    expect((await readText(p)).text).toBe('v2')
  })

  it('throws StaleWriteError when the on-disk mtime has drifted', async () => {
    const p = file()
    const mtime = await writeTextGuarded(p, 'v1')
    // Pretend the caller read the file long ago (mtime far from the real one).
    await expect(writeTextGuarded(p, 'v2', mtime - 5000)).rejects.toBeInstanceOf(StaleWriteError)
    // The guarded write was refused, so the file is unchanged.
    expect((await readText(p)).text).toBe('v1')
  })

  it('recreates a file that vanished even when an expected mtime is given (ENOENT)', async () => {
    const p = file('gone.txt')
    await expect(writeTextGuarded(p, 'reborn', 123456)).resolves.toBeTypeOf('number')
    expect((await readText(p)).text).toBe('reborn')
  })

  it('StaleWriteError carries the offending path and name', () => {
    const err = new StaleWriteError('/tmp/x')
    expect(err.name).toBe('StaleWriteError')
    expect(err.filePath).toBe('/tmp/x')
  })
})

describe('exists', () => {
  it('is true for a present path and false otherwise', async () => {
    const p = file()
    expect(await exists(p)).toBe(false)
    await writeTextGuarded(p, 'x')
    expect(await exists(p)).toBe(true)
  })
})
