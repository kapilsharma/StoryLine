import type { Character } from '@shared/types'

/** Geometry knobs, fed from AppSettings. */
export interface LayoutOptions {
  nodeWidth: number
  nodeHeight: number
  generationGap: number
  siblingGap: number
  partnerGap: number
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  nodeWidth: 180,
  nodeHeight: 64,
  generationGap: 90,
  siblingGap: 28,
  partnerGap: 36
}

export interface LayoutNode {
  id: string
  character: Character
  /** Centre of the node box, in world coordinates. */
  x: number
  y: number
  gen: number
  /** True when this position came from the view's manual overrides. */
  pinned?: boolean
}

/** Where a union's connectors meet. */
export interface LayoutUnion {
  id: string
  partnerIds: string[]
  childIds: string[]
  /** Junction point between the partners (or below a lone parent). */
  junctionX: number
  junctionY: number
  /** The horizontal sibling bus that children drop from. */
  busY: number
}

export type EdgeKind = 'partner' | 'child'

export interface LayoutEdge {
  id: string
  /** The union this connector belongs to — used to highlight one family. */
  unionId: string
  kind: EdgeKind
  /** Character ids this edge touches, so selecting a person can light it up. */
  members: string[]
  /** SVG path data. */
  d: string
  /** True when either endpoint is a ghost — drawn dashed. */
  ghost: boolean
  /** Where the line starts and ends, for the editing handles. */
  start: { x: number; y: number }
  end: { x: number; y: number }
  /**
   * The polyline the drawn path actually follows, corners included — including
   * the automatic elbow's corners. Handles are derived from this, so a bend
   * handle always sits *on the line*; deriving them from the start/end chord
   * puts them in empty space and makes the line jump when one is grabbed.
   */
  points: Array<{ x: number; y: number }>
  /** Manual waypoints currently applied, in order. Empty = automatic route. */
  waypoints: Array<{ x: number; y: number }>
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface TreeLayout {
  nodes: LayoutNode[]
  unions: LayoutUnion[]
  edges: LayoutEdge[]
  bounds: Bounds
  /** Nodes per generation, each sorted by x — the index culling uses. */
  byGeneration: Map<number, LayoutNode[]>
  /**
   * True when at least one node was hand-positioned. Culling's fast path assumes
   * a generation shares one y, which manual moves break, so it falls back to a
   * full scan when this is set.
   */
  hasOverrides: boolean
  /** Problems raised during layout (e.g. spouse levelling gave up). */
  warnings: string[]
}

export const EMPTY_LAYOUT: TreeLayout = {
  nodes: [],
  unions: [],
  edges: [],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  byGeneration: new Map(),
  hasOverrides: false,
  warnings: []
}
