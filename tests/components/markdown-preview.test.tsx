// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ASSET_SCHEME } from '@shared/assets'
import { MarkdownPreview } from '@renderer/components/MarkdownPreview'
import { makeApi, makeBoardData, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * The single component that puts rendered markdown into the DOM — asset URLs
 * (#61), wiki-link navigation (#65) and footnote jumps (#64).
 *
 * These behaviours depend on which board is open and whether the app is a
 * published export, which is exactly why they live here rather than in the
 * markdown library's own tests.
 */

const snapshot = makeSnapshot({
  boards: [
    makeBoardData('adm', {
      name: 'ADM',
      notes: [{ id: 'phase-a', uid: 'n_1', title: 'Phase A', body: '' }]
    })
  ]
})

async function renderPreview(markdown: string, opts: { readOnly?: boolean; onOpenNote?: (id: string) => void } = {}) {
  const api = makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
  renderWithProviders(
    <MarkdownPreview markdown={markdown} className="note-body" onOpenNote={opts.onOpenNote} />,
    { bootRoot: '/project', readOnly: opts.readOnly }
  )
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  return document.querySelector('.markdown') as HTMLElement
}

describe('asset URLs (#61)', () => {
  it('rewrites an asset image to the desktop scheme', async () => {
    const el = await renderPreview('![d](assets/x.png)')
    await waitFor(() =>
      expect(el.querySelector('img')?.getAttribute('src')).toBe(`${ASSET_SCHEME}://adm/x.png`)
    )
  })

  it('uses a plain relative path in a published export', async () => {
    const el = await renderPreview('![d](assets/x.png)', { readOnly: true })
    await waitFor(() => expect(el.querySelector('img')?.getAttribute('src')).toBe('assets/adm/x.png'))
  })

  it('leaves a remote image alone', async () => {
    const el = await renderPreview('![d](https://example.com/x.png)')
    await waitFor(() =>
      expect(el.querySelector('img')?.getAttribute('src')).toBe('https://example.com/x.png')
    )
  })
})

describe('wiki-links (#65)', () => {
  it('renders a link to a note that exists on this board', async () => {
    const el = await renderPreview('see [[phase-a]]')
    await waitFor(() => {
      const link = el.querySelector('a.wikilink')
      expect(link).not.toBeNull()
      expect(link!.classList.contains('broken')).toBe(false)
    })
  })

  it('marks a link whose target does not exist as broken', async () => {
    const el = await renderPreview('see [[nope]]')
    await waitFor(() => expect(el.querySelector('a.wikilink.broken')).not.toBeNull())
  })

  it('calls onOpenNote with the target id when clicked', async () => {
    const onOpenNote = vi.fn()
    const el = await renderPreview('see [[phase-a]]', { onOpenNote })
    await waitFor(() => expect(el.querySelector('a.wikilink')).not.toBeNull())
    await userEvent.click(el.querySelector('a.wikilink')!)
    expect(onOpenNote).toHaveBeenCalledWith('phase-a')
  })

  it('does not navigate on a broken link', async () => {
    const onOpenNote = vi.fn()
    const el = await renderPreview('see [[nope]]', { onOpenNote })
    await waitFor(() => expect(el.querySelector('a.wikilink.broken')).not.toBeNull())
    await userEvent.click(el.querySelector('a.wikilink')!)
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('uses the label from [[id|label]]', async () => {
    await renderPreview('see [[phase-a|Architecture Vision]]')
    expect(await screen.findByText('Architecture Vision')).toBeInTheDocument()
  })

  it('renders but does nothing when no handler is given', async () => {
    const el = await renderPreview('see [[phase-a]]')
    await waitFor(() => expect(el.querySelector('a.wikilink')).not.toBeNull())
    await expect(userEvent.click(el.querySelector('a.wikilink')!)).resolves.toBeUndefined()
  })
})

describe('footnotes (#64)', () => {
  it('renders the reference and the definition', async () => {
    const el = await renderPreview('Text[^1]\n\n[^1]: The source.')
    await waitFor(() => {
      expect(el.querySelector('.footnote-ref')).not.toBeNull()
      expect(el.querySelector('#fn-1')).not.toBeNull()
    })
  })

  it('scrolls rather than navigating when a footnote link is clicked', async () => {
    const el = await renderPreview('Text[^1]\n\n[^1]: The source.')
    await waitFor(() => expect(el.querySelector('.footnote-ref a')).not.toBeNull())

    const target = el.querySelector('#fn-1') as HTMLElement
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView

    await userEvent.click(el.querySelector('.footnote-ref a')!)
    expect(scrollIntoView).toHaveBeenCalled()
    // Never pushes a hash onto the location — inside a modal that does nothing.
    expect(window.location.hash).toBe('')
  })
})

describe('ordinary content', () => {
  it('still renders plain markdown and the ==highlight== extension', async () => {
    const el = await renderPreview('a **b** and ==c==')
    await waitFor(() => {
      expect(el.querySelector('strong')?.textContent).toBe('b')
      expect(el.querySelector('mark')?.textContent).toBe('c')
    })
  })

  it('applies the caller’s class alongside `markdown`', async () => {
    const el = await renderPreview('text')
    expect(el.classList.contains('note-body')).toBe(true)
    expect(el.classList.contains('markdown')).toBe(true)
  })

  it('ignores a click that is not on a link', async () => {
    const onOpenNote = vi.fn()
    const el = await renderPreview('just text', { onOpenNote })
    await userEvent.click(el)
    expect(onOpenNote).not.toHaveBeenCalled()
  })
})
