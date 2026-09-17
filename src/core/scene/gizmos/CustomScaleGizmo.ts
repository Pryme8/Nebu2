/**
 * CustomScaleGizmo — three axis arrows with box tips + a centre white cube
 * for uniform scale.
 *
 * Axis drag: projects onto the axis and applies a multiplicative scale delta
 * to the single axis component.
 *
 * Centre box drag: applies the same delta to all three axes equally.
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

const SCALE_RATIO = 0.12
const HOVER_COLOR = new Color3(1, 1, 0)

const SHAFT_LEN    = 0.85
const SHAFT_R      = 0.025
const BOX_SIZE     = 0.1
const TESS         = 8

const CENTER_BOX   = 0.12

const PLANE_SIZE   = 0.18
const PLANE_OFFSET = 0.22

// ── Minimal observable ─────────────────────────────────────────────────────

type VoidFn = () => void

class SimpleObs {
  private _fns: VoidFn[] = []
  add(fn: VoidFn): VoidFn  { this._fns.push(fn); return fn }
  remove(fn: VoidFn): void { this._fns = this._fns.filter(f => f !== fn) }
  notify(): void           { [...this._fns].forEach(f => f()) }
}

// ── Arrow descriptor ───────────────────────────────────────────────────────

interface Arrow {
  /** null = uniform (centre box) */
  dir:       Vector3 | null
  mat:       StandardMaterial
  baseColor: Color3
  meshes:    Mesh[]
}

interface PlaneHandle {
  /** The two axes this plane scales */
  axes:      [Vector3, Vector3]
  mat:       StandardMaterial
  baseColor: Color3
  meshes:    Mesh[]
}

// ── Class ─────────────────────────────────────────────────────────────────

export class CustomScaleGizmo {

  readonly onDragStartObservable = new SimpleObs()
  readonly onDragObservable      = new SimpleObs()
  readonly onDragEndObservable   = new SimpleObs()

  /** Snap increment for scale (0 = no snap). */
  snapIncrement = 0

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
  private _dragging          = false
  private _dragArrow:        Arrow | null = null
  /** World-space axis or null for uniform drag */
  private _dragAxis:         Vector3 | null = null
  private _dragStartScale:   Vector3 | null = null
  /** Screen-space Y at drag-start; vertical drag controls magnitude */
  private _dragStartScreenY: number = 0

  /** Active plane handle during drag (null = arrow/centre drag) */
  private _dragPlane:        PlaneHandle | null = null

  constructor(scene: Scene) {
    this._scene = scene
    this._root  = new TransformNode('__gizmo_scale_root', scene)
    this._root.setEnabled(false)

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
    this._buildCenterBox()

    // Planar handles — coloured by the excluded axis
    const planes = [
      { n: new Vector3(0, 0, 1), axes: [new Vector3(1,0,0), new Vector3(0,1,0)] as [Vector3,Vector3], color: new Color3(0.18, 0.45, 1   ) }, // XY
      { n: new Vector3(0, 1, 0), axes: [new Vector3(1,0,0), new Vector3(0,0,1)] as [Vector3,Vector3], color: new Color3(0.18, 1,    0.18) }, // XZ
      { n: new Vector3(1, 0, 0), axes: [new Vector3(0,1,0), new Vector3(0,0,1)] as [Vector3,Vector3], color: new Color3(1,    0.18, 0.18) }, // YZ
    ]
    for (const { n, axes: pAxes, color } of planes) this._buildPlane(n, pAxes, color)
  }

  private _buildArrow(dir: Vector3, color: Color3): void {
    const mat = new StandardMaterial('', this._scene)
    mat.emissiveColor   = color.clone()
    mat.diffuseColor    = color.clone()
    mat.disableLighting = true

    const rotQ = this._yToDir(dir)

    const shaft = MeshBuilder.CreateCylinder('', {
      height: SHAFT_LEN, diameter: SHAFT_R * 2, tessellation: TESS,
    }, this._scene)
    shaft.rotationQuaternion = rotQ.clone()
    shaft.position.copyFrom(dir.scale(SHAFT_LEN / 2))

    const box = MeshBuilder.CreateBox('', { size: BOX_SIZE }, this._scene)
    box.position.copyFrom(dir.scale(SHAFT_LEN + BOX_SIZE / 2))

    const arrow: Arrow = { dir: dir.clone(), mat, baseColor: color.clone(), meshes: [shaft, box] }
    this._arrows.push(arrow)

    for (const m of [shaft, box]) {
      m.parent           = this._root
      m.material         = mat
      m.renderingGroupId = GIZMO_RENDER_GROUP
      m.isPickable       = true
      this._meshToArrow.set(m, arrow)
    }
  }

  private _buildCenterBox(): void {
    const color = new Color3(1, 1, 1)
    const mat   = new StandardMaterial('', this._scene)
    mat.emissiveColor   = color.clone()
    mat.diffuseColor    = color.clone()
    mat.disableLighting = true

    const box = MeshBuilder.CreateBox('', { size: CENTER_BOX }, this._scene)
    box.parent           = this._root
    box.material         = mat
    box.renderingGroupId = GIZMO_RENDER_GROUP
    box.isPickable       = true

    const arrow: Arrow = { dir: null, mat, baseColor: color.clone(), meshes: [box] }
    this._arrows.push(arrow)
    this._meshToArrow.set(box, arrow)
  }

  private _buildPlane(normal: Vector3, axes: [Vector3, Vector3], color: Color3): void {
    const mat = new StandardMaterial('', this._scene)
    mat.emissiveColor   = color.clone()
    mat.diffuseColor    = color.clone()
    mat.disableLighting = true
    mat.backFaceCulling = false
    mat.alpha           = 0.4

    const mesh = MeshBuilder.CreatePlane('', { size: PLANE_SIZE }, this._scene)
    mesh.rotationQuaternion = this._zToDir(normal)
    mesh.position.set(
      (1 - Math.abs(normal.x)) * PLANE_OFFSET,
      (1 - Math.abs(normal.y)) * PLANE_OFFSET,
      (1 - Math.abs(normal.z)) * PLANE_OFFSET,
    )

    const handle: PlaneHandle = { axes, mat, baseColor: color.clone(), meshes: [mesh] }
    this._planes.push(handle)

    mesh.parent           = this._root
    mesh.material         = mat
    mesh.renderingGroupId = GIZMO_RENDER_GROUP
    mesh.isPickable       = true
    this._meshToPlane.set(mesh, handle)
  }

  private _yToDir(dir: Vector3): Quaternion {
    const y   = Vector3.Up()
    const dot = Vector3.Dot(y, dir)
    if (dot >  0.9999) return Quaternion.Identity()
    if (dot < -0.9999) return Quaternion.RotationAxis(Vector3.Right(), Math.PI)
    const axis = Vector3.Cross(y, dir).normalize()
    return Quaternion.RotationAxis(axis, Math.acos(dot))
  }

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
    // Scale is always in local space — handles align with entity local axes
    this._root.rotationQuaternion = this._attachedNode.absoluteRotationQuaternion.clone()
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
      const pick = this._scene.pickWithRay(ray, (m: AbstractMesh) =>
        this._meshToArrow.has(m as Mesh) || this._meshToPlane.has(m as Mesh),
      )
      if (!pick?.hit || !pick.pickedMesh || !this._attachedNode) return

      const arrow = this._meshToArrow.get(pick.pickedMesh as Mesh)
      const plane = this._meshToPlane.get(pick.pickedMesh as Mesh)
      if (!arrow && !plane) return

      preInfo.skipOnPointerObservable = true
      if (arrow) this._startDrag(arrow, preInfo.event.y)
      else if (plane) this._startPlaneDrag(plane, preInfo.event.y)
    })
  }

  // ── Pointer — move / up ───────────────────────────────────────────────────

  private _setupPointer(): void {
    this._pointerObs = this._scene.onPointerObservable.add((info: PointerInfo) => {
      if (info.type === PointerEventTypes.POINTERMOVE) {
        if (this._dragging) {
          this._moveDrag(info.event.y)
        } else if (this._enabled) {
          const hit = this._pickGizmoMesh()
          this._updateHover(hit ? (hit as Mesh) : null)
        }
      }
      if (info.type === PointerEventTypes.POINTERUP && this._dragging) this._endDrag()    })
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

  // ── Drag ──────────────────────────────────────────────────────────────────

  private _startDrag(arrow: Arrow, screenY: number): void {
    if (!this._attachedNode) return

    this._dragArrow        = arrow
    this._dragAxis         = arrow.dir ? arrow.dir.clone() : null
    this._dragStartScale   = this._attachedNode.scaling.clone()
    this._dragStartScreenY = screenY
    this._dragging         = true

    // Hide inactive arrows and all planes
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

  private _startPlaneDrag(plane: PlaneHandle, screenY: number): void {
    if (!this._attachedNode) return

    this._dragPlane        = plane
    this._dragAxis         = null
    this._dragStartScale   = this._attachedNode.scaling.clone()
    this._dragStartScreenY = screenY
    this._dragging         = true

    // Show only the active plane; hide others and all arrows
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

  private _moveDrag(screenY: number): void {
    if (!this._attachedNode || !this._dragStartScale) return
    if (!this._dragArrow && !this._dragPlane) return

    // Drag up = scale up; 200px = +1.0 multiplier
    let delta = -(screenY - this._dragStartScreenY) / 200

    if (this.snapIncrement > 0) {
      delta = Math.round(delta / this.snapIncrement) * this.snapIncrement
    }

    const newScale = this._dragStartScale.clone()

    if (this._dragPlane) {
      // Two-axis plane drag: scale both axes equally by delta
      for (const axis of this._dragPlane.axes) {
        newScale.x += axis.x * delta
        newScale.y += axis.y * delta
        newScale.z += axis.z * delta
      }
    } else if (this._dragAxis) {
      // Single axis: add delta to that component only
      newScale.x += this._dragAxis.x * delta
      newScale.y += this._dragAxis.y * delta
      newScale.z += this._dragAxis.z * delta
    } else {
      // Uniform: add delta to all components
      newScale.x += delta
      newScale.y += delta
      newScale.z += delta
    }

    // Clamp to a tiny positive value to avoid zero/negative scale weirdness
    newScale.x = Math.max(0.0001, newScale.x)
    newScale.y = Math.max(0.0001, newScale.y)
    newScale.z = Math.max(0.0001, newScale.z)

    this._attachedNode.scaling.copyFrom(newScale)

    this.onDragObservable.notify()
  }

  private _endDrag(): void {
    this._dragging       = false
    this._dragArrow      = null
    this._dragPlane      = null
    this._dragAxis       = null
    this._dragStartScale = null

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
