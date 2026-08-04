// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { BoardUiProvider, useBoardUi } from '@renderer/components/board/BoardUiContext'

describe('BoardUiContext', () => {
  it('supports per-card toggle and expand/collapse-all', () => {
    const { result } = renderHook(() => useBoardUi(), { wrapper: BoardUiProvider })

    act(() => result.current.registerCards(['a', 'b']))
    expect(result.current.allExpanded).toBe(false)

    act(() => result.current.setAll(true))
    expect(result.current.allExpanded).toBe(true)
    expect(result.current.isExpanded('a')).toBe(true)

    act(() => result.current.toggle('a'))
    expect(result.current.isExpanded('a')).toBe(false)
    expect(result.current.allExpanded).toBe(false)

    act(() => result.current.setAll(false))
    expect(result.current.isExpanded('b')).toBe(false)
  })

  it('is not "all expanded" when there are no cards', () => {
    const { result } = renderHook(() => useBoardUi(), { wrapper: BoardUiProvider })
    expect(result.current.allExpanded).toBe(false)
  })
})