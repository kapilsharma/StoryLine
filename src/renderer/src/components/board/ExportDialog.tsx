import { useState } from 'react'
import type { DocExportFormat } from '@shared/ipc'
import { useStore } from '../../store'
import { Modal } from '../Modal'

/**
 * "Export board" dialog (Issue #125): pick what to include (scenes / plot rows /
 * note bodies) and a format, then write one Markdown or PDF file through a native
 * save dialog. Separate from the static-site export (Settings tab).
 */
export function ExportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { exportDocument } = useStore()
  const [scenes, setScenes] = useState(true)
  const [plotRows, setPlotRows] = useState(false)
  const [includeNotes, setIncludeNotes] = useState(true)
  const [format, setFormat] = useState<DocExportFormat>('markdown')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canExport = (scenes || plotRows) && !busy

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await exportDocument({ scenes, plotRows, includeNotes, format })
      // A null result is a cancelled save dialog — leave this one open so the
      // choices aren't lost; a path means we're done.
      if (result) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Export board" onClose={onClose}>
      <p className="muted small">Flatten this board into one file to read or print.</p>

      <fieldset className="export-group">
        <legend>Include</legend>
        <label className="export-check">
          <input type="checkbox" checked={scenes} onChange={(e) => setScenes(e.target.checked)} />
          Scenes
        </label>
        <label className="export-check">
          <input
            type="checkbox"
            checked={plotRows}
            onChange={(e) => setPlotRows(e.target.checked)}
          />
          Plot rows
        </label>
        <label className="export-check">
          <input
            type="checkbox"
            checked={includeNotes}
            onChange={(e) => setIncludeNotes(e.target.checked)}
          />
          Note bodies (off = outline only)
        </label>
      </fieldset>

      <fieldset className="export-group">
        <legend>Format</legend>
        <label className="export-check">
          <input
            type="radio"
            name="export-format"
            checked={format === 'markdown'}
            onChange={() => setFormat('markdown')}
          />
          Markdown (.md)
        </label>
        <label className="export-check">
          <input
            type="radio"
            name="export-format"
            checked={format === 'pdf'}
            onChange={() => setFormat('pdf')}
          />
          PDF (.pdf)
        </label>
      </fieldset>

      {error && <p className="error small">{error}</p>}

      <div className="form-actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={run} disabled={!canExport}>
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </Modal>
  )
}
