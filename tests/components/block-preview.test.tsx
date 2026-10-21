// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { useState } from 'react'
import { BlockPreview } from '@renderer/components/BlockPreview'
import { makeApi, makeBoardData, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * The fullscreen editor's preview highlights, and keeps in view, the paragraph
 * under the caret (Issue #201) — and re-renders only what changed while typing.
 */

const snapshot = makeSnapshot({ boards: [makeBoardData('adm', { name: 'ADM' })] })
const SRC = 'First para.\n\nSecond para.\n\nThird para.'

let setState: (s: { markdown: string; caret: number }) => void = () => {}
const scrolls: string[] = []

function Harness({ initial }: { initial: { markdown: string; caret: number } }): JSX.Element {
  const [state, set] = useState(initial)
  setState = set
  return <BlockPreview markdown={state.markdown} caret={state.caret} className="editor-preview" />
}

async function renderPreview(markdown: string, caret: number) {
  const api = makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
  renderWithProviders(<Harness initial={{ markdown, caret }} />, { bootRoot: '/project' })
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  return document.querySelector('.editor-preview') as HTMLElement
}

const blocks = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.preview-block'))
const activeText = (root: HTMLElement): string | undefined =>
  root.querySelector('.preview-block.active')?.textContent?.trim()

beforeEach(() => {
  scrolls.length = 0
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolls.push(this.textContent?.trim() ?? '')
  }
})

describe('cursor highlight (#201)', () => {
  it('highlights the paragraph the caret is in', async () => {
    const root = await renderPreview(SRC, SRC.indexOf('Second') + 3)
    expect(blocks(root)).toHaveLength(3)
    expect(activeText(root)).toBe('Second para.')
    expect(root.querySelectorAll('.preview-block.active')).toHaveLength(1)
  })

  it('keeps the previous paragraph highlighted on the blank line after it', async () => {
    const root = await renderPreview(SRC, SRC.indexOf('Second') - 1)
    expect(activeText(root)).toBe('First para.')
  })

  it('follows the caret and scrolls only when it reaches a different paragraph', async () => {
    const root = await renderPreview(SRC, 0)
    scrolls.length = 0

    setState({ markdown: SRC, caret: 3 })
    await waitFor(() => expect(activeText(root)).toBe('First para.'))
    expect(scrolls).toEqual([])

    setState({ markdown: SRC, caret: SRC.indexOf('Third') })
    await waitFor(() => expect(activeText(root)).toBe('Third para.'))
    expect(scrolls).toEqual(['Third para.'])
  })

  it('re-renders only the paragraph being typed into', async () => {
    const root = await renderPreview(SRC, 0)
    const [first, , third] = blocks(root)

    const edited = SRC.replace('Second para.', 'Second para, longer.')
    setState({ markdown: edited, caret: edited.indexOf('longer') })
    await waitFor(() => expect(activeText(root)).toBe('Second para, longer.'))

    const after = blocks(root)
    expect(after[0]).toBe(first)
    expect(after[2]).toBe(third)
  })
})

describe('parity with the whole-note preview', () => {
  it('lists footnotes once, at the end', async () => {
    const src = 'A claim[^1].\n\n[^1]: The source.\n\nMore text.'
    const root = await renderPreview(src, 0)
    expect(root.querySelectorAll('ol.footnotes')).toHaveLength(1)
    expect(root.lastElementChild?.querySelector('ol.footnotes')).not.toBeNull()
    expect(root.querySelector('#fn-1')?.textContent).toContain('The source.')
  })

  it('resolves a reference link defined in another paragraph', async () => {
    const src = 'See [the map][m].\n\n[m]: https://example.com/map'
    const root = await renderPreview(src, 0)
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/map')
  })
})
