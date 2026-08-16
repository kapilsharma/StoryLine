// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '@renderer/components/Modal'

/**
 * The shared modal. Previously at 0% coverage despite being the container for
 * every create/edit form in the app — a regression in its dismiss behaviour
 * would have gone unnoticed.
 */

describe('Modal', () => {
  it('renders its title and children', () => {
    render(
      <Modal title="New chapter" onClose={vi.fn()}>
        <p>Body content</p>
      </Modal>
    )
    expect(screen.getByText('New chapter')).toBeInTheDocument()
    expect(screen.getByText('Body content')).toBeInTheDocument()
  })

  it('closes when the overlay is clicked', async () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal title="T" onClose={onClose}>
        <p>x</p>
      </Modal>
    )
    const backdrop = container.querySelector('.modal-overlay')
    expect(backdrop).not.toBeNull()
    await userEvent.click(backdrop!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when the dialog body is clicked', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="T" onClose={onClose}>
        <p>inside</p>
      </Modal>
    )
    await userEvent.click(screen.getByText('inside'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="T" onClose={onClose}>
        <p>x</p>
      </Modal>
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops listening for Escape once unmounted', async () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <Modal title="T" onClose={onClose}>
        <p>x</p>
      </Modal>
    )
    unmount()
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })
})
