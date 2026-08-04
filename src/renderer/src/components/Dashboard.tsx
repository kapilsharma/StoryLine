import { useStore } from '../store'

export function Dashboard(): JSX.Element {
  const { config, newProject, openPicker, openByPath, removeRecent, loading, error } = useStore()
  const recents = config?.recents ?? []

  return (
    <div className="dashboard">
      <header className="dashboard-head">
        <h1>ZN Story Line</h1>
        <p className="muted">Visual story planning — characters × timeline.</p>
      </header>

      <div className="dashboard-actions">
        <button className="btn primary" onClick={newProject} disabled={loading}>
          New project
        </button>
        <button className="btn" onClick={openPicker} disabled={loading}>
          Open project…
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <section className="recents">
        <h2>Recent projects</h2>
        {recents.length === 0 ? (
          <p className="muted">No projects yet. Create one to get started.</p>
        ) : (
          <ul className="recent-list">
            {recents.map((r) => (
              <li key={r.path} className="recent-item">
                <button className="recent-open" onClick={() => openByPath(r.path)} disabled={loading}>
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-path">{r.path}</span>
                  <span className="recent-date">Last opened {r.lastOpened}</span>
                </button>
                <button
                  className="recent-remove"
                  title="Remove from recents"
                  onClick={() => removeRecent(r.path)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
