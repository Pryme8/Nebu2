/**
 * WidgetSchema — declarative description of the editor-viewport widget a
 * component wants to draw.
 *
 * Components return this from `onWidgetDraw()`.
 * ViewportWidgets.syncWidgets() consumes it to create / update one
 * LineSystem mesh per group — no Babylon knowledge required in components.
 *
 * All coordinates are in entity-local space (origin = entity position).
 */

export interface WidgetPoint {
  x: number
  y: number
  z: number
}

/** A set of polylines that all share the same colour, rendered as one LineSystem. */
export interface WidgetLineGroup {
  /** Each inner array is one continuous polyline. */
  lines: WidgetPoint[][]
  /** RGB colour in 0–1 range. Defaults to warm yellow if omitted. */
  color?: { r: number; g: number; b: number }
}

export interface WidgetSchema {
  groups: WidgetLineGroup[]
}

