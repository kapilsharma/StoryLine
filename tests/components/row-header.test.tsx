// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ProjectSnapshot } from '@shared/ipc'
import { ROW_HEADER_W_DEFAULT, ROW_HEADER_W_MIN } from '@shared/types'
import App from '@renderer/App'
import { makeApi, makeSnapshot } from './test-utils'

/**
 * Issue #80: a board's first column is fixed, so a long character name used to
 * be cut off after one line. It now wraps to two, opens out in full on request,
 * and the column itself can be dragged wider.
 */
function snapshot(rowHeaderWidth?: number): ProjectSnapshot {
  return makeSnapshot({
    board: {
      members: ['margaret'],
      rowOrder: ['margaret'],
      rowGroupOrder: ['margaret'],
      colOrder: ['ch1'],
      rowHeaderWidth
    },
    characters: [
      {
        id: 'margaret',
        type: 'character',
        name: 'Lady Margaret Ashworth-Fitzgerald of Blackmoor Hall',
        colour: '#22c55e'
      }
    ],
    timeline: [{ id: 'ch1', label: 'Chapter 1', order: 1 }]
  })
}

/** jsdom lays nothing out, so overflow has to be stated rather than measured. */
function fakeOverflow(overflowing: boolean): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.classList?.contains('row-name-text') && overflowing ? 60 : 0
    }
  })
}

afterEach(() => {
  // @ts-expect-error — restore jsdom's own (absent) implementation.
  delete HTMLElement.prototype.scrollHeight
})

async function renderBoard(rowHeaderWidth?: number): Promise<HTMLElement> {
  makeApi({ openProject: vi.fn().mockResolvedValue(snapshot(rowHeaderWidth)) })
  render(<App bootRoot="/" />)
  const name = await screen.findByText(/Lady Margaret/)
  const head = name.closest('.row-head')
  if (!head) throw new Error('no row header')
  return head as HTMLElement
}

describe('board row headers', () => {
  it('wraps the name in the two-line clamp', async () => {
    fakeOverflow(false)
    const head = await renderBoard()
    expect(head.querySelector('.row-name-text')?.textContent).toBe(
      'Lady Margaret Ashworth-Fitzgerald of Blackmoor Hall'
    )
  })

  it('offers no expand button on a name that fits', async () => {
    fakeOverflow(false)
    const head = await renderBoard()
    expect(head.querySelector('.row-expand')).toBeNull()
  })

  it('expands an overflowing name in full, and collapses it again', async () => {
    fakeOverflow(true)
    const head = await renderBoard()

    const button = head.querySelector('.row-expand') as HTMLElement
    expect(button).not.toBeNull()
    expect(head.className).not.toContain('expanded')

    fireEvent.click(button)
    expect(head.className).toContain('expanded')
    // The control stays put so the same click undoes it.
    fireEvent.click(head.querySelector('.row-expand') as HTMLElement)
    expect(head.className).not.toContain('expanded')
  })

  it('lays the header column out at the width saved on the board', async () => {
    fakeOverflow(false)
    const head = await renderBoard(300)
    const grid = head.closest('.board-grid') as HTMLElement
    expect(grid.style.gridTemplateColumns).toContain('300px')
  })

  it('falls back to the default width on a board that has none', async () => {
    fakeOverflow(false)
    const head = await renderBoard()
    const grid = head.closest('.board-grid') as HTMLElement
    expect(grid.style.gridTemplateColumns).toContain(`${ROW_HEADER_W_DEFAULT}px`)
  })
})

describe('resizing the row-header column', () => {
  /** Drag the corner handle by `dx` px and return the width it saved, if any. */
  async function drag(dx: number, viewportW = 1000): Promise<number | undefined> {
    fakeOverflow(false)
    const api = makeApi({ openProject: vi.fn().mockResolvedValue(snapshot()) })
    render(<App bootRoot="/" />)
    await screen.findByText(/Lady Margaret/)

    const scroll = document.querySelector('.board-scroll') as HTMLElement
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: viewportW })
    const handle = document.querySelector('.header-resize') as HTMLElement

    fireEvent.pointerDown(handle, { clientX: 0 })
    fireEvent(window, new MouseEvent('pointermove', { clientX: dx }))
    fireEvent(window, new MouseEvent('pointerup', {}))

    await waitFor(() => expect(api.saveBoard).toHaveBeenCalled())
    return vi.mocked(api.saveBoard).mock.calls[0]?.[1]?.rowHeaderWidth
  }

  it('saves the dragged width', async () => {
    expect(await drag(60)).toBe(ROW_HEADER_W_DEFAULT + 60)
  })

  it('never goes below the minimum', async () => {
    expect(await drag(-500)).toBe(ROW_HEADER_W_MIN)
  })

  it('never takes more than half the visible board', async () => {
    // Half of a 1000px viewport, however far the pointer is dragged.
    expect(await drag(5000)).toBe(500)
  })
})
