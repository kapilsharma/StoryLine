/**
 * The app menu (Issue #168): what is in it, as plain data.
 *
 * The main process owns the native menu, but only the window knows what it
 * applies to — which tab is showing, whether the board has plot rows, whether
 * revision mode is on. So the window reports a {@link MenuState}, the menu is
 * rebuilt from it with {@link buildMenu}, and a click is sent back to the window
 * as a {@link MenuCommand} for the component that owns that action to run. The
 * toolbar and the menu therefore run the same code.
 *
 * Everything here is pure — no Electron — so the whole menu is unit-tested.
 * Items that only the main process can do (open a web page, show About, the
 * built-in Edit/Window roles) are marked as such rather than sent back.
 */

/** The project tabs, as the Go menu names them. */
export type MenuTab = 'boards' | 'characters' | 'family' | 'timeline' | 'notes' | 'settings'

/** A menu click the window acts on. */
export type MenuCommand =
  | { id: 'file.new' }
  | { id: 'file.open' }
  | { id: 'file.openRecent'; path: string }
  | { id: 'file.close' }
  | { id: 'file.exportBoard' }
  | { id: 'file.publish' }
  | { id: 'file.settings' }
  | { id: 'view.manuscript' }
  | { id: 'view.plotRows' }
  | { id: 'view.characterRows' }
  | { id: 'view.collapseRows' }
  | { id: 'view.expandRows' }
  | { id: 'view.collapseLevel'; depth: number }
  | { id: 'view.expandColumns' }
  | { id: 'view.toggleCards' }
  | { id: 'view.filters' }
  | { id: 'view.wordCount' }
  | { id: 'view.zoomIn' }
  | { id: 'view.zoomOut' }
  | { id: 'view.zoomReset' }
  | { id: 'board.new' }
  | { id: 'board.rename' }
  | { id: 'board.delete' }
  | { id: 'board.addColumn' }
  | { id: 'board.addRow' }
  | { id: 'board.savePreset' }
  | { id: 'board.revision' }
  | { id: 'board.revealAll' }
  | { id: 'board.hideAll' }
  | { id: 'go'; tab: MenuTab }

export type MenuCommandId = MenuCommand['id']

/** What the board on screen offers — reported by the Boards tab's toolbar. */
export interface BoardMenuState {
  hasCards: boolean
  /** Whether the Manuscript row is shown (#204); null when the project has none. */
  manuscript: boolean | null
  /** Whether plot and character rows are shown (#119); null when the board has no plot rows. */
  rowKinds: { plot: boolean; characters: boolean } | null
  hasRowGroups: boolean
  /** One "Collapse <level>" per column-group level (#164). */
  columnLevels: Array<{ depth: number; label: string }>
  allCardsExpanded: boolean
  filtersOpen: boolean
  revising: boolean
}

/** Everything the menu needs to know, reported by the window. */
export interface MenuState {
  /** A project is open (otherwise the dashboard is showing). */
  project: boolean
  readOnly: boolean
  /** The fullscreen editor is open over the project, hiding the board and tabs. */
  editorOpen: boolean
  recents: Array<{ name: string; path: string }>
  wordCount: boolean
  /** The tab showing, when a project is open. */
  tab: MenuTab | null
  hasFamily: boolean
  /** What this project calls its rows and columns, plural — "Characters", "Scenes". */
  rowsLabel: string
  columnsLabel: string
  /** The active board, while the Boards tab shows one; null otherwise. */
  board: BoardMenuState | null
}

/** The state before the window has reported anything: the dashboard. */
export const INITIAL_MENU_STATE: MenuState = {
  project: false,
  readOnly: false,
  editorOpen: false,
  recents: [],
  wordCount: true,
  tab: null,
  hasFamily: true,
  rowsLabel: 'Characters',
  columnsLabel: 'Chapters',
  board: null
}

/** The GitHub pages Help links to. */
export const HELP_URLS = {
  guide: 'https://github.com/kapilsharma/StoryLine#readme',
  issues: 'https://github.com/kapilsharma/StoryLine/issues',
  releases: 'https://github.com/kapilsharma/StoryLine/releases'
} as const

/**
 * One node of the menu. `item` is something to click: it carries either a
 * command for the window, a URL, or `about`. A defined `checked` makes it a
 * checkbox. `role` nodes are Electron's built-in items (Undo, Quit, the whole
 * Edit menu…), which work without any code of ours.
 */
export type MenuNode =
  | { type: 'separator' }
  | { type: 'role'; role: string }
  | { type: 'submenu'; label: string; submenu: MenuNode[]; enabled?: boolean; role?: string }
  | {
      type: 'item'
      /** Stable id, so tests can find and click the item. */
      id: string
      label: string
      enabled: boolean
      checked?: boolean
      accelerator?: string
      /**
       * False when the window already handles the shortcut itself (Ctrl+Alt+W),
       * so it is shown in the menu but not registered twice.
       */
      registerAccelerator?: boolean
      command?: MenuCommand
      url?: string
      about?: true
    }

export interface MenuPlatform {
  isMac: boolean
  /** A development build: adds Reload and Developer tools. */
  isDev: boolean
  appName: string
}

const SEP: MenuNode = { type: 'separator' }

const item = (
  id: string,
  label: string,
  enabled: boolean,
  extra: Partial<Extract<MenuNode, { type: 'item' }>> = {}
): MenuNode => ({ type: 'item', id, label, enabled, ...extra })

/** An item whose click is a command with no arguments; its id is the command's. */
const cmd = (
  id: Exclude<MenuCommandId, 'file.openRecent' | 'view.collapseLevel' | 'go'>,
  label: string,
  enabled: boolean,
  extra: Partial<Extract<MenuNode, { type: 'item' }>> = {}
): MenuNode => item(id, label, enabled, { command: { id } as MenuCommand, ...extra })

/** Build the whole menu bar for the given state. */
export function buildMenu(state: MenuState, platform: MenuPlatform): MenuNode[] {
  const { isMac, isDev } = platform
  const inProject = state.project && !state.editorOpen
  const writable = !state.readOnly
  // A board's own actions apply only while it is on screen.
  const board = state.editorOpen ? null : state.board
  const onBoards = inProject && state.tab === 'boards'

  const settingsItem = cmd('file.settings', isMac ? 'Settings…' : 'Settings', inProject, {
    accelerator: 'CmdOrCtrl+,'
  })

  const recent: MenuNode = {
    type: 'submenu',
    label: 'Open Recent',
    enabled: state.recents.length > 0,
    submenu: state.recents.map((r, i) =>
      item(`file.openRecent.${i}`, r.name, true, { command: { id: 'file.openRecent', path: r.path } })
    )
  }

  const file: MenuNode = {
    type: 'submenu',
    label: 'File',
    submenu: [
      cmd('file.new', 'New Project…', true, { accelerator: 'CmdOrCtrl+N' }),
      cmd('file.open', 'Open Project…', true, { accelerator: 'CmdOrCtrl+O' }),
      recent,
      // Not from inside the editor, which would be left open over the dashboard.
      cmd('file.close', 'Back to Projects', inProject && writable),
      SEP,
      cmd('file.exportBoard', 'Export Board (Markdown/PDF)…', !!board),
      cmd('file.publish', 'Publish Static Site…', inProject && writable),
      ...(isMac ? [] : [SEP, settingsItem, SEP, { type: 'role', role: 'quit' } as MenuNode])
    ]
  }

  const kinds = board?.rowKinds ?? null
  const levels = board?.columnLevels ?? []
  const view: MenuNode = {
    type: 'submenu',
    label: 'View',
    submenu: [
      cmd('view.manuscript', 'Manuscript Row', !!board && board.manuscript !== null && writable, {
        checked: board?.manuscript === true
      }),
      cmd('view.plotRows', 'Plot Rows', !!kinds && writable, { checked: kinds?.plot ?? false }),
      cmd('view.characterRows', `${state.rowsLabel} Rows`, !!kinds && writable, {
        checked: kinds?.characters ?? false
      }),
      SEP,
      cmd('view.collapseRows', 'Collapse All Row Groups', !!board?.hasRowGroups && writable),
      cmd('view.expandRows', 'Expand All Row Groups', !!board?.hasRowGroups && writable),
      ...levels.map(({ depth, label }) =>
        item(`view.collapseLevel.${depth}`, label, writable, { command: { id: 'view.collapseLevel', depth } })
      ),
      cmd('view.expandColumns', 'Expand All Columns', levels.length > 0 && writable),
      SEP,
      cmd(
        'view.toggleCards',
        board?.allCardsExpanded ? 'Collapse All Cards' : 'Expand All Cards',
        !!board?.hasCards
      ),
      cmd('view.filters', 'Filters', !!board, {
        checked: board?.filtersOpen ?? false,
        accelerator: 'CmdOrCtrl+Shift+F'
      }),
      SEP,
      // The window already listens for Ctrl+Alt+W (#194), anywhere in the app.
      cmd('view.wordCount', 'Word Count', true, {
        checked: state.wordCount,
        accelerator: 'CmdOrCtrl+Alt+W',
        registerAccelerator: false
      }),
      SEP,
      // The board's zoom (what Ctrl+scroll does), not the page's.
      cmd('view.zoomIn', 'Zoom In', !!board && writable, { accelerator: 'CmdOrCtrl+=' }),
      cmd('view.zoomOut', 'Zoom Out', !!board && writable, { accelerator: 'CmdOrCtrl+-' }),
      cmd('view.zoomReset', 'Actual Size', !!board && writable, { accelerator: 'CmdOrCtrl+0' }),
      { type: 'role', role: 'togglefullscreen' },
      ...(isDev
        ? [
            SEP,
            { type: 'role', role: 'reload' } as MenuNode,
            { type: 'role', role: 'forceReload' } as MenuNode,
            { type: 'role', role: 'toggleDevTools' } as MenuNode
          ]
        : [])
    ]
  }

  const boardMenu: MenuNode = {
    type: 'submenu',
    label: 'Board',
    submenu: [
      cmd('board.new', 'New Board…', onBoards && writable),
      cmd('board.rename', 'Rename Board…', !!board && writable),
      cmd('board.delete', 'Delete Board…', !!board && writable),
      SEP,
      cmd('board.addColumn', 'Add Column…', !!board && writable),
      cmd('board.addRow', 'Add Row…', !!board && writable),
      cmd('board.savePreset', 'Save Preset…', !!board && writable),
      SEP,
      cmd('board.revision', 'Revision Mode', !!board?.hasCards, { checked: board?.revising ?? false }),
      cmd('board.revealAll', 'Reveal Every Card', !!board?.revising && board.hasCards),
      cmd('board.hideAll', 'Hide Every Card Again', !!board?.revising && board.hasCards)
    ]
  }

  const tabs: Array<[MenuTab, string, boolean]> = [
    ['boards', 'Boards', true],
    ['characters', state.rowsLabel, true],
    ['family', 'Family', state.hasFamily],
    ['timeline', state.columnsLabel, true],
    ['notes', 'Notes', true],
    ['settings', 'Settings', true]
  ]
  const go: MenuNode = {
    type: 'submenu',
    label: 'Go',
    submenu: tabs.map(([tab, label, shown], i) =>
      item(`go.${tab}`, label, inProject && shown, {
        command: { id: 'go', tab },
        // Ctrl+1…5 for the tabs; Settings already has Ctrl+, .
        ...(tab === 'settings' ? {} : { accelerator: `CmdOrCtrl+${i + 1}` })
      })
    )
  }

  const help: MenuNode = {
    type: 'submenu',
    label: 'Help',
    role: 'help',
    submenu: [
      item('help.guide', 'User Guide', true, { url: HELP_URLS.guide }),
      item('help.issues', 'Report an Issue', true, { url: HELP_URLS.issues }),
      item('help.releases', 'Release Notes', true, { url: HELP_URLS.releases }),
      // On a Mac, About lives in the app menu.
      ...(isMac ? [] : [SEP, item('help.about', `About ${platform.appName}`, true, { about: true })])
    ]
  }

  const appMenu: MenuNode[] = isMac
    ? [
        {
          type: 'submenu',
          label: platform.appName,
          submenu: [
            { type: 'role', role: 'about' },
            SEP,
            settingsItem,
            SEP,
            { type: 'role', role: 'services' },
            SEP,
            { type: 'role', role: 'hide' },
            { type: 'role', role: 'hideOthers' },
            { type: 'role', role: 'unhide' },
            SEP,
            { type: 'role', role: 'quit' }
          ]
        }
      ]
    : []

  return [
    ...appMenu,
    file,
    // Undo, Cut, Copy, Paste… — kept exactly as the system provides them, or
    // copy and paste stop working in the text fields on a Mac.
    { type: 'role', role: 'editMenu' },
    view,
    boardMenu,
    go,
    { type: 'role', role: 'windowMenu' },
    help
  ]
}

/** One step of the board's zoom, in or out, kept to the range Ctrl+scroll allows. */
export function stepZoom(zoom: number, direction: 'in' | 'out' | 'reset'): number {
  if (direction === 'reset') return 1
  const next = direction === 'in' ? zoom * 1.1 : zoom / 1.1
  return Math.round(Math.min(2, Math.max(0.5, next)) * 100) / 100
}
