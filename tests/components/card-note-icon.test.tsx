// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ProjectSnapshot } from '@shared/ipc'
import { SCHEMA_VERSION } from '@shared/types'
import App from '@renderer/App'
import { makeApi } from './test-utils'

/**
 * Issue #46: a board card whose note has a body is prefixed with 📝, so the
 * board says which cards hold more than their title without being clicked.
 */
const snapshot: ProjectSnapshot = {
  root: '/',
  project: {
    schemaVersion: SCHEMA_VERSION,
    name: 'My Novel',
    timelineLabel: 'Chapter',
    boards: ['main'],
    created: '2026-08-01',
    lastOpened: '2026-08-10',
    families: {}
  },
  boards: [
    {
      board: {
        id: 'main',
        name: 'Main Board',
        cards: [
          { id: 'c1', noteUid: 'n_deep', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1' },
          { id: 'c2', noteUid: 'n_bare', rowId: 'aeri', colStart: 'ch2', colEnd: 'ch2' }
        ],
        hiddenRows: [],
        hiddenCols: [],
        presets: [],
        members: ['aeri'],
        rowOrder: ['aeri'],
        rowGroupOrder: ['aeri'],
        colOrder: ['ch1', 'ch2'],
        collapsedRowGroups: [],
        collapsedColGroups: [],
        zoom: 1,
        views: []
      },
      characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
      timeline: [
        { id: 'ch1', label: 'Chapter 1', order: 1 },
        { id: 'ch2', label: 'Chapter 2', order: 2 }
      ],
      notes: [
        { id: 'promoted', uid: 'n_deep', title: 'Promoted Aeri', body: '', hasBody: true },
        { id: 'published', uid: 'n_bare', title: 'Published the Article', body: '' }
      ],
      views: [],
      problems: []
    }
  ]
}

/** The `.board-card` a title sits in. */
function cardFor(title: string): HTMLElement {
  const el = screen.getByText(title, { exact: false }).closest('.board-card')
  if (!el) throw new Error(`no card for ${title}`)
  return el as HTMLElement
}

describe('card note indicator', () => {
  it('marks only the card whose note has a body', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App bootRoot="/" />)

    await screen.findByText('Promoted Aeri')
    expect(cardFor('Promoted Aeri').textContent).toContain('📝')
    expect(cardFor('Published the Article').textContent).not.toContain('📝')
  })
})
