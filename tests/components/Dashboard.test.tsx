// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dashboard } from '@renderer/components/Dashboard'
import { makeApi, baseConfig, renderWithProviders } from './test-utils'

describe('Dashboard', () => {
  beforeEach(() => {
    makeApi({
      getConfig: async () => ({
        ...baseConfig,
        recents: [{ name: 'My Novel', path: '/projects/my-novel', lastOpened: '2026-06-16' }]
      })
    })
  })

  it('renders New/Open actions and recent projects from config', async () => {
    renderWithProviders(<Dashboard />)
    expect(screen.getByText('New project')).toBeInTheDocument()
    expect(screen.getByText('Open project…')).toBeInTheDocument()
    expect(await screen.findByText('My Novel')).toBeInTheDocument()
    expect(screen.getByText('/projects/my-novel')).toBeInTheDocument()
  })

  it('opens a recent project when clicked', async () => {
    const api = makeApi({
      getConfig: async () => ({
        ...baseConfig,
        recents: [{ name: 'My Novel', path: '/projects/my-novel', lastOpened: '2026-06-16' }]
      })
    })
    renderWithProviders(<Dashboard />)
    await userEvent.click(await screen.findByText('My Novel'))
    await waitFor(() => expect(api.openProject).toHaveBeenCalledWith('/projects/my-novel'))
  })

  it('invokes createProject from the New project button', async () => {
    const api = makeApi()
    renderWithProviders(<Dashboard />)
    await userEvent.click(screen.getByText('New project'))
    await waitFor(() => expect(api.createProject).toHaveBeenCalled())
  })
})