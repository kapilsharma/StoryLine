// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@testing-library/react'
import type { AppApi, ProjectSnapshot } from '@shared/ipc'
import type { AppSettings } from '@shared/config'
import type { Note } from '@shared/types'
import App from '@renderer/App'
import { Settings } from '@renderer/components/Settings'
import { baseConfig, makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * Image cards (Issue #218): the picture on the board, the row it grows, and the
 * Text/Image choice in the panel that sets it. The frontmatter and the height
 * math are covered in tests/unit/image-cards.test.ts and tests/unit/board.test.ts.
 */

const picture: Note = {
  id: 'the-map',
  uid: 'n_map',
  title: 'The Map',
  image: 'assets/map.png',
  body: 'Where the treasure is.'
}
const plain: Note = { id: 'plain', uid: 'n_plain', title: 'Plain Scene', body: '' }

const snapshot = (): ProjectSnapshot =>
  makeSnapshot({
    board: {
      rowOrder: ['aeri', 'bo'],
      rowGroupOrder: ['aeri', 'bo'],
      colOrder: ['ch1', 'ch2'],
      cards: [
        { id: 'c1', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1', noteUid: 'n_map' },
        { id: 'c2', rowId: 'bo', colStart: 'ch2', colEnd: 'ch2', noteUid: 'n_plain' }
      ]
    },
    characters: [
      { id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' },
      { id: 'bo', type: 'character', name: 'Bo', colour: '#3b82f6' }
    ],
    timeline: [
      { id: 'ch1', label: 'Chapter 1', order: 1 },
      { id: 'ch2', label: 'Chapter 2', order: 2 }
    ],
    notes: [
      { ...picture, body: '', hasBody: true },
      { ...plain }
    ]
  })

async function boot({
  settings = {},
  note = picture
}: { settings?: Partial<AppSettings>; note?: Note } = {}): Promise<AppApi> {
  const snap = snapshot()
  const api = makeApi({
    openProject: vi.fn().mockResolvedValue(snap),
    reloadProject: vi.fn().mockResolvedValue(snap),
    getNote: vi.fn().mockResolvedValue(note),
    saveNote: vi.fn().mockResolvedValue(snap),
    getConfig: vi.fn().mockResolvedValue({
      recents: [],
      settings: { ...baseConfig.settings, ...settings }
    })
  })
  render(<App bootRoot={snap.root} />)
  await screen.findByText('My Novel')
  await screen.findByText('Plain Scene', { exact: false })
  return api
}

const imageCard = (): HTMLElement => document.querySelector('.board-card.image-card') as HTMLElement

describe('image card on the board', () => {
  it('draws the picture from the board assets, with the title beside it by default', async () => {
    await boot()
    const card = imageCard()
    expect(card).not.toBeNull()
    expect(card.querySelector('img.card-image')).toHaveAttribute('src', 'zn-asset://main/map.png')
    expect(card.querySelector('.card-image-body')).toHaveClass('title-right')
    expect(card.querySelector('.card-title')).toHaveTextContent('The Map')
    // A text card is left exactly as it was.
    const text = screen.getByText('Plain Scene', { exact: false }).closest('.board-card')!
    expect(text).not.toHaveClass('image-card')
    expect(text.querySelector('img')).toBeNull()
  })

  it('puts the title under the picture, or leaves it off, as the settings say', async () => {
    await boot({ settings: { cardImageTitle: 'below' } })
    expect(imageCard().querySelector('.card-image-body')).toHaveClass('title-below')
    expect(imageCard().querySelector('.card-title')).toHaveTextContent('The Map')
  })

  it('with no text, shows only the markers over the picture', async () => {
    await boot({ settings: { cardImageTitle: 'none' } })
    expect(imageCard().querySelector('.card-title')).toBeNull()
    expect(imageCard().textContent).not.toContain('The Map')
    // The 📝 still says the note holds more.
    expect(imageCard().querySelector('.card-image-badges')).toHaveTextContent('📝')
  })

  it('grows only the row that holds an image card, to the picture height', async () => {
    await boot({ settings: { cardImageMaxHeight: 200 } })
    const grid = document.querySelector('.board-grid') as HTMLElement
    const rows = grid.style.gridTemplateRows
    // 200px picture + 10px frame = 210px card, + the row's 16px = 226px; the
    // text row keeps its compact 66px.
    expect(rows).toContain('226px')
    expect(rows).toContain('66px')
    expect(imageCard().style.height).toBe('210px')
    expect(grid.style.getPropertyValue('--card-image-h')).toBe('200px')
  })

  it('hides the picture on a masked card in revision mode', async () => {
    await boot()
    await userEvent.click(screen.getByTitle(/revision mode/i))
    await waitFor(() => expect(document.querySelectorAll('.board-card.masked')).toHaveLength(2))
    expect(document.querySelector('.board-card img')).toBeNull()
  })
})

describe('Text / Image choice', () => {
  it('popup: shows the picture read-only', async () => {
    await boot()
    await userEvent.click(screen.getByText('The Map', { exact: false }))
    await screen.findByRole('button', { name: 'Edit' })
    expect(document.querySelector('.note-popup-image')).toHaveAttribute('src', 'zn-asset://main/map.png')
  })

  it('side panel: an image card opens on Image, with its picture left of the fields', async () => {
    await boot({ settings: { boardNoteView: 'panel' } })
    await userEvent.click(screen.getByText('The Map', { exact: false }))
    const image = await screen.findByRole('radio', { name: 'Image' })
    expect(image).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Change image' }).querySelector('img')).toHaveAttribute(
      'src',
      'zn-asset://main/map.png'
    )
  })

  it('side panel: Image then a pick makes it an image card, saved at once', async () => {
    const api = await boot({ settings: { boardNoteView: 'panel' }, note: plain })
    vi.mocked(api.pickAsset).mockResolvedValue({
      boardId: 'main',
      file: 'cover.png',
      markdownPath: 'assets/cover.png',
      bytes: 10
    })
    await userEvent.click(screen.getByText('Plain Scene', { exact: false }))
    const text = await screen.findByRole('radio', { name: 'Text' })
    expect(text).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('button', { name: 'Choose an image' })).toBeNull()

    await userEvent.click(screen.getByRole('radio', { name: 'Image' }))
    // Nothing chosen yet: still a text card, nothing saved — the chooser opens.
    expect(api.saveNote).not.toHaveBeenCalled()
    await screen.findByRole('group', { name: 'Choose an image' })
    expect(screen.getByText('No images on this board yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Upload new image…' }))
    expect(api.pickAsset).toHaveBeenCalledWith('/project', 'main', true)
    await waitFor(() =>
      expect(api.saveNote).toHaveBeenCalledWith(
        '/project',
        'main',
        expect.objectContaining({ id: 'plain', image: 'assets/cover.png' })
      )
    )
  })

  it('side panel: reuses a picture already on the board, copying nothing in', async () => {
    const api = await boot({ settings: { boardNoteView: 'panel' }, note: plain })
    vi.mocked(api.listImageAssets).mockResolvedValue(['cover.png', 'map.png'])
    await userEvent.click(screen.getByText('Plain Scene', { exact: false }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Image' }))
    expect(api.listImageAssets).toHaveBeenCalledWith('/project', 'main')
    const thumb = await screen.findByRole('button', { name: 'map.png' })
    expect(thumb.querySelector('img')).toHaveAttribute('src', 'zn-asset://main/map.png')
    await userEvent.click(thumb)
    await waitFor(() =>
      expect(api.saveNote).toHaveBeenCalledWith(
        '/project',
        'main',
        expect.objectContaining({ id: 'plain', image: 'assets/map.png' })
      )
    )
    expect(api.pickAsset).not.toHaveBeenCalled()
    expect(api.importAsset).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Choose an image' })).toBeNull()
  })

  it('side panel: clicking the picture reopens the chooser, the current one marked', async () => {
    const api = await boot({ settings: { boardNoteView: 'panel' } })
    vi.mocked(api.listImageAssets).mockResolvedValue(['cover.png', 'map.png'])
    await userEvent.click(screen.getByText('The Map', { exact: false }))
    await userEvent.click(await screen.findByRole('button', { name: 'Change image' }))
    expect(await screen.findByRole('button', { name: 'map.png' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'cover.png' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Close image chooser' }))
    expect(screen.queryByRole('group', { name: 'Choose an image' })).toBeNull()
    expect(api.saveNote).not.toHaveBeenCalled()
  })

  it('side panel: Text clears the picture', async () => {
    const api = await boot({ settings: { boardNoteView: 'panel' } })
    await userEvent.click(screen.getByText('The Map', { exact: false }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Text' }))
    await waitFor(() =>
      expect(api.saveNote).toHaveBeenCalledWith(
        '/project',
        'main',
        expect.objectContaining({ id: 'the-map', image: undefined })
      )
    )
    expect(screen.queryByRole('button', { name: 'Change image' })).toBeNull()
  })
})

describe('image card settings', () => {
  it('General holds the height and the title position', async () => {
    const api = makeApi({ openProject: vi.fn().mockResolvedValue(makeSnapshot()) })
    renderWithProviders(<Settings />, { bootRoot: '/project' })
    await screen.findByRole('tab', { name: 'General' })
    expect(screen.getByLabelText(/Image card height/)).toHaveValue('120')
    await userEvent.selectOptions(screen.getByLabelText('Image card title'), 'below')
    expect(api.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ cardImageTitle: 'below' }))
  })
})
