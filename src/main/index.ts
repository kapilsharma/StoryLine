import { app, net, protocol, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { ASSET_SCHEME } from '@shared/assets'
import { registerIpc, disposeIpc } from './ipc'
import { assetPath } from './data/repository'
import { currentRoot } from './projectService'

/**
 * Assets referenced from a note (`![](assets/x.png)`) need a URL the renderer is
 * allowed to load. The renderer's CSP is `img-src 'self' data:`, and a bare
 * `file://` is neither — so the app serves them over its own scheme instead,
 * registered here and allowed by the CSP in `src/renderer/index.html`.
 *
 * `zn-asset://<boardId>/<file>` resolves inside the *currently open* project
 * only, and the filename is rejected if it tries to escape the board's assets
 * folder. Nothing else on disk is reachable through it.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const root = currentRoot()
    if (!root) return new Response('No project open', { status: 404 })

    const url = new URL(request.url)
    const boardId = url.hostname
    const file = decodeURIComponent(url.pathname.replace(/^\//, ''))
    // A board id or filename with a separator in it would let a crafted note
    // read outside the assets folder.
    if (!boardId || !file || file.includes('/') || file.includes('..') || boardId.includes('..')) {
      return new Response('Bad asset path', { status: 400 })
    }

    return net.fetch(pathToFileURL(assetPath(root, boardId, file)).toString())
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'ZN Story Line',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  registerIpc(mainWindow)

  // Open external links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite injects ELECTRON_RENDERER_URL in dev; load the built file in prod.
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerAssetProtocol()
  createWindow()

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS apps typically stay active until the user quits explicitly.
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  void disposeIpc()
})
