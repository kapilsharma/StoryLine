import { describe, it, expect } from 'vitest'
import {
  buildMenu,
  HELP_URLS,
  INITIAL_MENU_STATE,
  stepZoom,
  type BoardMenuState,
  type MenuNode,
  type MenuPlatform,
  type MenuState
} from '@shared/menu'

/**
 * The app menu's contents (Issue #168): which items exist on each platform,
 * which are greyed out, and what clicking them asks for.
 */

const win: MenuPlatform = { isMac: false, isDev: false, appName: 'ZN Story Line' }
const mac: MenuPlatform = { ...win, isMac: true }

const board: BoardMenuState = {
  hasCards: true,
  manuscript: true,
  rowKinds: { plot: true, characters: false },
  hasRowGroups: true,
  columnLevels: [{ depth: 0, label: 'Collapse Chapter' }],
  allCardsExpanded: false,
  filtersOpen: true,
  revising: false
}
const onBoard: MenuState = {
  ...INITIAL_MENU_STATE,
  project: true,
  tab: 'boards',
  rowsLabel: 'Topics',
  columnsLabel: 'Scenes',
  recents: [{ name: 'Zoey Nyxx', path: 'C:/novels/zoey' }],
  board
}

type Item = Extract<MenuNode, { type: 'item' }>

/** Every clickable item in the menu, by id. */
function items(nodes: MenuNode[]): Map<string, Item> {
  const out = new Map<string, Item>()
  const walk = (list: MenuNode[]): void => {
    for (const n of list) {
      if (n.type === 'item') out.set(n.id, n)
      else if (n.type === 'submenu') walk(n.submenu)
    }
  }
  walk(nodes)
  return out
}
const topLabels = (nodes: MenuNode[]): string[] =>
  nodes.map((n) => (n.type === 'submenu' ? n.label : n.type === 'role' ? `<${n.role}>` : '-'))
const roles = (nodes: MenuNode[]): string[] => {
  const out: string[] = []
  const walk = (list: MenuNode[]): void => {
    for (const n of list) {
      if (n.type === 'role') out.push(n.role)
      else if (n.type === 'submenu') walk(n.submenu)
    }
  }
  walk(nodes)
  return out
}

describe('buildMenu — the menu bar', () => {
  it('has File, Edit, View, Board, Go, Window and Help on Windows', () => {
    expect(topLabels(buildMenu(onBoard, win))).toEqual([
      'File',
      '<editMenu>',
      'View',
      'Board',
      'Go',
      '<windowMenu>',
      'Help'
    ])
  })

  it('puts the app menu first on a Mac, with About, Settings and Quit in it', () => {
    const nodes = buildMenu(onBoard, mac)
    expect(topLabels(nodes)[0]).toBe('ZN Story Line')
    const app = nodes[0] as Extract<MenuNode, { type: 'submenu' }>
    expect(roles([app])).toEqual(expect.arrayContaining(['about', 'quit', 'hide']))
    expect(items([app]).get('file.settings')?.label).toBe('Settings…')
    // …and not repeated in File or Help.
    const all = items(nodes)
    expect(all.has('help.about')).toBe(false)
    expect(roles(nodes).filter((r) => r === 'quit')).toHaveLength(1)
  })

  it('keeps the built-in Edit menu, so copy and paste keep working', () => {
    expect(roles(buildMenu(onBoard, win))).toContain('editMenu')
  })

  it('shows Reload and Developer tools only in a development build', () => {
    expect(roles(buildMenu(onBoard, win))).not.toContain('toggleDevTools')
    expect(roles(buildMenu(onBoard, { ...win, isDev: true }))).toEqual(
      expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools'])
    )
  })
})

describe('buildMenu — File', () => {
  it('can always start or open a project, and lists the recent ones', () => {
    const all = items(buildMenu(INITIAL_MENU_STATE, win))
    expect(all.get('file.new')).toMatchObject({ enabled: true, accelerator: 'CmdOrCtrl+N' })
    expect(all.get('file.open')).toMatchObject({ enabled: true, accelerator: 'CmdOrCtrl+O' })
    const recent = items(buildMenu(onBoard, win)).get('file.openRecent.0')!
    expect(recent.label).toBe('Zoey Nyxx')
    expect(recent.command).toEqual({ id: 'file.openRecent', path: 'C:/novels/zoey' })
  })

  it('greys out Open Recent when there are none', () => {
    const file = buildMenu(INITIAL_MENU_STATE, win)[0] as Extract<MenuNode, { type: 'submenu' }>
    const recent = file.submenu.find((n) => n.type === 'submenu')
    expect(recent).toMatchObject({ label: 'Open Recent', enabled: false, submenu: [] })
  })

  it('needs an open project for the project items', () => {
    const all = items(buildMenu(INITIAL_MENU_STATE, win))
    for (const id of ['file.close', 'file.exportBoard', 'file.publish', 'file.settings'])
      expect(all.get(id)?.enabled).toBe(false)
    const open = items(buildMenu(onBoard, win))
    for (const id of ['file.close', 'file.exportBoard', 'file.publish', 'file.settings'])
      expect(open.get(id)?.enabled).toBe(true)
    expect(open.get('file.settings')?.accelerator).toBe('CmdOrCtrl+,')
  })

  it('cannot publish or leave the project from a read-only one', () => {
    const all = items(buildMenu({ ...onBoard, readOnly: true }, win))
    expect(all.get('file.publish')?.enabled).toBe(false)
    expect(all.get('file.close')?.enabled).toBe(false)
  })
})

describe('buildMenu — View', () => {
  it('shows each row toggle checked when that row is showing', () => {
    const all = items(buildMenu(onBoard, win))
    expect(all.get('view.manuscript')).toMatchObject({ enabled: true, checked: true })
    expect(all.get('view.plotRows')).toMatchObject({ enabled: true, checked: true })
    // Named after the project's rows.
    expect(all.get('view.characterRows')).toMatchObject({ label: 'Topics Rows', checked: false })
  })

  it('greys out a row toggle the board has nothing for', () => {
    const all = items(buildMenu({ ...onBoard, board: { ...board, manuscript: null, rowKinds: null } }, win))
    expect(all.get('view.manuscript')).toMatchObject({ enabled: false, checked: false })
    expect(all.get('view.plotRows')).toMatchObject({ enabled: false, checked: false })
    expect(all.get('view.characterRows')).toMatchObject({ enabled: false, checked: false })
  })

  it('offers one Collapse item per column level, carrying its depth', () => {
    const level = items(buildMenu(onBoard, win)).get('view.collapseLevel.0')!
    expect(level.label).toBe('Collapse Chapter')
    expect(level.command).toEqual({ id: 'view.collapseLevel', depth: 0 })
    const flat = items(buildMenu({ ...onBoard, board: { ...board, columnLevels: [], hasRowGroups: false } }, win))
    expect(flat.get('view.expandColumns')?.enabled).toBe(false)
    expect(flat.get('view.collapseRows')?.enabled).toBe(false)
  })

  it('names the card toggle after what it will do', () => {
    expect(items(buildMenu(onBoard, win)).get('view.toggleCards')?.label).toBe('Expand All Cards')
    const expanded = { ...onBoard, board: { ...board, allCardsExpanded: true } }
    expect(items(buildMenu(expanded, win)).get('view.toggleCards')?.label).toBe('Collapse All Cards')
  })

  it('shows Ctrl+Alt+W for word count without registering it twice', () => {
    expect(items(buildMenu(onBoard, win)).get('view.wordCount')).toMatchObject({
      enabled: true,
      checked: true,
      accelerator: 'CmdOrCtrl+Alt+W',
      registerAccelerator: false
    })
  })

  it('zooms the board, so its zoom items need a board', () => {
    const all = items(buildMenu(onBoard, win))
    expect(all.get('view.zoomIn')).toMatchObject({ enabled: true, accelerator: 'CmdOrCtrl+=' })
    expect(all.get('view.zoomOut')?.command).toEqual({ id: 'view.zoomOut' })
    expect(items(buildMenu({ ...onBoard, board: null }, win)).get('view.zoomReset')?.enabled).toBe(false)
  })

  it('checks Filters while the filter bar is open', () => {
    expect(items(buildMenu(onBoard, win)).get('view.filters')).toMatchObject({
      checked: true,
      accelerator: 'CmdOrCtrl+Shift+F'
    })
  })
})

describe('buildMenu — Board', () => {
  it('works on the board on screen, and not on a read-only one', () => {
    const all = items(buildMenu(onBoard, win))
    for (const id of ['board.new', 'board.rename', 'board.delete', 'board.addColumn', 'board.addRow', 'board.savePreset'])
      expect(all.get(id)?.enabled).toBe(true)
    const ro = items(buildMenu({ ...onBoard, readOnly: true }, win))
    for (const id of ['board.new', 'board.rename', 'board.addRow', 'view.manuscript', 'view.zoomIn'])
      expect(ro.get(id)?.enabled).toBe(false)
  })

  it('can create the first board on an empty Boards tab', () => {
    const all = items(buildMenu({ ...onBoard, board: null }, win))
    expect(all.get('board.new')?.enabled).toBe(true)
    expect(all.get('board.rename')?.enabled).toBe(false)
  })

  it('reveals and hides only in revision mode', () => {
    expect(items(buildMenu(onBoard, win)).get('board.revealAll')?.enabled).toBe(false)
    const revising = items(buildMenu({ ...onBoard, board: { ...board, revising: true } }, win))
    expect(revising.get('board.revision')?.checked).toBe(true)
    expect(revising.get('board.revealAll')?.enabled).toBe(true)
    expect(revising.get('board.hideAll')?.enabled).toBe(true)
  })

  it('needs cards for revision mode', () => {
    const empty = items(buildMenu({ ...onBoard, board: { ...board, hasCards: false } }, win))
    expect(empty.get('board.revision')?.enabled).toBe(false)
    expect(empty.get('view.toggleCards')?.enabled).toBe(false)
  })
})

describe('buildMenu — Go', () => {
  it('names the tabs after the project, with Ctrl+1…5', () => {
    const all = items(buildMenu(onBoard, win))
    expect(all.get('go.characters')).toMatchObject({ label: 'Topics', accelerator: 'CmdOrCtrl+2' })
    expect(all.get('go.timeline')).toMatchObject({ label: 'Scenes', accelerator: 'CmdOrCtrl+4' })
    expect(all.get('go.boards')?.command).toEqual({ id: 'go', tab: 'boards' })
    expect(all.get('go.settings')?.accelerator).toBeUndefined()
  })

  it('greys out Family in a project without one', () => {
    expect(items(buildMenu({ ...onBoard, hasFamily: false }, win)).get('go.family')?.enabled).toBe(false)
  })
})

describe('buildMenu — Help', () => {
  it('links to the GitHub repo and shows About', () => {
    const all = items(buildMenu(onBoard, win))
    expect(all.get('help.guide')?.url).toBe(HELP_URLS.guide)
    expect(all.get('help.issues')?.url).toBe(HELP_URLS.issues)
    expect(all.get('help.releases')?.url).toBe(HELP_URLS.releases)
    expect(all.get('help.about')).toMatchObject({ label: 'About ZN Story Line', about: true })
  })
})

describe('the fullscreen editor', () => {
  it('greys out what acts on the board and tabs hidden under it', () => {
    const all = items(buildMenu({ ...onBoard, editorOpen: true }, win))
    for (const id of ['view.manuscript', 'view.zoomIn', 'board.rename', 'board.new', 'go.notes', 'file.close', 'file.settings'])
      expect(all.get(id)?.enabled).toBe(false)
    // Word count is about the editor itself.
    expect(all.get('view.wordCount')?.enabled).toBe(true)
  })
})

describe('stepZoom', () => {
  it('steps in and out by a tenth, rounded', () => {
    expect(stepZoom(1, 'in')).toBe(1.1)
    expect(stepZoom(1, 'out')).toBe(0.91)
  })

  it('stays within what Ctrl+scroll allows', () => {
    expect(stepZoom(1.95, 'in')).toBe(2)
    expect(stepZoom(0.52, 'out')).toBe(0.5)
  })

  it('resets to actual size', () => {
    expect(stepZoom(1.7, 'reset')).toBe(1)
  })
})
