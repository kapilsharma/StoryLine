import { useEffect, useState } from 'react'
import type {
  EditorColorKey,
  EditorStyles,
  PreviewFont,
  PreviewPosition,
  Theme,
  ThemeColor
} from '@shared/config'
import { CARD_FONT_MIN, CARD_FONT_MAX, DEFAULT_EDITOR_STYLES } from '@shared/config'
import type { ProjectKind } from '@shared/types'
import { DEFAULT_ROW_LABEL, readMeta, type ProjectMeta } from '@shared/project'
import { useStore } from '../store'

export function Settings(): JSX.Element {
  const { snapshot, config, saveProjectMeta, updateSettings, readOnly } = useStore()

  // Project-level form. One piece of state for the whole editable metadata set —
  // name, both axis labels (#62) and the project kind (#63).
  const [meta, setMeta] = useState<ProjectMeta>({
    name: '',
    timelineLabel: '',
    rowLabel: '',
    kind: 'story'
  })

  useEffect(() => {
    if (snapshot) setMeta(readMeta(snapshot.project))
  }, [
    snapshot?.project.name,
    snapshot?.project.timelineLabel,
    snapshot?.project.rowLabel,
    snapshot?.project.kind
  ])

  const settings = config?.settings
  if (!snapshot || !settings) return <></>

  const saved = readMeta(snapshot.project)
  const projectDirty =
    meta.name !== saved.name ||
    meta.timelineLabel !== saved.timelineLabel ||
    meta.rowLabel !== saved.rowLabel ||
    meta.kind !== saved.kind
  const setField = <K extends keyof ProjectMeta>(key: K, value: ProjectMeta[K]): void =>
    setMeta((m) => ({ ...m, [key]: value }))

  const es: EditorStyles = settings.editorStyles ?? DEFAULT_EDITOR_STYLES
  const updateStyles = (partial: Partial<EditorStyles>): void => {
    void updateSettings({ ...settings, editorStyles: { ...es, ...partial } })
  }
  const updateHeading = (i: number, partial: Partial<EditorStyles['headings'][number]>): void => {
    updateStyles({ headings: es.headings.map((h, idx) => (idx === i ? { ...h, ...partial } : h)) })
  }
  const updateHeadingColor = (i: number, theme: Theme, value: string): void => {
    updateHeading(i, { color: { ...es.headings[i].color, [theme]: value } })
  }
  const setColor = (key: EditorColorKey, theme: Theme, value: string): void => {
    updateStyles({ [key]: { ...es[key], [theme]: value } } as Partial<EditorStyles>)
  }

  /** Paired light/dark colour pickers for a single element. */
  const themeColorPickers = (
    value: ThemeColor,
    onChange: (theme: Theme, v: string) => void
  ): JSX.Element => (
    <span className="theme-colors">
      <span className="theme-color">
        <input type="color" value={value.light} onChange={(e) => onChange('light', e.target.value)} />
        <span className="muted small">Light</span>
      </span>
      <span className="theme-color">
        <input type="color" value={value.dark} onChange={(e) => onChange('dark', e.target.value)} />
        <span className="muted small">Dark</span>
      </span>
    </span>
  )

  const colorRow = (label: string, key: EditorColorKey): JSX.Element => (
    <div className="style-row" key={key}>
      <label>{label}</label>
      {themeColorPickers(es[key], (theme, v) => setColor(key, theme, v))}
    </div>
  )

  return (
    <div className="settings">
      <section className="settings-group">
        <h2>Project</h2>
        <div className="form-row">
          <label htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            value={meta.name}
            onChange={(e) => setField('name', e.target.value)}
          />
        </div>
        <div className="form-row">
          <label htmlFor="project-column-label">Column label</label>
          <input
            id="project-column-label"
            value={meta.timelineLabel}
            placeholder="Chapter"
            onChange={(e) => setField('timelineLabel', e.target.value)}
          />
          <span className="muted small">Names the Timeline tab — "Chapters", "Scenes", "Sections".</span>
        </div>
        <div className="form-row">
          <label htmlFor="project-row-label">Row label</label>
          <input
            id="project-row-label"
            value={meta.rowLabel}
            placeholder={DEFAULT_ROW_LABEL}
            onChange={(e) => setField('rowLabel', e.target.value)}
          />
          <span className="muted small">
            Names the Characters tab — "Characters", "Topics", "Phases".
          </span>
        </div>
        <div className="form-row">
          <label htmlFor="project-kind">Project kind</label>
          <select
            id="project-kind"
            value={meta.kind}
            onChange={(e) => setField('kind', e.target.value as ProjectKind)}
          >
            <option value="story">Story — rows are people</option>
            <option value="general">General — rows are anything else</option>
          </select>
          <span className="muted small">
            A general project hides the Family tab and the family fields on a row, which have no
            meaning when rows are topics or phases.
          </span>
        </div>
        {readOnly ? (
          // Project metadata lives in project.json, so it can't change here.
          // Appearance settings below are session-local and do work.
          <p className="muted small">
            Project details are read-only in a published board. The appearance settings below still
            work — they apply to your browser for this visit only.
          </p>
        ) : (
          <>
            <button
              className="btn primary"
              disabled={!projectDirty || !meta.name.trim()}
              onClick={() => saveProjectMeta(meta)}
            >
              Save project settings
            </button>
            <p className="muted small folder-path">{snapshot.root}</p>
          </>
        )}
      </section>

      <section className="settings-group">
        <h2>Application</h2>
        <div className="form-row">
          <label>Theme</label>
          <select
            value={settings.theme}
            onChange={(e) => updateSettings({ ...settings, theme: e.target.value as Theme })}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="form-row">
          <label>Card font size ({settings.cardFontSize}px)</label>
          <input
            type="range"
            min={CARD_FONT_MIN}
            max={CARD_FONT_MAX}
            value={settings.cardFontSize}
            onChange={(e) => updateSettings({ ...settings, cardFontSize: Number(e.target.value) })}
          />
          <span className="muted small">Base text size on board cards (scales with zoom).</span>
        </div>
        <div className="form-row">
          <label>Editor preview position</label>
          <select
            value={settings.previewPosition}
            onChange={(e) =>
              updateSettings({ ...settings, previewPosition: e.target.value as PreviewPosition })
            }
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
          <span className="muted small">Which side the rendered preview sits on in the editor.</span>
        </div>
      </section>

      <section className="settings-group">
        <h2>Family tree</h2>
        <p className="muted small">
          Node size and spacing on the Family tab, in world units at 100% zoom. Wider nodes fit
          longer names; larger gaps make a dense tree readable at the cost of more panning.
        </p>
        {(
          [
            ['nodeWidth', 'Node width', 100, 400],
            ['nodeHeight', 'Node height', 40, 160],
            ['generationGap', 'Generation gap', 40, 260],
            ['siblingGap', 'Sibling gap', 8, 120],
            ['partnerGap', 'Partner gap', 8, 120],
            ['nodeFontSize', 'Node font size', 9, 24]
          ] as const
        ).map(([key, label, min, max]) => (
          <div className="form-row" key={key}>
            <label>
              {label} ({settings[key]}
              {key === 'nodeFontSize' ? 'px' : ''})
            </label>
            <input
              type="range"
              min={min}
              max={max}
              value={settings[key]}
              onChange={(e) => updateSettings({ ...settings, [key]: Number(e.target.value) })}
            />
          </div>
        ))}
      </section>

      <section className="settings-group">
        <h2>Editor settings</h2>
        <p className="muted small">
          Colours &amp; sizes for the markdown preview (editor and note popup). Each colour has a
          separate value for the light and dark themes.
        </p>

        <h3 className="settings-subhead">Headings</h3>
        {es.headings.map((h, i) => (
          <div className="style-row" key={`h${i}`}>
            <label>Heading {i + 1}</label>
            <input
              type="number"
              min={10}
              max={48}
              value={h.size}
              onChange={(e) => updateHeading(i, { size: Number(e.target.value) })}
            />
            <span className="muted small">px</span>
            {themeColorPickers(h.color, (theme, v) => updateHeadingColor(i, theme, v))}
          </div>
        ))}

        <h3 className="settings-subhead">Text</h3>
        {colorRow('Bold', 'bold')}
        {colorRow('Italic', 'italic')}
        {colorRow('Bold-italic', 'boldItalic')}
        {colorRow('Strikethrough', 'strikethrough')}
        {colorRow('Link', 'linkColor')}

        <h3 className="settings-subhead">Backgrounds</h3>
        {colorRow('Highlight', 'highlightBg')}
        {colorRow('Inline code', 'inlineCodeBg')}
        {colorRow('Code block', 'codeBlockBg')}
        {colorRow('Blockquote accent', 'blockquoteColor')}

        <h3 className="settings-subhead">Body</h3>
        <div className="form-row">
          <label>Preview font</label>
          <select
            value={es.bodyFont}
            onChange={(e) => updateStyles({ bodyFont: e.target.value as PreviewFont })}
          >
            <option value="sans">Sans-serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </div>
        <div className="form-row">
          <label>Line height</label>
          <input
            type="number"
            step={0.1}
            min={1.2}
            max={2.4}
            value={es.lineHeight}
            onChange={(e) => updateStyles({ lineHeight: Number(e.target.value) })}
          />
        </div>

        <button className="btn" onClick={() => updateStyles(DEFAULT_EDITOR_STYLES)}>
          Reset editor styles to defaults
        </button>
      </section>
    </div>
  )
}
