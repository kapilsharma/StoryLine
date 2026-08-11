import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { View } from '@shared/types'
import { birthYear, lifespan } from '@shared/dates'
import { colourFor, displayName } from '@shared/families'
import type { FamilyGraph } from '@shared/graph'
import { useStore } from '../../store'
import {
  freeze,
  layoutTree,
  viewMembers,
  virtualBends,
  visibleNodes,
  type LayoutOptions,
  type Point,
  type TreeLayout
} from './layout'

/**
 * The infinite canvas (Requirements/Feature29.md §6).
 *
 * DOM nodes and an SVG edge layer share one transformed container, so pan and
 * zoom are a single CSS transform — GPU-composited, no per-frame re-layout, and
 * the two layers can never drift apart. Nodes stay DOM rather than SVG or
 * <canvas> so text is crisp at any zoom, theming is plain CSS, and clicks and
 * keyboard focus work without hit-testing by hand.
 *
 * Two features here exist to answer "who are this person's parents?" on a dense
 * tree — see Requirements/Feature29.md §6:
 *
 *  - **Selecting a node highlights its family**: both parents, their partner
 *    link, and the connectors between. Everything else dims.
 *  - **Nodes can be dragged**, and the position is saved into the view's
 *    `overrides`. Connectors re-route from wherever the node actually is.
 */

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
/** Extra world margin around the viewport so scrolling doesn't pop nodes in. */
const CULL_MARGIN = 400
/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 3

interface Props {
  graph: FamilyGraph
  view: View
  /** Family → colour, from project.json. */
  families: Record<string, string>
  /** Node/gap geometry, derived from app settings by the Family tab. */
  opts: LayoutOptions
}

/**
 * A waypoint being dragged. `index` is the slot in the edge's waypoint list;
 * `insert` means the drag started on a virtual bend, so a new waypoint is
 * created at that slot rather than an existing one moved — the draw.io model.
 */
interface EdgeDrag {
  edgeId: string
  index: number
  insert: boolean
  /** The waypoint list this drag edits — the materialised automatic route on a
   *  first bend, or the existing waypoints thereafter. */
  baseline: Array<{ x: number; y: number }>
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}

interface NodeDrag {
  id: string
  /** Pointer position at press, in client coordinates. */
  startX: number
  startY: number
  /** The node's world position at press. */
  originX: number
  originY: number
  moved: boolean
  /** Timeline mode + dated character: Y is pinned to the birth year, X-only drag. */
  lockY: boolean
}

export function TreeCanvas({ graph, view, families, opts }: Props): JSX.Element {
  const { config, saveView, readOnly } = useStore()
  const viewportRef = useRef<HTMLDivElement>(null)

  const [camera, setCamera] = useState({ x: view.panX, y: view.panY, k: view.zoom })
  const [panning, setPanning] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const panRef = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null)

  // A drag is previewed locally and written to the view on release, so moving a
  // node is one file write rather than one per frame.
  const [drag, setDrag] = useState<NodeDrag | null>(null)
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [edgeDrag, setEdgeDrag] = useState<EdgeDrag | null>(null)
  const [edgePreview, setEdgePreview] = useState<{ edgeId: string; points: Point[] } | null>(null)

  useEffect(() => {
    setCamera({ x: view.panX, y: view.panY, k: view.zoom })
  }, [view.id, view.panX, view.panY, view.zoom])

  // Apply the in-flight drag before layout, so connectors follow the node while
  // it moves rather than snapping at the end.
  const effectiveView = useMemo<View>(() => {
    let next = view
    if (preview) {
      next = { ...next, overrides: { ...next.overrides, [preview.id]: { x: preview.x, y: preview.y } } }
    }
    if (edgePreview) {
      next = {
        ...next,
        edgeRoutes: { ...next.edgeRoutes, [edgePreview.edgeId]: edgePreview.points }
      }
    }
    return next
  }, [view, preview, edgePreview])

  const layout: TreeLayout = useMemo(
    () => layoutTree(graph, effectiveView, opts),
    [graph, effectiveView, opts]
  )

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = (): void => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const persistCamera = useCallback(
    (next: { x: number; y: number; k: number }) => {
      void saveView({ ...view, panX: next.x, panY: next.y, zoom: next.k })
    },
    [saveView, view]
  )

  const fit = useCallback(() => {
    if (!layout.nodes.length || !size.width || !size.height) return
    const { minX, minY, maxX, maxY } = layout.bounds
    const pad = 60
    const k = Math.min(
      Math.min(size.width / (maxX - minX + pad * 2), size.height / (maxY - minY + pad * 2)),
      1.5
    )
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k))
    const next = {
      k: clamped,
      x: size.width / 2 - ((minX + maxX) / 2) * clamped,
      y: size.height / 2 - ((minY + maxY) / 2) * clamped
    }
    setCamera(next)
    persistCamera(next)
  }, [layout, size, persistCamera])

  const fittedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!layout.nodes.length || !size.width) return
    if (fittedRef.current === view.id) return
    fittedRef.current = view.id
    if (view.panX === 0 && view.panY === 0 && view.zoom === 1) fit()
  }, [layout, size, view.id, view.panX, view.panY, view.zoom, fit])

  // ── Pan and node drag share the pointer handlers on the viewport ──
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    // Resolve to the element that carries the data attributes: a click lands on
    // the <circle> or <path> inside a handle group, not on the group itself.
    const target = e.target as Element

    // The selection bars sit *inside* the viewport, so a press on one of their
    // buttons arrives here first. Starting a pan would then capture the pointer,
    // and pointer capture retargets the compatibility mouse events too — so the
    // button's own click never fires and the control is silently dead. Let chrome
    // inside the canvas handle its own presses.
    if (target.closest?.('.selection-bars')) return
    const owner = (target.closest?.('[data-handle], [data-edge-id]') ?? target) as HTMLElement
    const dataset = owner.dataset ?? {}

    // Removing a bend goes through pointerdown rather than a double-click:
    // dragging a handle captures the pointer, which retargets later events to
    // the viewport, so the rect never receives a dblclick at all.
    if (dataset.handle === 'remove') {
      const edge = layout.edges.find((x) => x.id === dataset.edgeId)
      if (edge) removeCorner(edge, Number(dataset.index))
      return
    }

    // A bend handle on the selected connector: drag it to route the line.
    if (dataset.handle) {
      const edge = layout.edges.find((x) => x.id === dataset.edgeId)
      if (edge) {
        // Interior points of the drawn polyline == the waypoint list this drag
        // operates on, whether or not the edge has been edited before.
        const baseline = edge.waypoints.length
          ? edge.waypoints
          : edge.points.slice(1, -1)
        setEdgeDrag({
          edgeId: edge.id,
          index: Number(dataset.index),
          insert: dataset.handle === 'virtual',
          baseline,
          startX: e.clientX,
          startY: e.clientY,
          originX: Number(dataset.px),
          originY: Number(dataset.py),
          moved: false
        })
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }

    // The connector itself: select it, which reveals its handles.
    if (dataset.edgeId) {
      setSelectedEdge((c) => (c === dataset.edgeId ? null : (dataset.edgeId as string)))
      setSelected(null)
      return
    }

    const nodeEl = (e.target as HTMLElement).closest('.node') as HTMLElement | null

    if (nodeEl?.dataset.id) {
      const node = layout.nodes.find((n) => n.id === nodeEl.dataset.id)
      if (node) {
        setDrag({
          id: node.id,
          startX: e.clientX,
          startY: e.clientY,
          originX: node.x,
          originY: node.y,
          moved: false,
          lockY: view.mode === 'timeline' && birthYear(node.character.birthday) != null
        })
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }

    panRef.current = { x: e.clientX, y: e.clientY, camX: camera.x, camY: camera.y }
    setPanning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (edgeDrag) {
      const dx = e.clientX - edgeDrag.startX
      const dy = e.clientY - edgeDrag.startY
      if (!edgeDrag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      if (!edgeDrag.moved) setEdgeDrag({ ...edgeDrag, moved: true })

      const edge = layout.edges.find((x) => x.id === edgeDrag.edgeId)
      if (!edge) return
      const moved = { x: edgeDrag.originX + dx / camera.k, y: edgeDrag.originY + dy / camera.k }

      // The first bend *materialises* the automatic route: the elbow's own
      // corners become waypoints, then the new one is inserted among them.
      // Without this the line snaps from its elbow to a bare chord the moment
      // it is touched, which is jarring and looks broken.
      const existing = edgeDrag.baseline
      const points = edgeDrag.insert
        ? [...existing.slice(0, edgeDrag.index), moved, ...existing.slice(edgeDrag.index)]
        : existing.map((p, i) => (i === edgeDrag.index ? moved : p))
      setEdgePreview({ edgeId: edge.id, points })
      return
    }

    if (drag) {
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      if (!drag.moved) setDrag({ ...drag, moved: true })
      // Client pixels → world units. A dated node in timeline mode keeps its
      // year row: only X moves.
      setPreview({
        id: drag.id,
        x: drag.originX + dx / camera.k,
        y: drag.lockY ? drag.originY : drag.originY + dy / camera.k
      })
      return
    }

    const pan = panRef.current
    if (!pan) return
    setCamera((c) => ({ ...c, x: pan.camX + (e.clientX - pan.x), y: pan.camY + (e.clientY - pan.y) }))
  }

  const endPointer = (e: React.PointerEvent): void => {
    if (edgeDrag) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      if (edgeDrag.moved && edgePreview) {
        // Kept until the saved view carries the route, same as node drags.
        void saveView({
          ...view,
          edgeRoutes: { ...view.edgeRoutes, [edgePreview.edgeId]: edgePreview.points }
        })
      } else {
        setEdgePreview(null)
      }
      setEdgeDrag(null)
      return
    }

    if (drag) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      if (drag.moved && preview) {
        // Deliberately keep the preview until the saved view comes back with
        // this position in it. Clearing it here makes the node snap to its old
        // spot for the duration of the write, then jump — a visible flicker on
        // every drop. The effect below retires the preview once it is redundant.
        //
        // The first drag also *freezes* the tree: everyone keeps exactly where
        // they are, and the view becomes arranged. Otherwise the next character
        // added re-runs the layout and destroys the arrangement — pinning only
        // the people you happened to touch is not enough.
        const frozen = view.arranged ? view.overrides : freeze(layout)
        void saveView({
          ...view,
          arranged: true,
          // Stamp membership too, so a tree that was still filter-driven becomes
          // an explicit list the moment it is arranged by hand. Otherwise the
          // filters could add someone to a picture the user has just composed.
          members: [...viewMembers(graph, view)],
          overrides: { ...frozen, [preview.id]: { x: preview.x, y: preview.y } }
        })
      } else {
        // A press that never moved is a click: toggle selection.
        setSelected((s) => (s === drag.id ? null : drag.id))
        setPreview(null)
      }
      setDrag(null)
      return
    }

    if (!panRef.current) return
    panRef.current = null
    setPanning(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    persistCamera(camera)
  }

  // ── Zoom: ⌘/Ctrl+wheel and pinch, anchored at the cursor ──
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setCamera((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
        return
      }
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setCamera((c) => {
        const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.k * Math.exp(-e.deltaY * 0.002)))
        return { k, x: px - ((px - c.x) / c.k) * k, y: py - ((py - c.y) / c.k) * k }
      })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    if (drag) return
    const t = setTimeout(() => {
      if (camera.x !== view.panX || camera.y !== view.panY || camera.k !== view.zoom) {
        persistCamera(camera)
      }
    }, 800)
    return () => clearTimeout(t)
  }, [camera, view.panX, view.panY, view.zoom, persistCamera, drag])

  // Retire the drag preview once the persisted view has caught up with it, or
  // if the position was cleared elsewhere (Reset) or the view changed.
  useEffect(() => {
    if (!preview || drag) return
    const saved = view.overrides?.[preview.id]
    const settled =
      !saved || (Math.abs(saved.x - preview.x) < 0.5 && Math.abs(saved.y - preview.y) < 0.5)
    if (settled) setPreview(null)
  }, [view.overrides, view.id, preview, drag])

  // Retire the edge preview once the persisted view carries the route.
  useEffect(() => {
    if (!edgePreview || edgeDrag) return
    const saved = view.edgeRoutes?.[edgePreview.edgeId]
    const settled =
      !saved ||
      (saved.length === edgePreview.points.length &&
        saved.every(
          (p, i) =>
            Math.abs(p.x - edgePreview.points[i].x) < 0.5 &&
            Math.abs(p.y - edgePreview.points[i].y) < 0.5
        ))
    if (settled) setEdgePreview(null)
  }, [view.edgeRoutes, view.id, edgePreview, edgeDrag])

  /** The connector being edited, with its handle positions. */
  const editing = useMemo(() => {
    if (!selectedEdge) return null
    const edge = layout.edges.find((e) => e.id === selectedEdge)
    if (!edge) return null
    return { edge, bends: virtualBends(edge.points) }
  }, [selectedEdge, layout])

  // ── Highlight: the selected person's immediate family ──
  const focus = useMemo(() => {
    if (!selected) return null
    const character = graph.byId.get(selected)
    if (!character) return null

    const nodeIds = new Set<string>([selected])
    const edgeIds = new Set<string>()

    for (const edge of layout.edges) {
      if (!edge.members.includes(selected)) continue
      // A child edge naming this person as the child means these are the parents;
      // a partner edge means this is the couple. Either way, light up the whole
      // connector and everyone on it.
      edgeIds.add(edge.id)
      for (const m of edge.members) nodeIds.add(m)
    }

    // Also the partner link between this person's parents, so the couple reads
    // as a couple rather than as two unrelated boxes.
    const parentUnion = graph.childUnionOf.get(selected)
    if (parentUnion) {
      for (const edge of layout.edges) {
        if (edge.unionId === parentUnion) {
          if (edge.kind === 'partner') edgeIds.add(edge.id)
          if (edge.kind === 'child' && edge.members.includes(selected)) edgeIds.add(edge.id)
        }
      }
    }

    return { nodeIds, edgeIds }
  }, [selected, graph, layout])

  // ── Culling ──
  const nodes = useMemo(() => {
    if (!size.width || !size.height) return layout.nodes
    const rect = {
      x: (-camera.x - CULL_MARGIN) / camera.k,
      y: (-camera.y - CULL_MARGIN) / camera.k,
      width: (size.width + CULL_MARGIN * 2) / camera.k,
      height: (size.height + CULL_MARGIN * 2) / camera.k
    }
    return visibleNodes(layout, rect, opts)
  }, [layout, camera, size, opts])

  // ── Timeline axis: year gridlines + rulers, in screen space (Issue 30) ──
  const TICK_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
  const timelineTicks = useMemo(() => {
    const axis = layout.timeline
    if (!axis || !size.height) return null
    const pxPerYearScreen = axis.pxPerYear * camera.k
    if (pxPerYearScreen <= 0) return null
    // Densest step whose label spacing clears ~44px, so labels never collide.
    const step = TICK_STEPS.find((s) => s * pxPerYearScreen >= 44) ?? TICK_STEPS[TICK_STEPS.length - 1]
    // Screen Y → year, to find the visible span.
    const yearAt = (sy: number): number =>
      axis.minYear + (sy - camera.y) / camera.k / axis.pxPerYear
    const first = Math.ceil(yearAt(0) / step) * step
    const last = yearAt(size.height)
    const ticks: Array<{ year: number; y: number }> = []
    for (let year = first; year <= last; year += step) {
      ticks.push({ year, y: camera.y + axis.yForYear(year) * camera.k })
    }
    return ticks
  }, [layout.timeline, camera, size])

  /**
   * Remove one corner. Works on an untouched automatic route too: its corners
   * are materialised first, so "delete this bend" means the same thing whether
   * or not the line has been edited before. Removing the last one drops the
   * route entirely and the automatic path returns.
   */
  const removeCorner = (edge: { id: string; waypoints: Point[]; points: Point[] }, index: number): void => {
    const baseline = edge.waypoints.length ? edge.waypoints : edge.points.slice(1, -1)
    const points = baseline.filter((_, i) => i !== index)
    const routes = { ...view.edgeRoutes }
    if (points.length) routes[edge.id] = points
    else delete routes[edge.id]
    setEdgePreview(null)
    void saveView({ ...view, edgeRoutes: routes })
  }

  const resetRoute = (edgeId: string): void => {
    const routes = { ...view.edgeRoutes }
    delete routes[edgeId]
    void saveView({ ...view, edgeRoutes: routes })
  }

  /**
   * Take someone off this tree. Only this tree: the character file, their family
   * relations and their place on any other tree or board are untouched. Their
   * stored position goes with them, so re-adding them later gets a fresh one.
   */
  const removeFromTree = (id: string): void => {
    const members = [...viewMembers(graph, view)].filter((m) => m !== id)
    const overrides = { ...view.overrides }
    delete overrides[id]
    setSelected(null)
    void saveView({ ...view, members, overrides })
  }

  const fontSize = config?.settings.nodeFontSize ?? 13

  if (!layout.nodes.length) {
    return (
      <div className="viewport" ref={viewportRef}>
        <div className="tree-empty">
          <p>Nobody on this tree yet.</p>
          <p className="hint">
            Put people on it with <strong>+ Add person</strong> above, or set the filters in{' '}
            <strong>Tree settings</strong> and press <strong>Select these</strong> to add a whole
            branch at once. Parents, spouses and children come from the Characters tab — the tree
            lays itself out from those.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`viewport${panning ? ' panning' : ''}${drag?.moved ? ' dragging' : ''}${
        focus ? ' focused' : ''
      }`}
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={(e) => {
        // Fit only on empty space — a double-click on a handle means "remove",
        // and on a node it should do nothing surprising.
        const t = e.target as HTMLElement
        if (t.closest?.('.node') || (t as unknown as SVGElement).classList?.contains('handle')) return
        fit()
      }}
    >
      {timelineTicks && (
        <div className="year-gridlines" aria-hidden>
          {timelineTicks.map((t) => (
            <div key={t.year} className="year-gridline" style={{ top: t.y }} />
          ))}
        </div>
      )}

      <div
        className="world"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` }}
      >
        <svg
          className="edges"
          width={layout.bounds.maxX - layout.bounds.minX + 2}
          height={layout.bounds.maxY - layout.bounds.minY + 2}
        >
          {layout.edges.map((e) => (
            <g key={e.id}>
              <path
                className={`edge${e.ghost ? ' ghost' : ''}${
                  focus ? (focus.edgeIds.has(e.id) ? ' lit' : ' dim') : ''
                }${selectedEdge === e.id ? ' selected' : ''}${
                  e.waypoints.length ? ' routed' : ''
                }`}
                d={e.d}
              />
              {/* A fat transparent copy, so a 1.5px line is still easy to hit. */}
              <path className="edge-hit" d={e.d} data-edge-id={e.id} />
            </g>
          ))}

          {editing && (
            <g className="edge-handles">
              {/* Every corner of the drawn line gets a square, whether it came
                  from the automatic elbow or from a previous edit — so a corner
                  is always grabbable and always removable. */}
              {editing.edge.points.slice(1, -1).map((p, i) => (
                <rect
                  key={`w${i}`}
                  className="handle waypoint"
                  x={p.x - 6}
                  y={p.y - 6}
                  width={12}
                  height={12}
                  data-handle="waypoint"
                  data-edge-id={editing.edge.id}
                  data-index={i}
                  data-px={p.x}
                  data-py={p.y}
                  onDoubleClick={(e) => {
                    // Without this the viewport's own double-click fires and
                    // refits the camera, which reads as "delete did nothing".
                    e.stopPropagation()
                    removeCorner(editing.edge, i)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    removeCorner(editing.edge, i)
                  }}
                >
                  <title>Drag to move this bend</title>
                </rect>
              ))}

              {/* An explicit remove target per bend. A gesture alone is not
                  enough here: pointer capture eats the double-click, and an
                  invisible affordance is indistinguishable from a broken one. */}
              {editing.edge.points.slice(1, -1).map((p, i) => (
                <g
                  key={`x${i}`}
                  className="handle remove"
                  data-handle="remove"
                  data-edge-id={editing.edge.id}
                  data-index={i}
                >
                  <circle cx={p.x + 14} cy={p.y - 12} r={7} />
                  <path
                    d={`M ${p.x + 11} ${p.y - 15} L ${p.x + 17} ${p.y - 9} M ${p.x + 17} ${p.y - 15} L ${p.x + 11} ${p.y - 9}`}
                  />
                  <title>Remove this bend</title>
                </g>
              ))}
              {/* Segment midpoints: hollow diamonds; dragging one inserts. */}
              {editing.bends.map((p, i) => (
                <rect
                  key={`v${i}`}
                  className="handle virtual"
                  x={p.x - 4}
                  y={p.y - 4}
                  width={8}
                  height={8}
                  transform={`rotate(45 ${p.x} ${p.y})`}
                  data-handle="virtual"
                  data-edge-id={editing.edge.id}
                  data-index={i}
                  data-px={p.x}
                  data-py={p.y}
                />
              ))}
            </g>
          )}
        </svg>

        {nodes.map((n) => (
          <button
            key={n.id}
            data-id={n.id}
            className={`node${n.character.ghost ? ' ghost' : ''}${
              selected === n.id ? ' selected' : ''
            }${n.pinned ? ' pinned' : ''}${
              focus ? (focus.nodeIds.has(n.id) ? ' lit' : ' dim') : ''
            }`}
            style={{
              left: n.x - opts.nodeWidth / 2,
              top: n.y - opts.nodeHeight / 2,
              width: opts.nodeWidth,
              height: opts.nodeHeight,
              borderColor: colourFor(n.character, families),
              // A light wash of the family colour, so branches read as groups
              // without the text losing contrast.
              background: n.character.ghost
                ? undefined
                : `color-mix(in srgb, ${colourFor(n.character, families)} 7%, var(--surface))`,
              fontSize
            }}
            title={
              n.character.ghost
                ? 'Referenced but not yet created'
                : `${displayName(n.character)} — click to trace their family, drag to move`
            }
          >
            <span className="name">{displayName(n.character)}</span>
            {lifespan(n.character.birthday, n.character.died) && (
              <span className="dates" style={{ fontSize: fontSize - 2 }}>
                {lifespan(n.character.birthday, n.character.died)}
              </span>
            )}
          </button>
        ))}
      </div>

      {timelineTicks && (
        <>
          <div className="year-ruler left" aria-hidden>
            {timelineTicks.map((t) => (
              <span key={t.year} className="year-label" style={{ top: t.y }}>
                {t.year}
              </span>
            ))}
          </div>
          <div className="year-ruler right" aria-hidden>
            {timelineTicks.map((t) => (
              <span key={t.year} className="year-label" style={{ top: t.y }}>
                {t.year}
              </span>
            ))}
          </div>
        </>
      )}

      {/* A person and a connector can be selected at once, so the bars stack in a
          column rather than each anchoring itself to the bottom centre — where
          they would sit on top of each other and eat one another's clicks. */}
      <div className="selection-bars">
      {editing && (
        <div className="selection-bar">
          <strong>Connector</strong>
          <span className="hint">
            Drag a diamond to add a bend · drag a square to move one · ✕ removes it
          </span>
          {editing.edge.waypoints.length > 0 && (
            <button onClick={() => resetRoute(editing.edge.id)}>Reset route</button>
          )}
          <button onClick={() => setSelectedEdge(null)}>Done</button>
        </div>
      )}

      {selected && (
        <div className="selection-bar">
          <strong>{(() => {
            const c = graph.byId.get(selected)
            return c ? displayName(c) : selected
          })()}</strong>
          <span className="hint">{describeParents(graph, selected)}</span>
          {/* A ghost is a placeholder for someone with no file, so there is no
              membership to remove — create them first. */}
          {!readOnly && !graph.byId.get(selected)?.ghost && (
            <button
              onClick={() => removeFromTree(selected)}
              title="Take them off this tree only — the character, their relations and every other tree are untouched"
            >
              Remove from this tree
            </button>
          )}
          <button onClick={() => setSelected(null)}>Clear</button>
        </div>
      )}
      </div>
    </div>
  )
}

/** "Parents: Mohan Calder & Radha Calder" — the answer, spelled out in words. */
function describeParents(graph: FamilyGraph, id: string): string {
  const c = graph.byId.get(id)
  if (!c) return ''
  const names = [c.father, c.mother]
    .filter((p): p is string => Boolean(p))
    .map((p) => {
      const parent = graph.byId.get(p)
      return parent ? displayName(parent) : p
    })
  if (!names.length) return 'No parents recorded'
  return `Parents: ${names.join(' & ')}`
}
