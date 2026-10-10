// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Character, TimelineUnit, ColumnGroup } from '@shared/types'
import { BoardUiProvider, useBoardUi } from '@renderer/components/board/BoardUiContext'
import { BoardFilterBar } from '@renderer/components/board/BoardFilterBar'
import { makeBoardData } from './test-utils'

const chars: Character[] = [
  { id: 'a', type: 'character', name: 'Aria', colour: '#111', group: 'Fae' },
  { id: 'b', type: 'character', name: 'Bob', colour: '#222', group: 'Fae' },
  { id: 'c', type: 'character', name: 'Cy', colour: '#333' }
]
const colGroups: ColumnGroup[] = [{ id: 'c1', type: 'colgroup', label: 'Chapter 1', order: 1 }]
const timeline: TimelineUnit[] = [
  { id: 'ch1', label: 'Scene 1', order: 1, parent: 'c1' },
  { id: 'ch2', label: 'Scene 2', order: 2, parent: 'c1' },
  { id: 'ch3', label: 'Loose', order: 3 }
]

/** Mirror the live filter state out so assertions can read it. */
function Probe(): JSX.Element {
  const { rowFilter, colFilter } = useBoardUi()
  return (
    <div>
      <span data-testid="rows">{[...rowFilter].sort().join(',')}</span>
      <span data-testid="cols">{[...colFilter].sort().join(',')}</span>
    </div>
  )
}

function setup(): void {
  const data = makeBoardData('main', { characters: chars, timeline, colGroups })
  render(
    <BoardUiProvider>
      <BoardFilterBar data={data} />
      <Probe />
    </BoardUiProvider>
  )
}

describe('BoardFilterBar (#140)', () => {
  it('unchecking a character filters that row out', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }))
    fireEvent.click(screen.getByLabelText('Bob'))
    expect(screen.getByTestId('rows').textContent).toBe('b')
  })

  it('unchecking a group filters all its members out at once', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }))
    fireEvent.click(screen.getByLabelText('Fae'))
    expect(screen.getByTestId('rows').textContent).toBe('a,b')
  })

  it('"Clear" inside a dropdown excludes everything; "Select all" restores it', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Scenes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('cols').textContent).toBe('ch1,ch2,ch3')
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByTestId('cols').textContent).toBe('')
  })

  it('the "Clear filters" chip resets both axes', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }))
    fireEvent.click(screen.getByLabelText('Aria'))
    expect(screen.getByTestId('rows').textContent).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }))
    expect(screen.getByTestId('rows').textContent).toBe('')
  })
})
