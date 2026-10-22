import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import {
  buildMenu,
  INITIAL_MENU_STATE,
  type MenuNode,
  type MenuPlatform,
  type MenuState
} from '@shared/menu'

/**
 * The native app menu (Issue #168).
 *
 * What the menu holds is decided in `@shared/menu` from the state the window
 * reports on `menu:state`; this file only turns that into Electron's menu and
 * routes clicks. A click the window must act on is sent to it on
 * `menu:command`; the few things only the main process can do — open a web
 * page, show About — happen here.
 */

const platform = (): MenuPlatform => ({
  isMac: process.platform === 'darwin',
  isDev: !app.isPackaged,
  appName: 'ZN Story Line'
})

function toElectron(node: MenuNode, window: BrowserWindow): MenuItemConstructorOptions {
  switch (node.type) {
    case 'separator':
      return { type: 'separator' }
    case 'role':
      return { role: node.role as MenuItemConstructorOptions['role'] }
    case 'submenu':
      return {
        label: node.label,
        ...(node.role ? { role: node.role as MenuItemConstructorOptions['role'] } : {}),
        ...(node.enabled === undefined ? {} : { enabled: node.enabled }),
        submenu: node.submenu.map((n) => toElectron(n, window))
      }
    case 'item':
      return {
        id: node.id,
        label: node.label,
        enabled: node.enabled,
        ...(node.checked === undefined ? {} : { type: 'checkbox' as const, checked: node.checked }),
        ...(node.accelerator ? { accelerator: node.accelerator } : {}),
        ...(node.registerAccelerator === false ? { registerAccelerator: false } : {}),
        click: () => {
          if (node.url) void shell.openExternal(node.url)
          else if (node.about) void showAbout(window)
          else if (node.command && !window.isDestroyed()) window.webContents.send('menu:command', node.command)
        }
      }
  }
}

function showAbout(window: BrowserWindow): Promise<unknown> {
  return dialog.showMessageBox(window, {
    type: 'info',
    title: 'About ZN Story Line',
    message: `ZN Story Line ${app.getVersion()}`,
    detail: 'Plan and write stories on a board.\nhttps://github.com/kapilsharma/StoryLine'
  })
}

let lastKey = ''

function apply(state: MenuState, window: BrowserWindow): void {
  const nodes = buildMenu(state, platform())
  // The window reports often (every toggle, every tab); rebuild only when the
  // menu would actually differ.
  const key = JSON.stringify(nodes)
  if (key === lastKey) return
  lastKey = key
  Menu.setApplicationMenu(Menu.buildFromTemplate(nodes.map((n) => toElectron(n, window))))
}

/** Install the menu for `window` and keep it in step with what the window reports. */
export function installMenu(window: BrowserWindow): void {
  lastKey = ''
  apply(INITIAL_MENU_STATE, window)
  ipcMain.removeAllListeners('menu:state')
  ipcMain.on('menu:state', (e, state: MenuState) => {
    if (e.sender === window.webContents) apply(state, window)
  })
}
