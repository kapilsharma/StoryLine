import type { AppApi } from '@shared/ipc'

/**
 * Centralized handle to the preload bridge. Resolved lazily through a proxy so
 * `window.api` is read at call time (the bridge is injected before render in
 * the app, and swapped in per-test in unit/component tests).
 */
export const api: AppApi = new Proxy({} as AppApi, {
  get(_target, prop) {
    const bridge = (window as unknown as { api?: AppApi }).api
    if (!bridge) throw new Error('Preload API not available')
    return bridge[prop as keyof AppApi]
  }
})
