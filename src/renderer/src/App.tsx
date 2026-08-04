import { StoreProvider, useStore } from './store'
import { PromptProvider } from './components/PromptModal'
import { Dashboard } from './components/Dashboard'
import { ProjectView } from './components/ProjectView'
import { EditorPage } from './components/EditorPage'

function Root(): JSX.Element {
  const { snapshot, editorTarget } = useStore()
  return (
    <>
      {snapshot ? <ProjectView /> : <Dashboard />}
      {/* Fullscreen editor overlays everything; the view underneath keeps its
          state, so closing returns to exactly where you were. */}
      {editorTarget && <EditorPage key={`${editorTarget.kind}:${editorTarget.id}`} target={editorTarget} />}
    </>
  )
}

function App(): JSX.Element {
  return (
    <StoreProvider>
      <PromptProvider>
        <Root />
      </PromptProvider>
    </StoreProvider>
  )
}

export default App
