import { Component }            from '../Component'
import { TransformComponent, type Vec3 }            from './TransformComponent'
import type { InspectorSchema } from '@/types/inspector'
import type { WidgetSchema, WidgetPoint } from '@/types/widget'
import { boxWireframe }         from '@/lib/widgetShapes'
import {
  type UniversalCamera as BabylonUniversalCamera,
  type ArcRotateCamera as BabylonArcRotateCamera,
  type Observer,
  type Scene,
  Vector3,
  Matrix,
  TransformNode,
} from '@babylonjs/core'
import type { World } from '../World'

// ── Camera type union ─────────────────────────────────────────────────────

export type CameraType = 'UniversalCamera' | 'ArcRotateCamera'

export type BabylonCameraInstance = BabylonUniversalCamera | BabylonArcRotateCamera

// ── Options for each camera type ──────────────────────────────────────────

/** Properties specific to UniversalCamera. */
export interface UniversalCameraOptions {
  speed: number
}

/** Properties specific to ArcRotateCamera. */
export interface ArcRotateCameraOptions {
  target: Vec3
  alpha:  number   // radians — azimuth
  beta:   number   // radians — elevation
  radius: number
}

/**
 * CameraComponent — ECS representation of a Babylon.js camera.
 *
 * Supports UniversalCamera and ArcRotateCamera. Switching `cameraType` causes
 * `syncToBabylon()` to dispose the existing Babylon camera and create a new
 * one of the chosen type.
 *
 * `isMainCamera` — only one camera in the scene should have this flag set.
 * When it becomes true, the sceneStore calls the registered `onMainCameraSet`
 * callback which un-flags every other camera in the world.
 *
 * `babylonCamera` is set by sceneStore and is never serialised.
 */
export class CameraComponent extends Component {
  readonly type = 'Camera'

  // ── Shared ────────────────────────────────────────────────────
  cameraType:     CameraType = 'UniversalCamera'
  fov:            number     = 0.8      // radians (~46°)
  minZ:           number     = 0.1
  maxZ:           number     = 1000
  isMainCamera:   boolean    = false
  attachControls: boolean    = false

  // ── UniversalCamera ───────────────────────────────────────────
  speed: number = 2

  // ── ArcRotateCamera ───────────────────────────────────────────
  target: Vec3   = { x: 0, y: 0, z: 0 }
  alpha:  number = -1.5708   // ≈ -π/2 — looking down +Z
  beta:   number = 1.0472    // ≈ π/3  — 60° above horizon
  radius: number = 10

  // ── Entity look-at target (serialised) ───────────────────────
  /** Entity ID to continuously point the camera at. Null = disabled. */
  targetEntityId: string | null = null

  // ── Runtime refs — not serialised ─────────────────────────────
  babylonCamera: BabylonCameraInstance | null = null
  private _runtimeTargetObs: Observer<Scene> | null = null
  private _targetEntityUnsub: (() => void) | null   = null
  private _trackedTargetId:   string | null          = null
  /** Live reference to the world — set by onCreate, cleared by onDispose. */
  private _world: World | null = null
  /** Live reference to the babylonScene — set by onCreate, cleared by onDispose. */
  private _scene: Scene | null = null

  /**
   * Called by sceneStore._createBabylonCamera after the Babylon camera has been
   * assigned to `this.babylonCamera`.
   *
   * Sets up:
   *  1. A per-frame observable that aims the camera at `targetEntityId`.
   *  2. A TransformComponent.onChange subscription on the target entity so
   *     that the look-at is re-applied immediately whenever the target moves
   *     (avoids waiting a full frame during editor-time transforms).
   *  3. A self-onChange subscription that refreshes the above two when
   *     `targetEntityId` is changed in the Inspector.
   */
  onCreate(babylonScene: Scene, world: World): void {
    this._world = world
    this._scene = babylonScene
    this._refreshTargetWiring()

    // Watch for Inspector changes to targetEntityId.
    this.onChange(() => {
      if (this.targetEntityId !== this._trackedTargetId) {
        this._refreshTargetWiring()
      }
    })
  }

  /** Remove all per-frame and per-change observables when the camera is disposed. */
  onDispose(): void {
    this._clearTargetWiring()
    this._world = null
    this._scene = null
  }

  // ── Target look-at helpers ────────────────────────────────────

  private _refreshTargetWiring(): void {
    this._clearTargetWiring()
    this._trackedTargetId = this.targetEntityId
    if (!this.targetEntityId || !this._scene || !this._world) return

    // Apply immediately so there is no one-frame lag.
    this.applyLookAt()

    // Subscribe to the target's TransformComponent so the camera updates
    // whenever the target is moved (e.g. by a gizmo or another script).
    const te = this._world.getEntity(this.targetEntityId)
    const tt = te?.getComponent<TransformComponent>('Transform')
    if (tt) {
      this._targetEntityUnsub = tt.onChange(() => this.applyLookAt())
    }

    // Also run every frame so that the camera tracks smoothly during play.
    this._runtimeTargetObs = this._scene.onBeforeRenderObservable.add(() => this.applyLookAt())
  }

  private _clearTargetWiring(): void {
    this._runtimeTargetObs?.remove()
    this._runtimeTargetObs = null
    this._targetEntityUnsub?.()
    this._targetEntityUnsub = null
  }

  /**
   * Aim the camera at a target.
   *
   * @param node - Optional TransformNode to look at directly.
   *               When omitted the component resolves its own `targetEntityId`.
   */
  applyLookAt(node?: TransformNode | Vector3): void {
    const cam = this.babylonCamera
    if (!cam) return

    // Resolve world-space target position.
    let worldTarget: Vector3 | null = null

    if (node instanceof Vector3) {
      worldTarget = node
    } else {
      let targetNode: TransformNode | null = node ?? null
      if (!targetNode) {
        if (!this.targetEntityId || !this._world) return
        const te = this._world.getEntity(this.targetEntityId)
        const tt = te?.getComponent<TransformComponent>('Transform')
        targetNode = tt?.babylonNode ?? null
      }
      if (!targetNode) return
      targetNode.computeWorldMatrix(true)
      worldTarget = targetNode.getAbsolutePosition()
    }

    if (!worldTarget) return

    let localTarget: Vector3 = worldTarget
    if (cam.parent) {
      try {
        cam.parent.computeWorldMatrix(true)
        const invParent = Matrix.Invert(cam.parent.getWorldMatrix())
        localTarget = Vector3.TransformCoordinates(
          worldTarget.subtract(cam.globalPosition),
          invParent,
        )
      } catch {
        return
      }
    }

    try {
      cam.setTarget(localTarget)
    } catch {
      // Camera not ready — will be retried next frame.
    }
  }
  /**
   * Callback set by sceneStore when the component is wired up.
   * Called inside syncToBabylon() whenever isMainCamera becomes true, so the
   * store can un-flag every other camera in the world.
   */
  onMainCameraSet: (() => void) | null = null

  // ── Inspector schema ──────────────────────────────────────────

  override onInspectorDraw(): InspectorSchema {
    const section: InspectorSchema[0] = {
      title: 'Camera',
      fields: [
        { key: 'showWidget', label: 'Show Widget', type: 'boolean' },
        {
          key:     'cameraType',
          label:   'Type',
          type:    'enum',
          options: [
            { label: 'Universal Camera',  value: 'UniversalCamera'  },
            { label: 'Arc Rotate Camera', value: 'ArcRotateCamera'  },
          ],
        },
        { key: 'isMainCamera',   label: 'Main Camera',     type: 'boolean' },
        { key: 'attachControls', label: 'Attach Controls', type: 'boolean' },
        { key: 'fov',  label: 'FOV (rad)',  type: 'number', min: 0.1, max: 3.14, step: 0.01 },
        { key: 'minZ', label: 'Near Clip',  type: 'number', min: 0.001, max: 100,  step: 0.001 },
        { key: 'maxZ', label: 'Far Clip',   type: 'number', min: 1,    max: 100000, step: 1 },
        { key: 'targetEntityId', label: 'Look-At Target', type: 'entity-ref' },
      ],
    }

    if (this.cameraType === 'UniversalCamera') {
      section.fields.push(
        { key: 'speed', label: 'Speed', type: 'number', min: 0, max: 100, step: 0.1 },
      )
    } else {
      section.fields.push(
        { key: 'target', label: 'Target', type: 'vec3',   step: 0.1 },
        { key: 'alpha',  label: 'Alpha',  type: 'number', min: -6.28, max: 6.28, step: 0.01 },
        { key: 'beta',   label: 'Beta',   type: 'number', min: 0.01,  max: 3.13,  step: 0.01 },
        { key: 'radius', label: 'Radius', type: 'number', min: 0.1,   max: 10000, step: 0.1 },
      )
    }

    return [section]
  }

  // ── Babylon sync ──────────────────────────────────────────────

  override syncToBabylon(): void {
    const cam = this.babylonCamera
    if (!cam) return

    // Signal store to rebuild if the Babylon camera type no longer matches
    const actualType = cam.getClassName()
    const needsRebuild =
      (this.cameraType === 'UniversalCamera' && actualType !== 'UniversalCamera') ||
      (this.cameraType === 'ArcRotateCamera' && actualType !== 'ArcRotateCamera')
    if (needsRebuild) { this.onCameraTypeChanged?.(); return }

    if (this.isMainCamera) this.onMainCameraSet?.()

    cam.fov  = this.fov
    cam.minZ = this.minZ
    cam.maxZ = this.maxZ

    if (this.cameraType === 'UniversalCamera') {
      (cam as BabylonUniversalCamera).speed = this.speed
    } else {
      const arc = cam as BabylonArcRotateCamera
      // Only apply manual target when no entity look-at is active.
      // Entity look-at is managed exclusively by sceneStore._applyTargetLookAt.
      if (!this.targetEntityId) {
        arc.target.x = this.target.x
        arc.target.y = this.target.y
        arc.target.z = this.target.z
      }
      arc.alpha  = this.alpha
      arc.beta   = this.beta
      arc.radius = this.radius
    }
  }

  /**
   * Callback set by sceneStore. Called when the cameraType property changes
   * to a value that is incompatible with the existing Babylon camera.
   * The sceneStore disposes the old camera and creates a replacement.
   */
  onCameraTypeChanged: (() => void) | null = null

  // ── Viewport widget ────────────────────────────────────────────

  /**
   * Draws a camera body (box) + lens tube (smaller box) + perspective frustum.
   *
   * Everything is in entity-local space; the camera "looks" down +Z so the
   * frustum opens toward positive Z.
   *
   * Near / far cap positions use the actual minZ / maxZ values but the visual
   * far is capped at minZ + 8 so the widget remains usable when maxZ = 1000.
   */
  override onWidgetDraw(): WidgetSchema {
    // ── Camera body: flat rectangle (wider than tall) ──────────
    const bodyHW = 0.20, bodyHH = 0.14, bodyHD = 0.10
    const bodyLines = boxWireframe(bodyHW, bodyHH, bodyHD)

    // ── Lens tube: small square protrusion on the front face ───
    const lensHW = 0.07, lensHH = 0.07, lensHD = 0.06
    const lensLines = boxWireframe(lensHW, lensHH, lensHD, 0, 0, bodyHD + lensHD)

    // ── Frustum ────────────────────────────────────────────────
    // Standard 16:9 aspect ratio for the widget gizmo.
    const ASPECT = 16 / 9
    const tanHV  = Math.tan(this.fov / 2)
    const tanHH  = tanHV * ASPECT
    const nearZ  = this.minZ
    const farZ   = this.maxZ   // use actual clip distance — no artificial cap

    // Near-plane corners — individual consts avoid noUncheckedIndexedAccess
    const nHW = tanHH * nearZ, nHH2 = tanHV * nearZ
    const n0: WidgetPoint = { x: -nHW, y: -nHH2, z: nearZ }
    const n1: WidgetPoint = { x:  nHW, y: -nHH2, z: nearZ }
    const n2: WidgetPoint = { x:  nHW, y:  nHH2, z: nearZ }
    const n3: WidgetPoint = { x: -nHW, y:  nHH2, z: nearZ }

    // Far-plane corners
    const fHW = tanHH * farZ, fHH2 = tanHV * farZ
    const f0: WidgetPoint = { x: -fHW, y: -fHH2, z: farZ }
    const f1: WidgetPoint = { x:  fHW, y: -fHH2, z: farZ }
    const f2: WidgetPoint = { x:  fHW, y:  fHH2, z: farZ }
    const f3: WidgetPoint = { x: -fHW, y:  fHH2, z: farZ }

    const frustumLines: WidgetPoint[][] = [
      // Near cap (closed rect)
      [n0, n1, n2, n3, n0],
      // Far cap (closed rect)
      [f0, f1, f2, f3, f0],
      // Corner edges connecting near → far
      [n0, f0], [n1, f1], [n2, f2], [n3, f3],
    ]

    return {
      groups: [
        // Body + lens — light grey
        {
          lines: [...bodyLines, ...lensLines],
          color: { r: 0.78, g: 0.78, b: 0.78 },
        },
        // Frustum — sky blue
        {
          lines: frustumLines,
          color: { r: 0.25, g: 0.75, b: 1.0 },
        },
      ],
    }
  }

  // ── Serialisation ─────────────────────────────────────────────

  override serialize(): Record<string, unknown> {
    return {
      showWidget:     this.showWidget,
      cameraType:     this.cameraType,
      fov:            this.fov,
      minZ:           this.minZ,
      maxZ:           this.maxZ,
      isMainCamera:   this.isMainCamera,
      attachControls: this.attachControls,
      targetEntityId: this.targetEntityId,
      speed:          this.speed,
      target:         { ...this.target },
      alpha:          this.alpha,
      beta:           this.beta,
      radius:         this.radius,
    }
  }

  static deserialize(data: Record<string, unknown>): CameraComponent {
    const c = new CameraComponent()
    if (typeof data.showWidget === 'boolean') c.showWidget = data.showWidget
    if (data.cameraType     !== undefined) c.cameraType     = data.cameraType as CameraType
    if (typeof data.fov     === 'number')  c.fov            = data.fov
    if (typeof data.minZ    === 'number')  c.minZ           = data.minZ
    if (typeof data.maxZ    === 'number')  c.maxZ           = data.maxZ
    if (typeof data.isMainCamera   === 'boolean') c.isMainCamera   = data.isMainCamera
    if (typeof data.attachControls === 'boolean') c.attachControls = data.attachControls
    if ('targetEntityId' in data) c.targetEntityId = data.targetEntityId as string | null
    if (typeof data.speed === 'number') c.speed = data.speed
    if (data.target !== undefined) c.target = data.target as Vec3
    if (typeof data.alpha  === 'number') c.alpha  = data.alpha
    if (typeof data.beta   === 'number') c.beta   = data.beta
    if (typeof data.radius === 'number') c.radius = data.radius
    return c
  }
}
