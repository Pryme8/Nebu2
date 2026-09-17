import { Component } from '../Component'
import { Quaternion, Vector3, type TransformNode } from '@babylonjs/core'


export interface Vec3 { x: number; y: number; z: number }

/**
 * Transform component — position / rotation (Euler radians) / scale.
 *
 * `position`, `rotation`, and `scale` are live proxy objects.  Once
 * `babylonNode` is assigned, every read or write on these proxies goes
 * directly through to the underlying Babylon TransformNode — there is no
 * separate ECS copy to keep in sync.  Before the node is wired, an internal
 * buffer holds the values so that data is never lost.
 *
 * Rotation is stored and exposed in **radians** throughout, matching Babylon
 * convention.  Callers that need degrees must convert at their boundary.
 *
 * Consequence: calling `syncToBabylon()` is never required — assignment is
 * immediate.  Scripts can write `this.transform.position.x = v` and the
 * Babylon node (and therefore the physics pre-step) sees the change instantly.
 */
export class TransformComponent extends Component {
  readonly type = 'Transform'

  // ── Internal buffers (used while babylonNode === null) ───────────────────
  // All units match Babylon: world-space metres for position/scale, radians for rotation.

  private _node: TransformNode | null = null
  private _pos = new Vector3(0, 0, 0)
  private _rot = new Vector3(0, 0, 0)   // radians
  private _scl = new Vector3(1, 1, 1)

  // ── Live proxies ─────────────────────────────────────────────────────────
  // When a node is attached these return the node's own Vector3 instances —
  // mutations are visible to Babylon immediately with no intermediate copy.
  //
  // Setters copy the incoming value in-place so scripts can write either:
  //   transform.position.x = 1          (direct mutation — always worked)
  //   transform.position = new Vector3  (assignment — now works via copyFrom)
  public get position(): Vector3         { return this._node ? this._node.position  : this._pos }
  public set position(v: Vector3)        { this.position.copyFrom(v) }

  public get rotation(): Vector3         { return this._node ? this._node.rotation  : this._rot }
  public set rotation(v: Vector3)        { this.rotation.copyFrom(v) }

  public get rotationQuaternion(): Quaternion | null {
    return this._node ? this._node.rotationQuaternion : null
  }
  public set rotationQuaternion(q: Quaternion | null) {
    if (!this._node) return
    this._node.rotationQuaternion = q
    if (q) {
      q.toEulerAnglesToRef(this._rot)
    } else {
      this._rot.copyFrom(this._node.rotation)
    }
  }
  public get scale(): Vector3            { return this._node ? this._node.scaling   : this._scl }
  public set scale(v: Vector3)           { this.scale.copyFrom(v) }
  public get forward(): Vector3          { return this._node ? this._node.forward             : new Vector3(0, 0, 1) }
  public get up(): Vector3               { return this._node ? this._node.up                 : new Vector3(0, 1, 0) }
  public get right(): Vector3            { return this._node ? this._node.right               : new Vector3(1, 0, 0) }

  constructor() {
    super()
  }

  // ── babylonNode getter / setter ───────────────────────────────────────────

  get babylonNode(): TransformNode | null { return this._node }

  set babylonNode(node: TransformNode | null) {
    if (node && !this._node) {
      // Flush buffer → new node.  No unit conversion — both sides use radians.
      node.position.copyFrom(this._pos)
      if (node.rotationQuaternion !== null) node.rotationQuaternion = null
      node.rotation.copyFrom(this._rot)
      node.scaling.copyFrom(this._scl)
    } else if (!node && this._node) {
      // Capture node → buffer before losing the reference.
      this._pos.copyFrom(this._node.position)
      const rq = this._node.rotationQuaternion
      if (rq) {
        rq.toEulerAnglesToRef(this._rot)
      } else {
        this._rot.copyFrom(this._node.rotation)
      }
      this._scl.copyFrom(this._node.scaling)
    }
    this._node = node
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override onCreate(_babylonScene: unknown, _world: unknown): void {
    // babylonNode lifecycle is managed by sceneStore.
  }

  override onDispose(): void {
    const node = this._node
    this._node = null
    node?.dispose()
  }

  /** No-op: the live proxy keeps the Babylon node in sync at all times. */
  override syncToBabylon(): void {}

  // ── Serialisation ─────────────────────────────────────────────────────────

  override serialize(): Record<string, unknown> {
    return {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      rotation: { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z },
      scale:    { x: this.scale.x,    y: this.scale.y,    z: this.scale.z    },
    }
  }

  static deserialize(data: Record<string, unknown>): TransformComponent {
    const c = new TransformComponent()
    if (data.position) { const p = data.position as Vec3; c._pos.set(p.x, p.y, p.z) }
    if (data.rotation) { const r = data.rotation as Vec3; c._rot.set(r.x, r.y, r.z) }
    if (data.scale)    { const s = data.scale    as Vec3; c._scl.set(s.x, s.y, s.z) }
    return c
  }
}
