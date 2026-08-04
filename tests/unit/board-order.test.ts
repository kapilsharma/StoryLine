import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SCHEMA_VERSION } from '@shared/types'
import { loadSnapshot, defaultBoard } from '@main/projectService'
import { ensureBoardDirs, writeBoard, writeProject } from '@main/data/repository'

let root: string

async function scaffold(boardIds: string[], projectOrder: string[]): Promise<void> {
  for (const id of boardIds) {
    await ensureBoardDirs(root, id)
    await writeBoard(root, defaultBoard(id, id.toUpperCase()))
  }
  await writeProject(root, {
    schemaVersion: SCHEMA_VERSION,
    name: 'T',
    timelineLabel: 'Chapter',
    boards: projectOrder
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-boardorder-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('board display order (Issue 17)', () => {
  it('follows project.boards, not alphabetical folder order', async () => {
    // Folders sort to aaa, mmm, zzz — but project.boards asks for zzz, aaa, mmm.
    await scaffold(['zzz', 'aaa', 'mmm'], ['zzz', 'aaa', 'mmm'])
    const snap = await loadSnapshot(root)
    expect(snap.boards.map((b) => b.board.id)).toEqual(['zzz', 'aaa', 'mmm'])
  })

  it('appends board folders missing from project.boards (self-healing)', async () => {
    await scaffold(['zzz', 'aaa', 'mmm'], ['mmm'])
    const snap = await loadSnapshot(root)
    // mmm first (as listed), then the unlisted folders in alphabetical order.
    expect(snap.boards.map((b) => b.board.id)).toEqual(['mmm', 'aaa', 'zzz'])
  })
})
