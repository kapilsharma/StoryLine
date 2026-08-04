import { useState } from 'react'
import { useStore } from '../store'
import { CharacterEditor } from './CharacterEditor'
import { TimelineEditor } from './TimelineEditor'
import { NotesBrowser } from './NotesBrowser'
import { Settings } from './Settings'
import { BoardsView } from './board/BoardsView'
import { BoardUiProvider } from './board/BoardUiContext'
import { BoardToolbar } from './board/BoardToolbar'
import { pluralize } from '../lib/text'

type Tab = 'boards' | 'characters' | 'timeline' | 'notes' | 'settings'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'boards', label: 'Boards' },
  { key: 'characters', label: 'Characters' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'notes', label: 'Notes' },
  { key: 'settings', label: 'Settings' }
]

export function ProjectView(): JSX.Element {
  const { snapshot, closeProject } = useStore()
  const [tab, setTab] = useState<Tab>('boards')

  if (!snapshot) return <></>

  // The Timeline tab is named after the project's timeline-unit label (e.g. "Chapters").
  const timelineTabLabel = pluralize(snapshot.project.timelineLabel || 'Timeline')
  const tabLabel = (t: (typeof TABS)[number]): string =>
    t.key === 'timeline' ? timelineTabLabel : t.label

  return (
    <BoardUiProvider>
      <div className="project-view">
        <header className="project-head">
          <button className="link-btn" onClick={closeProject} title="Back to dashboard">
            ‹ Projects
          </button>
          <h1 className="project-title">{snapshot.project.name}</h1>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {tabLabel(t)}
              </button>
            ))}
          </nav>
          {tab === 'boards' && <BoardToolbar />}
        </header>

        <main className="project-body">
          {tab === 'boards' && <BoardsView />}
          {tab === 'characters' && <CharacterEditor />}
          {tab === 'timeline' && <TimelineEditor />}
          {tab === 'notes' && <NotesBrowser />}
          {tab === 'settings' && <Settings />}
        </main>
      </div>
    </BoardUiProvider>
  )
}
