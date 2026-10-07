import { describe, it, expect } from 'vitest'
import { SCHEMA_VERSION, type Project } from '@shared/types'
import { DEFAULT_CARD_STATUSES } from '@shared/cardStatus'
import {
  DEFAULT_ROW_LABEL,
  applyMeta,
  hasFamilyFeatures,
  projectKind,
  readMeta,
  rowLabel,
  timelineLabel
} from '@shared/project'

/**
 * Row label (#62) and project kind (#63).
 *
 * Both are optional and additive: a project.json written before they existed
 * must behave exactly as it did, and must round-trip without gaining keys.
 */

const project = (over: Partial<Project> = {}): Project => ({
  schemaVersion: SCHEMA_VERSION,
  name: 'Thettana',
  timelineLabel: 'Chapter',
  boards: ['main'],
  created: '2026-01-01',
  lastOpened: '2026-01-01',
  families: {},
  ...over
})

describe('rowLabel', () => {
  it('defaults to Character when absent', () => {
    expect(rowLabel(project())).toBe(DEFAULT_ROW_LABEL)
  })

  it('uses the stored label', () => {
    expect(rowLabel(project({ rowLabel: 'Phase' }))).toBe('Phase')
  })

  it('falls back when the stored label is only whitespace', () => {
    expect(rowLabel(project({ rowLabel: '   ' }))).toBe(DEFAULT_ROW_LABEL)
  })
})

describe('timelineLabel', () => {
  it('falls back to Chapter when blank', () => {
    expect(timelineLabel(project({ timelineLabel: '' }))).toBe('Chapter')
  })
})

describe('projectKind', () => {
  it('is story when absent — every pre-existing project', () => {
    expect(projectKind(project())).toBe('story')
    expect(hasFamilyFeatures(project())).toBe(true)
  })

  it('is general only when explicitly set', () => {
    expect(projectKind(project({ kind: 'general' }))).toBe('general')
    expect(hasFamilyFeatures(project({ kind: 'general' }))).toBe(false)
  })

  it('treats an unrecognised value as story rather than throwing', () => {
    expect(projectKind(project({ kind: 'nonsense' as never }))).toBe('story')
  })
})

describe('readMeta / applyMeta', () => {
  it('reads defaults out of a project that has neither field', () => {
    expect(readMeta(project())).toEqual({
      name: 'Thettana',
      timelineLevelLabels: ['Chapter'],
      rowLabel: 'Character',
      kind: 'story',
      cardStatuses: DEFAULT_CARD_STATUSES
    })
  })

  it('round-trips a default story project without adding keys', () => {
    const before = project()
    const after = applyMeta(before, readMeta(before))
    // JSON.stringify drops undefined, which is what writeProject does.
    expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)))
    expect('rowLabel' in JSON.parse(JSON.stringify(after))).toBe(false)
    expect('kind' in JSON.parse(JSON.stringify(after))).toBe(false)
    expect('cardStatuses' in JSON.parse(JSON.stringify(after))).toBe(false)
  })

  it('writes the fields once they differ from the defaults', () => {
    const after = applyMeta(project(), {
      name: 'TOGAF',
      timelineLevelLabels: ['Section'],
      rowLabel: 'Phase',
      kind: 'general',
      cardStatuses: DEFAULT_CARD_STATUSES
    })
    expect(after.rowLabel).toBe('Phase')
    expect(after.kind).toBe('general')
    expect(after.timelineLabel).toBe('Section')
    expect(after.name).toBe('TOGAF')
  })

  it('writes a single level as plain timelineLabel, so a flat project is unchanged on disk', () => {
    const after = applyMeta(project(), { ...readMeta(project()), timelineLevelLabels: ['Scene'] })
    expect(after.timelineLabel).toBe('Scene')
    expect(after.timelineLevelLabels).toBeUndefined()
  })

  it('writes several levels, mirroring the deepest into timelineLabel', () => {
    const after = applyMeta(project(), {
      ...readMeta(project()),
      timelineLevelLabels: ['Novel', 'Part', ' Chapter ', 'Scene']
    })
    expect(after.timelineLevelLabels).toEqual(['Novel', 'Part', 'Chapter', 'Scene'])
    // An older reader that only knows timelineLabel still names the tab sensibly.
    expect(after.timelineLabel).toBe('Scene')
  })

  it('never writes a blank level — one in the middle gets a placeholder, the last the default', () => {
    const after = applyMeta(project(), {
      ...readMeta(project()),
      timelineLevelLabels: ['Part', '', '']
    })
    expect(after.timelineLevelLabels).toEqual(['Part', 'Level 2', 'Chapter'])
  })

  it('falls back to one default level when every level is removed', () => {
    const after = applyMeta(project(), { ...readMeta(project()), timelineLevelLabels: [] })
    expect(after.timelineLabel).toBe('Chapter')
    expect(after.timelineLevelLabels).toBeUndefined()
  })

  it('drops rowLabel again when set back to the default', () => {
    const general = project({ rowLabel: 'Phase', kind: 'general' })
    const after = applyMeta(general, { ...readMeta(general), rowLabel: 'Character', kind: 'story' })
    expect(after.rowLabel).toBeUndefined()
    expect(after.kind).toBeUndefined()
  })

  it('keeps the existing name rather than blanking it', () => {
    const after = applyMeta(project(), { ...readMeta(project()), name: '   ' })
    expect(after.name).toBe('Thettana')
  })
})
