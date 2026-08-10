import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@renderer/App'
import '@renderer/index.css'
import { createStaticApi, readBundle, STATIC_ROOT } from './staticApi'

/**
 * Entry point for the static (published) build. Swaps the Electron preload
 * bridge for `createStaticApi` and boots straight into the bundled project —
 * there is no dashboard, because a published folder holds exactly one project.
 */

const root = ReactDOM.createRoot(document.getElementById('root')!)

try {
  const bundle = readBundle()
  ;(window as unknown as { api: unknown }).api = createStaticApi(bundle)
  document.documentElement.dataset.theme = bundle.settings.theme
  document.title = `${bundle.project.name} — ZN Story Line`

  root.render(
    <React.StrictMode>
      <App readOnly bootRoot={STATIC_ROOT} />
    </React.StrictMode>
  )
} catch (error) {
  // A white screen here almost always means snapshot.js wasn't uploaded, so say
  // that plainly rather than failing silently in the console.
  root.render(
    <div className="boot-error">
      <h1>Couldn’t load this story board</h1>
      <p>{error instanceof Error ? error.message : String(error)}</p>
    </div>
  )
}
