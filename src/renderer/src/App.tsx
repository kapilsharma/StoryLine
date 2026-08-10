import { useEffect } from 'react'
import { StoreProvider, useStore } from './store'
import { PromptProvider } from './components/PromptModal'
import { Dashboard } from './components/Dashboard'
import { ProjectView } from './components/ProjectView'
import { EditorPage } from './components/EditorPage'

export interface AppProps {
  /** Published static build — see `StoreValue.readOnly`. */
  readOnly?: boolean
  /** Open this project on mount instead of showing the dashboard. */
  bootRoot?: string
}

/**
 * Transient error surface. Until now `error` was only rendered on the dashboard,
 * so a failed save inside a project was silent; this shows it wherever you are —
 * and carries the read-only notice in the published build.
 */
function ErrorToast(): JSX.Element | null {
  const { error, clearError } = useStore()

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(clearError, 6000)
    return () => clearTimeout(timer)
  }, [error, clearError])

  if (!error) return null
  return (
    <div className="toast" role="status">
      <span className="toast-message">{error}</span>
      <button className="toast-close" onClick={clearError} title="Dismiss">
        ✕
      </button>
    </div>
  )
}

function Root(): JSX.Element {
  const { snapshot, editorTarget, readOnly } = useStore()
  // The published build boots straight into its one project, so show a neutral
  // placeholder while it loads rather than flashing the (useless) dashboard.
  const fallback = readOnly ? <p className="placeholder muted">Loading…</p> : <Dashboard />
  return (
    <>
      {snapshot ? <ProjectView /> : fallback}
      {/* Fullscreen editor overlays everything; the view underneath keeps its
          state, so closing returns to exactly where you were. */}
      {editorTarget && <EditorPage key={`${editorTarget.kind}:${editorTarget.id}`} target={editorTarget} />}
      <ErrorToast />
    </>
  )
}

function App({ readOnly, bootRoot }: AppProps = {}): JSX.Element {
  return (
    <StoreProvider readOnly={readOnly} bootRoot={bootRoot}>
      <PromptProvider>
        <Root />
      </PromptProvider>
    </StoreProvider>
  )
}

export default App
