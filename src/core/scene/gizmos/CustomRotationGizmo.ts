/**
 * CustomRotationGizmo — three torus rings (X / Y / Z axes).
 *
 * Same rendering-group approach as CustomPositionGizmo: renderingGroupId = 3
 * with depth cleared before that group.
 *
 * Drag: arc-ball style — on pointer-down the ring is hit-tested; on move a
 * signed angle is accumulated by projecting successive hit points onto the
 * drag plane and using atan2 to get the rotation delta since drag-start.
 */

import {
  TransformNode,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Quaternion,
  PointerEventTypes,
} from '@babylonjs/core'
import type {
  Scene,
  Mesh,
  AbstractMesh,
  Observer,
  PointerInfo,
  PointerInfoPre,
  Camera,
} from '@babylonjs/core'
import { GIZMO_RENDER_GROUP } from './CustomPositionGizmo'

// ── Constants ──────────────────────────────────────────────────────────────

const SCALE_RATIO  = 0.12
const HOVER_COLOR  = new Color3(1, 1, 0)

const TORUS_R      = 1.0    // outer radius (in gizmo-root local space)
const TORUS_TUBE   = 0.04
const TORUS_SEG    = 48

const DEG2RAD = Math.PI / 180

// ── Minimal observable ─────────────────────────────────────────────────────

type VoidFn = () => void

class SimpleObs {
  private _fns: VoidFn[] = []
  add(fn: VoidFn): VoidFn  { this._fns.push(fn); return fn }
  remove(fn: VoidFn): void { this._fns = this._fns.filter(f => f !== fn) }
  notify(): void           { [...this._fns].forEach(f => f()) }
}

// ── Ring descriptor ────────────────────────────────────────────────────────

interface Ring {
  axis:      Vector3
  mat:       StandardMaterial
  baseColor: Color3
  mesh:      Mesh
}

// ── Class ─────────────────────────────────────────────────────────────────

export class CustomRotationGizmo {

  readonly onDragStartObservable = new SimpleObs()
  readonly onDragObservable      = new SimpleObs()
  readonly onDragEndObservable   = new SimpleObs()

  /** Snap step in degrees (0 = no snap). */
  snapAngle = 0
  /** When true the gizmo rings align with the entity's local rotation. */
  localSpace  = false

  private _scene:        Scene
  private _root:         TransformNode
  private _attachedNode: TransformNode | null = null
  private _enabled       = false

  private _rings:       Ring[] = []
  private _meshToRing   = new Map<Mesh, Ring>()
  private _hoveredRing: Ring | null = null

  private _prePointerObs: Observer<PointerInfoPre> | null = null
  private _pointerObs:    Observer<PointerInfo>    | null = null
  private _renderObs:     Observer<Scene>          | null = null

  // Drag state
  private _dragging           = false
  private _dragRing:          Ring | null = null
  private _dragOriginAngle:   number = 0            // atan2 angle at drag-start
  private _startQuat:         Quaternion | null = null
  private _dragWorldAxis:     Vector3 | null = null  // world-space rotation axis during drag

  constructor(scene: Scene) {
    this._scene = scene
    this._root  = new TransformNode('__gizmo_rot_root', scene)
    this._root.setEnabled(false)

    this._buildMeshes()
    this._setupPrePointer()
    this._setupPointer()
    this._setupRenderLoop()
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get attachedNode(): TransformNode | null { return this._attachedNode }

  set attachedNode(node: TransformNode | null) {
    this._attachedNode = node
    this._enabled = !!node
    this._root.setEnabled(this._enabled)
    if (node) {
      this._syncRoot()
    } else {
      this._updateHover(null)
      for (const r of this._rings) r.mesh.setEnabled(true)
    }
  }

  dispose(): void {
    this._root.setEnabled(false)
    this._scene.onPrePointerObservable.remove(this._prePointerObs)
    this._scene.onPointerObservable.remove(this._pointerObs)
    this._scene.onBeforeRenderObservable.remove(this._renderObs)
    for (const r of this._rings) {
      r.mesh.dispose()
      r.mat.dispose()
    }
    this._root.dispose()
  }

  // ── Mesh building ─────────────────────────────────────────────────────────

  private _buildMeshes(): void {
    const axes = [
      { axis: new Vector3(1, 0, 0), color: new Color3(1,    0.18, 0.18) },
      { axis: new Vector3(0, 1, 0), color: new Color3(0.18, 1,    0.18) },
      { axis: new Vector3(0, 0, 1), color: new Color3(0.18, 0.45, 1   ) },
    ]
    for (const { axis, color } of axes) this._buildRing(axis, color)
  }

  private _buildRing(axis: Vector3, color: Color3): void {
    const mat = new StandardMaterial('', this._scene)
    mat.emissiveColor   = color.clone()
    mat.diffuseColor    = color.clone()
    mat.disableLighting = true
    mat.backFaceCulling = false

    const mesh = MeshBuilder.CreateTorus('', {
      diameter:     TORUS_R * 2,
      thickness:    TORUS_TUBE * 2,
      tessellation: TORUS_SEG,
    }, this._scene)

    // CreateTorus lies in the XZ plane (normal = Y).  Rotate so the ring's
    // normal aligns with `axis`.
    mesh.rotationQuaternion = this._yToDir(axis)
    mesh.parent             = this._root
    mesh.material           = mat
    mesh.renderingGroupId   = GIZMO_RENDER_GROUP
    mesh.isPickable         = true

    const ring: Ring = { axis: axis.clone(), mat, baseColor: color.clone(), mesh }
    this._rings.push(ring)
    this._meshToRing.set(mesh, ring)
  }

  /** Rotation quaternion spinning +Y to align with `dir`. */
  private _yToDir(dir: Vector3): Quaternion {
    const y   = Vector3.Up()
    const dot = Vector3.Dot(y, dir)
    if (dot >  0.9999) return Quaternion.Identity()
    if (dot < -0.9999) return Quaternion.RotationAxis(Vector3.Right(), Math.PI)
    const ax = Vector3.Cross(y, dir).normalize()
    return Quaternion.RotationAxis(ax, Math.acos(dot))
  }

  // ── Frame sync ────────────────────────────────────────────────────────────

  private _getCamera(): Camera | null {
    const cams = this._scene.activeCameras
    return ((cams && cams.length > 0) ? cams[0] : this._scene.activeCamera) as Camera | null
  }

  private _syncRoot(): void {
    if (!this._attachedNode) return
    const worldPos = this._attachedNode.getAbsolutePosition()
    this._root.position.copyFrom(worldPos)
    this._root.rotationQuaternion = this.localSpace
      ? this._attachedNode.absoluteRotationQuaternion.clone()
      : Quaternion.Identity()
    const cam = this._getCamera()
    if (cam) {
      const dist = Vector3.Distance(cam.globalPosition, worldPos)
      this._root.scaling.setAll(dist * SCALE_RATIO)
    }
  }

  private _setupRenderLoop(): void {
    this._renderObs = this._scene.onBeforeRenderObservable.add(() => {
      if (this._enabled) this._syncRoot()
    }) as Observer<Scene>
  }

  // ── Pointer — pre ─────────────────────────────────────────────────────────

  private _setupPrePointer(): void {
    this._prePointerObs = this._scene.onPrePointerObservable.add((preInfo: PointerInfoPre) => {
      if (preInfo.type !== PointerEventTypes.POINTERDOWN) return
      if (this._dragging || !this._enabled) return

      const cam = this._getCamera()
      if (!cam) return

      const ray  = this._scene.createPickingRay(this._scene.pointerX, this._scene.pointerY, null, cam)
      const pick = this._scene.pickWithRay(ray, (m: AbstractMesh) => this._meshToRing.has(m as Mesh))
      if (!pick?.hit || !pick.pickedMesh) return

      const ring = this._meshToRing.get(pick.pickedMesh as Mesh)
      if (!ring || !this._attachedNode) return

      preInfo.skipOnPointerObservable = true
      this._startDrag(ring)
    })
  }

  // ── Pointer — move / up ───────────────────────────────────────────────────

  private _setupPointer(): void {
    this._pointerObs = this._scene.onPointerObservable.add((info: PointerInfo) => {
      if (info.type === PointerEventTypes.POINTERMOVE) {
        if (this._dragging) {
          this._moveDrag()
        } else if (this._enabled) {
          const hit = this._pickGizmoMesh()
          this._updateHover(hit ? (hit as Mesh) : null)
        }
      }
      if (info.type === PointerEventTypes.POINTERUP && this._dragging) this._endDrag()
    })
  }

  private _pickGizmoMesh(): AbstractMesh | null {
    const cam = this._getCamera()
    if (!cam) return null
    const ray  = this._scene.createPickingRay(this._scene.pointerX, this._scene.pointerY, null, cam)
    const pick = this._scene.pickWithRay(ray, (m: AbstractMesh) => this._meshToRing.has(m as Mesh))
    return (pick?.hit && pick.pickedMesh) ? pick.pickedMesh : null
  }

  private _updateHover(mesh: Mesh | null): void {
    const newRing = mesh ? (this._meshToRing.get(mesh) ?? null) : null
    if (newRing === this._hoveredRing) return
    if (this._hoveredRing) {
      this._hoveredRing.mat.emissiveColor = this._hoveredRing.baseColor.clone()
      this._hoveredRing.mat.diffuseColor  = this._hoveredRing.baseColor.clone()
    }
    this._hoveredRing = newRing
    if (newRing) {
      newRing.mat.emissiveColor = HOVER_COLOR.clone()
      newRing.mat.diffuseColor  = HOVER_COLOR.clone()
    }
  }

  // ── Drag ──────────────────────────────────────────────────────────────────

  /**
   * Get world-space position where the view ray intersects the ring's
   * drag plane (passing through the gizmo origin, normal = ring axis).
   */
  private _hitDragPlane(axis: Vector3): Vector3 | null {
    const cam = this._getCamera()
    if (!cam) return null
    const origin = this._attachedNode?.getAbsolutePosition() ?? Vector3.Zero()
    const ray    = this._scene.createPickingRay(this._scene.pointerX, this._scene.pointerY, null, cam)
    const denom  = Vector3.Dot(ray.direction, axis)
    if (Math.abs(denom) < 1e-6) return null
    const t = Vector3.Dot(origin.subtract(ray.origin), axis) / denom
    if (t < 0) return null
    return ray.origin.add(ray.direction.scale(t))
  }

  /** Signed angle of the vector from `origin` to `hit` projected onto the plane with given `axis` as normal. */
  private _projAngle(axis: Vector3, hit: Vector3, origin: Vector3): number {
    const delta = hit.subtract(origin)
    // Build two tangent vectors spanning the plane perpendicular to axis
    const up     = Math.abs(axis.y) < 0.9 ? Vector3.Up() : Vector3.Forward()
    const tang1  = Vector3.Cross(axis, up).normalize()
    const tang2  = Vector3.Cross(axis, tang1).normalize()
    return Math.atan2(Vector3.Dot(delta, tang2), Vector3.Dot(delta, tang1))
  }

  private _startDrag(ring: Ring): void {
    if (!this._attachedNode) return
    // Compute world-space rotation axis: local ring axis transformed if in local-space mode
    const worldAxis = this.localSpace
      ? Vector3.TransformNormal(ring.axis, this._attachedNode.getWorldMatrix()).normalize()
      : ring.axis.clone()
    this._dragWorldAxis = worldAxis

    const origin = this._attachedNode.getAbsolutePosition().clone()
    const hit    = this._hitDragPlane(worldAxis)
    if (!hit) return

    this._dragRing        = ring
    this._dragOriginAngle = this._projAngle(worldAxis, hit, origin)

    // Snapshot the starting orientation
    if (this._attachedNode.rotationQuaternion) {
      this._startQuat = this._attachedNode.rotationQuaternion.clone()
    } else {
      this._startQuat = Quaternion.FromEulerVector(this._attachedNode.rotation)
    }
    // Switch node to quaternion mode so we don't clobber euler angles mid-drag
    this._attachedNode.rotationQuaternion = this._startQuat.clone()

    this._dragging = true

    // Hide inactive rings
    for (const r of this._rings) {
      const isActive = r === ring
      r.mesh.setEnabled(isActive)
      if (!isActive && r === this._hoveredRing) {
        r.mat.emissiveColor = r.baseColor.clone()
        r.mat.diffuseColor  = r.baseColor.clone()
        this._hoveredRing   = null
      }
    }

    this.onDragStartObservable.notify()
  }

  private _moveDrag(): void {
    if (!this._attachedNode || !this._dragRing || !this._startQuat || !this._dragWorldAxis) return

    const origin = this._attachedNode.getAbsolutePosition().clone()
    const hit    = this._hitDragPlane(this._dragWorldAxis)
    if (!hit) return

    const curAngle = this._projAngle(this._dragWorldAxis, hit, origin)
    let   deltaDeg = (curAngle - this._dragOriginAngle) * (180 / Math.PI)

    // Normalise to (-180, 180]
    while (deltaDeg >  180) deltaDeg -= 360
    while (deltaDeg < -180) deltaDeg += 360

    if (this.snapAngle > 0) {
      deltaDeg = Math.round(deltaDeg / this.snapAngle) * this.snapAngle
    }

    const deltaRad = deltaDeg * DEG2RAD
    const rotDelta = Quaternion.RotationAxis(this._dragWorldAxis, deltaRad)
    this._attachedNode.rotationQuaternion = this._startQuat.multiply(rotDelta)

    this.onDragObservable.notify()
  }

  private _endDrag(): void {
    this._dragging = false

    // Restore all rings
    for (const r of this._rings) r.mesh.setEnabled(true)
    if (this._hoveredRing) {
      this._hoveredRing.mat.emissiveColor = this._hoveredRing.baseColor.clone()
      this._hoveredRing.mat.diffuseColor  = this._hoveredRing.baseColor.clone()
      this._hoveredRing = null
    }

    this._dragRing        = null
    this._startQuat       = null
    this._dragWorldAxis   = null

    this.onDragEndObservable.notify()
  }
}
