import { describe, it, expect, beforeEach, vi } from 'vitest'
import { INITIAL_MENU_STATE, HELP_URLS, type MenuState } from '@shared/menu'

/**
 * The main process's half of the app menu (Issue #168): it turns the menu data
 * into Electron's menu, rebuilds it when the window reports a change, and sends
 * a click back to the window — or handles it itself for links and About.
 * Electron is mocked so the built template can be inspected and clicked.
 */

type Template = Array<Record<string, unknown> & { submenu?: Template; click?: () => void }>

const h = vi.hoisted(() => ({
  listeners: new Map<string, (e: { sender: unknown }, state: unknown) => void>(),
  built: [] as unknown[],
  openExternal: vi.fn(),
  showMessageBox: vi.fn().mockResolvedValue({})
}))

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '9.9.9' },
  shell: { openExternal: h.openExternal },
  dialog: { showMessageBox: h.showMessageBox },
  ipcMain: {
    on: (ch: string, fn: (e: { sender: unknown }, s: unknown) => void) => h.listeners.set(ch, fn),
    removeAllListeners: (ch: string) => h.listeners.delete(ch)
  },
  Menu: {
    buildFromTemplate: (t: unknown) => t,
    setApplicationMenu: (m: unknown) => h.built.push(m)
  },
  BrowserWindow: class {}
}))

import { installMenu } from '@main/menu'

const webContents = { send: vi.fn() }
const window = { webContents, isDestroyed: () => false } as never

const latest = (): Template => h.built[h.built.length - 1] as Template
/** Find a menu entry anywhere in the template by id. */
function find(id: string, t: Template = latest()): Template[number] | undefined {
  for (const entry of t) {
    if (entry.id === id) return entry
    const inner = entry.submenu && find(id, entry.submenu)
    if (inner) return inner
  }
  return undefined
}
const report = (state: Partial<MenuState>, sender: unknown = webContents): void =>
  h.listeners.get('menu:state')!({ sender }, { ...INITIAL_MENU_STATE, ...state })

beforeEach(() => {
  h.built.length = 0
  webContents.send.mockClear()
  h.openExternal.mockClear()
  h.showMessageBox.mockClear()
  installMenu(window)
})

describe('installMenu', () => {
  it('replaces the default menu straight away, before the window reports', () => {
    expect(h.built).toHaveLength(1)
    expect(find('file.new')).toMatchObject({ label: 'New Project…', enabled: true, accelerator: 'CmdOrCtrl+N' })
    expect(find('file.close')).toMatchObject({ enabled: false })
  })

  it('leaves Developer tools out of a packaged build', () => {
    const roles = JSON.stringify(latest())
    expect(roles).not.toContain('toggleDevTools')
    expect(roles).toContain('editMenu')
  })

  it('rebuilds when the window reports a change, and only then', () => {
    report({ project: true, tab: 'boards' })
    expect(h.built).toHaveLength(2)
    expect(find('file.close')).toMatchObject({ enabled: true })
    report({ project: true, tab: 'boards' })
    expect(h.built).toHaveLength(2)
  })

  it('ignores a report from anything but its window', () => {
    report({ project: true }, { other: true })
    expect(h.built).toHaveLength(1)
  })

  it('turns checked items into checkboxes and keeps a shortcut it must not register', () => {
    expect(find('view.wordCount')).toMatchObject({
      type: 'checkbox',
      checked: true,
      registerAccelerator: false
    })
    expect(find('file.new')).not.toHaveProperty('type')
  })

  it('sends a click the window acts on to the window', () => {
    report({ project: true, tab: 'boards' })
    find('go.notes')!.click!()
    expect(webContents.send).toHaveBeenCalledWith('menu:command', { id: 'go', tab: 'notes' })
  })

  it('opens Help links in the browser, and shows About itself', async () => {
    find('help.issues')!.click!()
    expect(h.openExternal).toHaveBeenCalledWith(HELP_URLS.issues)
    find('help.about')!.click!()
    expect(h.showMessageBox).toHaveBeenCalledWith(
      window,
      expect.objectContaining({ message: 'ZN Story Line 9.9.9' })
    )
    expect(webContents.send).not.toHaveBeenCalled()
  })

  it('does not send to a window that has closed', () => {
    const gone = { webContents, isDestroyed: () => true } as never
    installMenu(gone)
    find('file.new')!.click!()
    expect(webContents.send).not.toHaveBeenCalled()
  })
})
