import type { WidgetPoint } from '@/types/widget'

/**
 * Generate the 12 edges of an axis-aligned wireframe box as an array of
 * 2-point polylines, ready to be used as a `WidgetLineGroup.lines` array.
 *
 * All dimensions are half-extents (the box spans ±hw, ±hh, ±hd).
 * An optional centre offset (cx, cy, cz) shifts every point.
 *
 * @example
 * // 1×1×1 unit cube centred at origin
 * boxWireframe(0.5, 0.5, 0.5)
 *
 * // Flat rectangle 0.4 wide × 0.28 tall × 0.2 deep, centred at (0, 0, 0.1)
 * boxWireframe(0.2, 0.14, 0.1, 0, 0, 0.1)
 */
export function boxWireframe(
  hw: number,
  hh: number,
  hd: number,
  cx = 0,
  cy = 0,
  cz = 0,
): WidgetPoint[][] {
  const p = (sx: number, sy: number, sz: number): WidgetPoint => ({
    x: cx + sx * hw,
    y: cy + sy * hh,
    z: cz + sz * hd,
  })

  // 8 corners keyed by sign triplet — individual consts avoid index-access T|undefined
  const c0 = p(-1, -1, -1)  // back bottom-left
  const c1 = p(+1, -1, -1)  // back bottom-right
  const c2 = p(+1, +1, -1)  // back top-right
  const c3 = p(-1, +1, -1)  // back top-left
  const c4 = p(-1, -1, +1)  // front bottom-left
  const c5 = p(+1, -1, +1)  // front bottom-right
  const c6 = p(+1, +1, +1)  // front top-right
  const c7 = p(-1, +1, +1)  // front top-left

  return [
    // Back face ring  (-Z)
    [c0, c1], [c1, c2], [c2, c3], [c3, c0],
    // Front face ring (+Z)
    [c4, c5], [c5, c6], [c6, c7], [c7, c4],
    // 4 connecting edges
    [c0, c4], [c1, c5], [c2, c6], [c3, c7],
  ]
}

/**
 * Three great-circle wireframe for a sphere.
 *
 * Returns three closed circles (one per principal plane: XZ, XY, YZ).
 *
 * @param radius  Sphere radius.
 * @param steps   Number of segments per circle (default 32).
 * @param cx cy cz  Centre offset in local space.
 */
export function sphereWireframe(
  radius: number,
  steps = 32,
  cx = 0,
  cy = 0,
  cz = 0,
): WidgetPoint[][] {
  const circle = (axis: 'xz' | 'xy' | 'yz'): WidgetPoint[] =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = (i / steps) * Math.PI * 2
      const c = Math.cos(a) * radius
      const s = Math.sin(a) * radius
      if (axis === 'xz') return { x: cx + c, y: cy,     z: cz + s }
      if (axis === 'xy') return { x: cx + c, y: cy + s,  z: cz     }
      return               { x: cx,     y: cy + s,  z: cz + c }
    })

  return [circle('xz'), circle('xy'), circle('yz')]
}

/**
 * Wireframe for an axis-aligned cylinder.
 *
 * Draws a top circle, bottom circle, and 4 evenly-spaced vertical columns.
 *
 * @param radius  Cylinder radius.
 * @param height  Total height (spans ±height/2).
 * @param steps   Number of segments per circle (default 32).
 * @param cx cy cz  Centre offset in local space.
 */
export function cylinderWireframe(
  radius: number,
  height: number,
  steps = 32,
  cx = 0,
  cy = 0,
  cz = 0,
): WidgetPoint[][] {
  const hy = height / 2

  const circle = (y: number): WidgetPoint[] =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = (i / steps) * Math.PI * 2
      return { x: cx + Math.cos(a) * radius, y: cy + y, z: cz + Math.sin(a) * radius }
    })

  const verticals: WidgetPoint[][] = [0, Math.PI / 2, Math.PI, 1.5 * Math.PI].map(a => [
    { x: cx + Math.cos(a) * radius, y: cy + hy,  z: cz + Math.sin(a) * radius },
    { x: cx + Math.cos(a) * radius, y: cy - hy,  z: cz + Math.sin(a) * radius },
  ])

  return [circle(hy), circle(-hy), ...verticals]
}

/**
 * Wireframe for an axis-aligned capsule (cylinder + hemispherical caps).
 *
 * The cylindrical section spans ±(height/2 − radius) in Y.
 * Caps are drawn as two semicircle arcs (XY-plane and ZY-plane) at each end.
 *
 * @param radius  Radius of the cylinder and hemispherical caps.
 * @param height  Total height including caps (must be ≥ 2×radius).
 * @param steps   Segments per full circle (half used per cap arc, default 32).
 * @param cx cy cz  Centre offset in local space.
 */
export function capsuleWireframe(
  radius: number,
  height: number,
  steps = 32,
  cx = 0,
  cy = 0,
  cz = 0,
): WidgetPoint[][] {
  const halfH    = height / 2
  const cylHalfH = Math.max(0, halfH - radius)
  const hSteps   = Math.max(2, steps / 2)

  // Equatorial ring at the cap junction
  const equator = (y: number): WidgetPoint[] =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = (i / steps) * Math.PI * 2
      return { x: cx + Math.cos(a) * radius, y: cy + y, z: cz + Math.sin(a) * radius }
    })

  // Semicircular cap arc in the XY plane
  // sign=+1 → top cap (arcs upward), sign=-1 → bottom cap (arcs downward)
  const hemiXY = (baseY: number, sign: number): WidgetPoint[] =>
    Array.from({ length: hSteps + 1 }, (_, i) => {
      const φ = (i / hSteps) * Math.PI
      return { x: cx + Math.cos(φ) * radius, y: cy + baseY + Math.sin(φ) * radius * sign, z: cz }
    })

  // Same arc in the ZY plane
  const hemiZY = (baseY: number, sign: number): WidgetPoint[] =>
    Array.from({ length: hSteps + 1 }, (_, i) => {
      const φ = (i / hSteps) * Math.PI
      return { x: cx, y: cy + baseY + Math.sin(φ) * radius * sign, z: cz + Math.cos(φ) * radius }
    })

  // Vertical columns connecting the two equatorial rings
  const verticals: WidgetPoint[][] = [0, Math.PI / 2, Math.PI, 1.5 * Math.PI].map(a => [
    { x: cx + Math.cos(a) * radius, y: cy + cylHalfH,  z: cz + Math.sin(a) * radius },
    { x: cx + Math.cos(a) * radius, y: cy - cylHalfH,  z: cz + Math.sin(a) * radius },
  ])

  return [
    equator(cylHalfH),
    equator(-cylHalfH),
    ...verticals,
    hemiXY( cylHalfH,  +1),  // top cap in XY plane
    hemiZY( cylHalfH,  +1),  // top cap in ZY plane
    hemiXY(-cylHalfH,  -1),  // bottom cap in XY plane
    hemiZY(-cylHalfH,  -1),  // bottom cap in ZY plane
  ]
}

/**
 * Wireframe for an arbitrary indexed triangle mesh.
 *
 * Deduplicates shared edges so each edge is drawn exactly once.
 * `verts` is a flat array of (x,y,z) triplets; `indices` is a flat triangle
 * index list (every 3 entries form one triangle).
 *
 * An optional centre offset (cx, cy, cz) shifts every point — used to
 * apply the collider's local offset.
 */
/**
 * Small pivot marker: three tiny circle rings (one per principal plane)
 * centred on a point.  Used to visualise physics constraint pivot points.
 *
 * @param cx cy cz  Centre of the marker in entity-local space.
 * @param radius    Ring radius (default 0.12).
 * @param steps     Segments per ring (default 20).
 */
export function pivotMarker(
  cx = 0,
  cy = 0,
  cz = 0,
  radius = 0.12,
  steps  = 20,
): WidgetPoint[][] {
  return sphereWireframe(radius, steps, cx, cy, cz)
}

export function meshWireframe(
  verts: WidgetPoint[],
  indices: number[],
  cx = 0,
  cy = 0,
  cz = 0,
): WidgetPoint[][] {
  const lines: WidgetPoint[][] = []
  const seen = new Set<number>()

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      // Encode the unordered pair as a single integer key
      const lo = Math.min(p, q)
      const hi = Math.max(p, q)
      const key = lo * 65536 + hi
      if (seen.has(key)) continue
      seen.add(key)
      const vp = verts[p], vq = verts[q]
      if (vp && vq) {
        lines.push([
          { x: cx + vp.x, y: cy + vp.y, z: cz + vp.z },
          { x: cx + vq.x, y: cy + vq.y, z: cz + vq.z },
        ])
      }
    }
  }

  return lines
}
