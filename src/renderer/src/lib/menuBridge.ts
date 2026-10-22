import { useEffect, useRef } from 'react'
import {
  INITIAL_MENU_STATE,
  type MenuCommand,
  type MenuCommandId,
  type MenuState
} from '@shared/menu'
import type { AppApi } from '@shared/ipc'

/**
 * The window's side of the app menu (Issue #168).
 *
 * No one component knows everything the menu needs: the app knows whether a
 * project is open, the project view knows the tab, the board toolbar knows the
 * board. So each reports its own part with {@link useMenuState}; the parts are
 * merged and sent to the main process when the result changes. Clicks come back
 * the same way in reverse: each component registers the commands it owns with
 * {@link useMenuCommands} — the same functions its own buttons call.
 *
 * A component that unmounts takes its part and its commands with it, so leaving
 * the Boards tab greys out the board's items without anyone having to say so.
 */

type Handlers = { [K in MenuCommandId]?: (command: Extract<MenuCommand, { id: K }>) => void }

const bridge = (): AppApi | undefined => (window as unknown as { api?: AppApi }).api

const parts = new Map<string, Partial<MenuState>>()
let lastSent = ''
let pending = false

/** The menu state as the parts currently say it is. Exported for tests. */
export function mergedMenuState(): MenuState {
  return Object.assign({}, INITIAL_MENU_STATE, ...parts.values())
}

/** Send the merged state once the current burst of updates has settled. */
function schedule(): void {
  if (pending) return
  pending = true
  queueMicrotask(() => {
    pending = false
    const state = mergedMenuState()
    const key = JSON.stringify(state)
    if (key === lastSent) return
    lastSent = key
    bridge()?.setMenuState?.(state)
  })
}

/**
 * Report this component's part of the menu state while it is mounted. `source`
 * names the part; `part` is compared by value, so passing a fresh object every
 * render costs nothing when nothing in it changed.
 */
export function useMenuState(source: string, part: Partial<MenuState>): void {
  const key = JSON.stringify(part)
  useEffect(() => {
    parts.set(source, JSON.parse(key) as Partial<MenuState>)
    schedule()
  }, [source, key])
  useEffect(
    () => () => {
      parts.delete(source)
      schedule()
    },
    [source]
  )
}

const registered = new Set<{ current: Handlers }>()
let unsubscribe: (() => void) | null = null

function dispatch(command: MenuCommand): void {
  for (const ref of registered) {
    const run = ref.current[command.id] as ((c: MenuCommand) => void) | undefined
    run?.(command)
  }
}

/**
 * Run `handlers` for the menu commands this component owns, while it is mounted.
 * The latest handlers are always used, so they may close over current state.
 */
export function useMenuCommands(handlers: Handlers): void {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    registered.add(ref)
    if (!unsubscribe) unsubscribe = bridge()?.onMenuCommand?.(dispatch) ?? null
    return () => {
      registered.delete(ref)
      if (registered.size === 0 && unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
    }
  }, [])
}

/** Forget everything — for tests, which swap `window.api` between cases. */
export function resetMenuBridge(): void {
  parts.clear()
  registered.clear()
  unsubscribe?.()
  unsubscribe = null
  lastSent = ''
  pending = false
}
