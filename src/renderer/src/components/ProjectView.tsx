import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { CharacterEditor } from './CharacterEditor'
import { TimelineEditor } from './TimelineEditor'
import { NotesBrowser } from './NotesBrowser'
import { Settings } from './Settings'
import { BoardsView } from './board/BoardsView'
import { BoardUiProvider } from './board/BoardUiContext'
import { BoardToolbar } from './board/BoardToolbar'
import { FamilyView } from './tree/FamilyView'
import { pluralize } from '../lib/text'
import { hasFamilyFeatures, rowLabel, timelineLabel } from '@shared/project'

type Tab = 'boards' | 'characters' | 'family' | 'timeline' | 'notes' | 'settings'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'boards', label: 'Boards' },
  { key: 'characters', label: 'Characters' },
  { key: 'family', label: 'Family' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'notes', label: 'Notes' },
  { key: 'settings', label: 'Settings' }
]

export function ProjectView(): JSX.Element {
  const { snapshot, closeProject, readOnly, revealTarget } = useStore()
  const [tab, setTab] = useState<Tab>('boards')

  // "Edit" on the board's character-note popup (issue #41) asks for a character;
  // the tab it lives on is this component's business. CharacterEditor picks the
  // same request up to select the character.
  useEffect(() => {
    if (revealTarget?.kind === 'character') setTab('characters')
  }, [revealTarget])

  // Switching a project to "general" while the Family tab is open would leave an
  // active tab that is no longer in the strip (#63).
  const familyHidden = !!snapshot && !hasFamilyFeatures(snapshot.project)
  useEffect(() => {
    if (familyHidden && tab === 'family') setTab('boards')
  }, [familyHidden, tab])

  if (!snapshot) return <></>

  // Both axes are named after the project's own labels (#62) — "Chapters" and
  // "Characters" are only the defaults.
  const project = snapshot.project
  const timelineTabLabel = pluralize(timelineLabel(project))
  const rowTabLabel = pluralize(rowLabel(project))
  const tabLabel = (t: (typeof TABS)[number]): string =>
    t.key === 'timeline' ? timelineTabLabel : t.key === 'characters' ? rowTabLabel : t.label

  // A general project has no people, so the Family tab has nothing to draw (#63).
  const tabs = TABS.filter((t) => t.key !== 'family' || hasFamilyFeatures(project))

  return (
    <BoardUiProvider>
      <div className="project-view">
        {readOnly && (
          <div className="readonly-banner" role="note">
            <strong>Read-only preview.</strong> You can explore, zoom, collapse groups and read every
            note — but nothing you change here is saved.
          </div>
        )}
        <header className="project-head">
          {/* No dashboard to go back to in a published export. */}
          {!readOnly && (
            <button className="link-btn" onClick={closeProject} title="Back to dashboard">
              ‹ Projects
            </button>
          )}
          <h1 className="project-title">{snapshot.project.name}</h1>
          <nav className="tabs">
            {tabs.map((t) => (
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
          {tab === 'family' && !familyHidden && <FamilyView />}
          {tab === 'timeline' && <TimelineEditor />}
          {tab === 'notes' && <NotesBrowser />}
          {tab === 'settings' && <Settings />}
        </main>
      </div>
    </BoardUiProvider>
  )
}
