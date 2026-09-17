/**
 * CustomPositionGizmo — three axis arrows built from plain Babylon meshes.
 *
 * Uses renderingGroupId = 4 with depth cleared before that group so the axes
 * always render on top of scene geometry.  No UtilityLayerRenderer, no static
 * singletons, no camera-wiring required.
 *
 * Drag: onPrePointerObservable is used to detect gizmo hits and set
 * skipOnPointerObservable = true, preventing the ArcRotateCamera from
 * starting an orbit on the same pointer-down.
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

// ── Constants ──────────────────────────────────────────────────────────────

export const GIZMO_RENDER_GROUP = 3
const SCALE_RATIO = 0.12   // world-units per unit of camera distance

const HOVER_COLOR = new Color3(1, 1, 0)

const SHAFT_LEN    = 0.85
const CONE_LEN     = 0.15
const SHAFT_R      = 0.025
const CONE_R       = 0.075
const TESS         = 8

const PLANE_SIZE   = 0.18   // square side-length of each planar handle
const PLANE_OFFSET = 0.22   // centre of the square along each of its two axes

// ── Minimal observable ─────────────────────────────────────────────────────

type VoidFn = () => void

class SimpleObs {
  private _fns: VoidFn[] = []
  add(fn: VoidFn): VoidFn       { this._fns.push(fn); return fn }
  remove(fn: VoidFn): void      { this._fns = this._fns.filter(f => f !== fn) }
  notify(): void                { [...this._fns].forEach(f => f()) }
}

// ── Arrow descriptor ───────────────────────────────────────────────────────

interface Arrow {
  dir:       Vector3
  mat:       StandardMaterial
  baseColor: Color3
  meshes:    Mesh[]
}

interface PlaneHandle {
  normal:    Vector3
  mat:       StandardMaterial
  baseColor: Color3
  meshes:    Mesh[]
}

// ── Class ─────────────────────────────────────────────────────────────────

export class CustomPositionGizmo {

  readonly onDragStartObservable = new SimpleObs()
  readonly onDragObservable      = new SimpleObs()
  readonly onDragEndObservable   = new SimpleObs()

  snapDistance = 0
  /** When true the gizmo axes align with the entity's local rotation. */
  localSpace    = false

  private _scene:        Scene
  private _root:         TransformNode
  private _attachedNode: TransformNode | null = null
  private _enabled       = false

  private _arrows:      Arrow[] = []
  private _meshToArrow  = new Map<Mesh, Arrow>()
  private _hoveredArrow: Arrow | null = null

  private _planes:      PlaneHandle[] = []
  private _meshToPlane  = new Map<Mesh, PlaneHandle>()
  private _hoveredPlane: PlaneHandle | null = null

  private _prePointerObs: Observer<PointerInfoPre> | null = null
  private _pointerObs:    Observer<PointerInfo>    | null = null
  private _renderObs:     Observer<Scene>          | null = null

  // Drag state
  private _dragging           = false
  private _dragAxis:          Vector3 | null = null
  private _dragPlaneOrigin:   Vector3 | null = null
  private _dragPlaneNormal:   Vector3 | null = null
  private _dragOriginHit:     Vector3 | null = null
  private _nodeStartLocalPos: Vector3 | null = null

  constructor(scene: Scene) {
    this._scene = scene
    this._root  = new TransformNode('__gizmo_pos_root', scene)
    this._root.setEnabled(false)

    // Group 4 renders after group 0.  Clearing depth before it makes
    // all group-4 objects render on top of main-scene geometry.
    scene.setRenderingAutoClearDepthStencil(GIZMO_RENDER_GROUP, true, true, false)

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
      for (const a of this._arrows) {
        for (const m of a.meshes) m.setEnabled(true)
      }
      for (const p of this._planes) {
        for (const m of p.meshes) m.setEnabled(true)
      }
    }
  }

  dispose(): void {
    this._root.setEnabled(false)
    this._scene.onPrePointerObservable.remove(this._prePointerObs)
    this._scene.onPointerObservable.remove(this._pointerObs)
    this._scene.onBeforeRenderObservable.remove(this._renderObs)
    for (const a of this._arrows) {
      for (const m of a.meshes) m.dispose()
      a.mat.dispose()
    }
    for (const p of this._planes) {
      for (const m of p.meshes) m.dispose()
      p.mat.dispose()
    }
    this._root.dispose()
  }

  // ── Mesh building ─────────────────────────────────────────────────────────

  private _buildMeshes(): void {
    const axes = [
      { dir: new Vector3(1, 0, 0), color: new Color3(1,    0.18, 0.18) },
      { dir: new Vector3(0, 1, 0), color: new Color3(0.18, 1,    0.18) },
      { dir: new Vector3(0, 0, 1), color: new Color3(0.18, 0.45, 1   ) },
    ]
    for (const { dir, color } of axes) this._buildArrow(dir, color)

    // Planar handles — each coloured by its perpendicular (normal) axis
    const planes = [
      { n: new Vector3(0, 0, 1), color: new Color3(0.18, 0.45, 1   ) }, // XY → Z color
      { n: new Vector3(0, 1, 0), color: new Color3(0.18, 1,    0.18) }, // XZ → Y color
      { n: new Vector3(1, 0, 0), color: new Color3(1,    0.18, 0.18) }, // YZ → X color
    ]
    for (const { n, color } of planes) this._buildPlane(n, color)
  }

  private _buildArrow(dir: Vector3, color: Color3): void {
    const mat = new StandardMaterial('', this._scene)
    mat.emissiveColor   = color.clone()
    mat.diffuseColor    = color.clone()
    mat.disableLighting = true

    const shaft = MeshBuilder.CreateCylinder('', {
      height: SHAFT_LEN, diameter: SHAFT_R * 2, tessellation: TESS,
    }, this._scene)

    const tip = MeshBuilder.CreateCylinder('', {
      height: CONE_LEN, diameterBottom: CONE_R * 2, diameterTop: 0, tessellation: TESS,
    }, this._scene)

    const rotQ = this._yToDir(dir)
    shaft.rotationQuaternion = rotQ.clone()
    tip.rotationQuaternion   = rotQ.clone()

    shaft.position.copyFrom(dir.scale(SHAFT_LEN / 2))
    tip.position.copyFrom(dir.scale(SHAFT_LEN + CONE_LEN / 2))

    const arrow: Arrow = { dir: dir.clone(), mat, baseColor: color.clone(), meshes: [shaft, tip] }
    this._arrows.push(arrow)

    for (const m of [shaft, tip]) {
      m.parent           = this._root
      m.material         = mat
      m.renderingGroupId = GIZMO_RENDER_GROUP
      m.isPickable       = true
      this._meshToArrow.set(m, arrow)
    }
  }

  private _buildPlane(normal: Vector3, color: Color3): void {
    const mat = new StandardMaterial('', this._scene)
    mat.emissiveColor   = color.clone()
    mat.diffuseColor    = color.clone()
    mat.disableLighting = true
    mat.backFaceCulling = false
    mat.alpha           = 0.4

    const mesh = MeshBuilder.CreatePlane('', { size: PLANE_SIZE }, this._scene)
    mesh.rotationQuaternion = this._zToDir(normal)

    // Centre the quad along the two non-normal axes at PLANE_OFFSET
    mesh.position.set(
      (1 - Math.abs(normal.x)) * PLANE_OFFSET,
      (1 - Math.abs(normal.y)) * PLANE_OFFSET,
      (1 - Math.abs(normal.z)) * PLANE_OFFSET,
    )

    const handle: PlaneHandle = { normal: normal.clone(), mat, baseColor: color.clone(), meshes: [mesh] }
    this._planes.push(handle)

    mesh.parent           = this._root
    mesh.material         = mat
    mesh.renderingGroupId = GIZMO_RENDER_GROUP
    mesh.isPickable       = true
    this._meshToPlane.set(mesh, handle)
  }

  /** Rotation quaternion that spins the Y-axis cylinder to point along `dir`. */

  private _yToDir(dir: Vector3): Quaternion {
    const y   = Vector3.Up()
    const dot = Vector3.Dot(y, dir)
    if (dot >  0.9999) return Quaternion.Identity()
    if (dot < -0.9999) return Quaternion.RotationAxis(Vector3.Right(), Math.PI)
    const axis = Vector3.Cross(y, dir).normalize()
    return Quaternion.RotationAxis(axis, Math.acos(dot))
  }

  /** Rotation quaternion that spins the +Z face of CreatePlane to align with `dir`. */
  private _zToDir(dir: Vector3): Quaternion {
    const z   = new Vector3(0, 0, 1)
    const dot = Vector3.Dot(z, dir)
    if (dot >  0.9999) return Quaternion.Identity()
    if (dot < -0.9999) return Quaternion.RotationAxis(Vector3.Up(), Math.PI)
    const axis = Vector3.Cross(z, dir).normalize()
    return Quaternion.RotationAxis(axis, Math.acos(dot))
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

  // ── Pointer — pre (consumes event so camera doesn't orbit) ───────────────

  private _setupPrePointer(): void {
    this._prePointerObs = this._scene.onPrePointerObservable.add((preInfo: PointerInfoPre) => {
      if (preInfo.type !== PointerEventTypes.POINTERDOWN) return
      if (this._dragging || !this._enabled) return

      const cam = this._getCamera()
      if (!cam) return

      const ray = this._scene.createPickingRay(
        this._scene.pointerX,
        this._scene.pointerY,
        null,
        cam,
      )
      const pick = this._scene.pickWithRay(ray, (mesh: AbstractMesh) =>
        this._meshToArrow.has(mesh as Mesh) || this._meshToPlane.has(mesh as Mesh),
      )
      if (!pick?.hit || !pick.pickedMesh || !this._attachedNode) return

      const arrow = this._meshToArrow.get(pick.pickedMesh as Mesh)
      const plane = this._meshToPlane.get(pick.pickedMesh as Mesh)

      // Block camera orbit on this pointer-down
      preInfo.skipOnPointerObservable = true
      if (arrow)      this._startAxisDrag(arrow)
      else if (plane) this._startPlaneDrag(plane)
    })
  }

  // ── Pointer — post (move / up) ────────────────────────────────────────────

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
    const pick = this._scene.pickWithRay(ray, (m: AbstractMesh) =>
      this._meshToArrow.has(m as Mesh) || this._meshToPlane.has(m as Mesh),
    )
    return (pick?.hit && pick.pickedMesh) ? pick.pickedMesh : null
  }

  private _updateHover(mesh: Mesh | null): void {
    const newArrow = mesh ? (this._meshToArrow.get(mesh) ?? null) : null
    const newPlane = mesh ? (this._meshToPlane.get(mesh) ?? null) : null

    if (newArrow !== this._hoveredArrow) {
      if (this._hoveredArrow) {
        this._hoveredArrow.mat.emissiveColor = this._hoveredArrow.baseColor.clone()
        this._hoveredArrow.mat.diffuseColor  = this._hoveredArrow.baseColor.clone()
      }
      this._hoveredArrow = newArrow
      if (newArrow) {
        newArrow.mat.emissiveColor = HOVER_COLOR.clone()
        newArrow.mat.diffuseColor  = HOVER_COLOR.clone()
      }
    }

    if (newPlane !== this._hoveredPlane) {
      if (this._hoveredPlane) {
        this._hoveredPlane.mat.emissiveColor = this._hoveredPlane.baseColor.clone()
        this._hoveredPlane.mat.diffuseColor  = this._hoveredPlane.baseColor.clone()
      }
      this._hoveredPlane = newPlane
      if (newPlane) {
        newPlane.mat.emissiveColor = HOVER_COLOR.clone()
        newPlane.mat.diffuseColor  = HOVER_COLOR.clone()
      }
    }
  }

  // ── Drag helpers ──────────────────────────────────────────────────────────

  private _buildPlaneNormal(axis: Vector3, worldPos: Vector3): Vector3 {
    const cam = this._getCamera()
    if (!cam) return axis.clone()
    const camDir = worldPos.subtract(cam.globalPosition).normalize()
    const perp   = Vector3.Cross(camDir, axis)
    if (perp.lengthSquared() < 1e-6) {
      // axis is nearly parallel to camera direction — fall back to camera up
      return Vector3.Cross(cam.upVector, axis).normalize()
    }
    return Vector3.Cross(axis, perp).normalize()
  }

  private _rayHitPlane(origin: Vector3, normal: Vector3): Vector3 | null {
    const cam = this._getCamera()
    if (!cam) return null
    const ray   = this._scene.createPickingRay(this._scene.pointerX, this._scene.pointerY, null, cam)
    const denom = Vector3.Dot(ray.direction, normal)
    if (Math.abs(denom) < 1e-6) return null
    const t = Vector3.Dot(origin.subtract(ray.origin), normal) / denom
    if (t < 0) return null
    return ray.origin.add(ray.direction.scale(t))
  }

  private _startAxisDrag(arrow: Arrow): void {
    if (!this._attachedNode) return
    const worldPos  = this._attachedNode.getAbsolutePosition().clone()
    const worldAxis = this.localSpace
      ? Vector3.TransformNormal(arrow.dir, this._attachedNode.getWorldMatrix()).normalize()
      : arrow.dir.clone()
    const normal    = this._buildPlaneNormal(worldAxis, worldPos)
    const hit       = this._rayHitPlane(worldPos, normal) ?? worldPos.clone()

    this._dragAxis          = worldAxis
    this._dragPlaneOrigin   = worldPos
    this._dragPlaneNormal   = normal
    this._dragOriginHit     = hit
    this._nodeStartLocalPos = this._attachedNode.position.clone()
    this._dragging          = true

    // Show only the active arrow; hide all others and all planes
    for (const a of this._arrows) {
      const isActive = a === arrow
      for (const m of a.meshes) m.setEnabled(isActive)
      if (!isActive && a === this._hoveredArrow) {
        a.mat.emissiveColor = a.baseColor.clone()
        a.mat.diffuseColor  = a.baseColor.clone()
        this._hoveredArrow  = null
      }
    }
    for (const p of this._planes) {
      for (const m of p.meshes) m.setEnabled(false)
    }

    this.onDragStartObservable.notify()
  }

  private _startPlaneDrag(plane: PlaneHandle): void {
    if (!this._attachedNode) return
    const worldPos    = this._attachedNode.getAbsolutePosition().clone()
    const worldNormal = this.localSpace
      ? Vector3.TransformNormal(plane.normal, this._attachedNode.getWorldMatrix()).normalize()
      : plane.normal.clone()
    const hit = this._rayHitPlane(worldPos, worldNormal) ?? worldPos.clone()

    this._dragAxis          = null   // null → planar drag branch in _moveDrag
    this._dragPlaneOrigin   = worldPos
    this._dragPlaneNormal   = worldNormal
    this._dragOriginHit     = hit
    this._nodeStartLocalPos = this._attachedNode.position.clone()
    this._dragging          = true

    // Show only the active plane; hide all others and all arrows
    for (const p of this._planes) {
      const isActive = p === plane
      for (const m of p.meshes) m.setEnabled(isActive)
      if (!isActive && p === this._hoveredPlane) {
        p.mat.emissiveColor = p.baseColor.clone()
        p.mat.diffuseColor  = p.baseColor.clone()
        this._hoveredPlane  = null
      }
    }
    for (const a of this._arrows) {
      for (const m of a.meshes) m.setEnabled(false)
    }

    this.onDragStartObservable.notify()
  }

  private _moveDrag(): void {
    if (
      !this._attachedNode     ||
      !this._dragPlaneOrigin  ||
      !this._dragPlaneNormal  ||
      !this._dragOriginHit    ||
      !this._nodeStartLocalPos
    ) return

    const hit = this._rayHitPlane(this._dragPlaneOrigin, this._dragPlaneNormal)
    if (!hit) return

    const parent = this._attachedNode.parent

    if (this._dragAxis) {
      // Axis drag: project the hit delta onto the single constrained axis
      let proj = Vector3.Dot(hit.subtract(this._dragOriginHit), this._dragAxis)
      if (this.snapDistance > 0) {
        proj = Math.round(proj / this.snapDistance) * this.snapDistance
      }
      let localDelta: Vector3
      if (parent) {
        const invParent = (parent as TransformNode).getWorldMatrix().clone().invert()
        localDelta = Vector3.TransformNormal(this._dragAxis.scale(proj), invParent)
      } else {
        localDelta = this._dragAxis.scale(proj)
      }
      this._attachedNode.position.copyFrom(this._nodeStartLocalPos.add(localDelta))
    } else {
      // Plane drag: apply the full 2D world-space delta within the plane
      const worldDelta = hit.subtract(this._dragOriginHit)
      let localDelta: Vector3
      if (parent) {
        const invParent = (parent as TransformNode).getWorldMatrix().clone().invert()
        localDelta = Vector3.TransformNormal(worldDelta, invParent)
      } else {
        localDelta = worldDelta
      }
      this._attachedNode.position.copyFrom(this._nodeStartLocalPos.add(localDelta))
    }

    this.onDragObservable.notify()
  }

  private _endDrag(): void {
    this._dragging          = false
    this._dragAxis          = null
    this._dragPlaneOrigin   = null
    this._dragPlaneNormal   = null
    this._dragOriginHit     = null
    this._nodeStartLocalPos = null

    // Restore all arrows and planes
    for (const a of this._arrows) {
      for (const m of a.meshes) m.setEnabled(true)
    }
    if (this._hoveredArrow) {
      this._hoveredArrow.mat.emissiveColor = this._hoveredArrow.baseColor.clone()
      this._hoveredArrow.mat.diffuseColor  = this._hoveredArrow.baseColor.clone()
      this._hoveredArrow = null
    }
    for (const p of this._planes) {
      for (const m of p.meshes) m.setEnabled(true)
    }
    if (this._hoveredPlane) {
      this._hoveredPlane.mat.emissiveColor = this._hoveredPlane.baseColor.clone()
      this._hoveredPlane.mat.diffuseColor  = this._hoveredPlane.baseColor.clone()
      this._hoveredPlane = null
    }

    this.onDragEndObservable.notify()
  }
}
