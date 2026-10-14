// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ProjectSnapshot } from '@shared/ipc'
import type { TimelineUnit } from '@shared/types'
import App from '@renderer/App'
import { makeApi, makeSnapshot } from './test-utils'

/**
 * Column virtualization (#150): only the columns in (or just beyond) the
 * viewport are rendered. jsdom does no layout, so the component falls back to
 * rendering everything (the `columnWindow` fallback, unit-tested separately);
 * here we force a `clientWidth` and a scroll so the real windowing runs.
 */
const COLS = 30
const timeline: TimelineUnit[] = Array.from({ length: COLS }, (_, i) => ({
  id: `c${i + 1}`,
  label: `Col ${i + 1}`,
  order: i + 1
}))

const snapshot = (): ProjectSnapshot =>
  makeSnapshot({
    board: { rowOrder: ['aeri'], rowGroupOrder: ['aeri'], colOrder: timeline.map((t) => t.id), cards: [] },
    characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
    timeline,
    notes: []
  })

describe('column virtualization (#150)', () => {
  it('renders every column when the container is unmeasured (fallback)', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot()) })
    render(<App bootRoot="/" />)
    // No layout in jsdom → clientWidth 0 → all columns present (once mounted).
    expect(await screen.findByText(`Col ${COLS}`)).toBeInTheDocument()
    expect(screen.getByText('Col 1')).toBeInTheDocument()
  })

  it('drops off-screen columns once the viewport has a width', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot()) })
    render(<App bootRoot="/" />)
    await screen.findByText('Col 1')

    const scroll = document.querySelector('.board-scroll') as HTMLElement
    // A narrow viewport at the left edge: only the first several columns fit
    // (plus overscan); the far ones must drop out.
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 500 })
    Object.defineProperty(scroll, 'scrollLeft', { configurable: true, writable: true, value: 0 })
    fireEvent.scroll(scroll)

    await waitFor(() => expect(screen.queryByText(`Col ${COLS}`)).not.toBeInTheDocument())
    // The near columns are still there…
    expect(screen.getByText('Col 1')).toBeInTheDocument()

    // …and scrolling right brings far columns in and drops the first ones.
    ;(scroll as unknown as { scrollLeft: number }).scrollLeft = COLS * 160
    fireEvent.scroll(scroll)
    await waitFor(() => expect(screen.getByText(`Col ${COLS}`)).toBeInTheDocument())
    expect(screen.queryByText('Col 1')).not.toBeInTheDocument()
  })
})

const ROWS = 30
const rowChars = Array.from({ length: ROWS }, (_, i) => ({
  id: `r${i + 1}`,
  type: 'character' as const,
  name: `Row ${i + 1}`,
  colour: '#22c55e'
}))

const rowSnapshot = (): ProjectSnapshot =>
  makeSnapshot({
    board: {
      rowOrder: rowChars.map((c) => c.id),
      rowGroupOrder: rowChars.map((c) => c.id),
      colOrder: ['c1'],
      cards: []
    },
    characters: rowChars,
    timeline: [{ id: 'c1', label: 'Only', order: 1 }],
    notes: []
  })

describe('row virtualization (#157)', () => {
  it('renders every row when the container is unmeasured (fallback)', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(rowSnapshot()) })
    render(<App bootRoot="/" />)
    expect(await screen.findByText(`Row ${ROWS}`)).toBeInTheDocument()
    expect(screen.getByText('Row 1')).toBeInTheDocument()
  })

  it('drops off-screen rows once the viewport has a height', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(rowSnapshot()) })
    render(<App bootRoot="/" />)
    await screen.findByText('Row 1')

    const scroll = document.querySelector('.board-scroll') as HTMLElement
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(scroll, 'scrollTop', { configurable: true, writable: true, value: 0 })
    fireEvent.scroll(scroll)

    await waitFor(() => expect(screen.queryByText(`Row ${ROWS}`)).not.toBeInTheDocument())
    expect(screen.getByText('Row 1')).toBeInTheDocument()

    // Scroll to the bottom: far rows come in, the first ones drop.
    ;(scroll as unknown as { scrollTop: number }).scrollTop = ROWS * 66
    fireEvent.scroll(scroll)
    await waitFor(() => expect(screen.getByText(`Row ${ROWS}`)).toBeInTheDocument())
    expect(screen.queryByText('Row 1')).not.toBeInTheDocument()
  })
})
