// ─────────────────────────────────────────────
// RigidBodyComponent
//
// Controls how an entity participates in the physics simulation.
// Requires a ColliderComponent on the same entity to define the shape.
//
// Motion types (maps to Havok's PhysicsMotionType):
//   Dynamic   — fully simulated; responds to forces and collisions.
//   Static    — immovable collider; zero mass; does not move.
//   Animated  — moves via the TransformComponent (kinematic); collides with
//               Dynamic bodies but is not affected by forces.
// ─────────────────────────────────────────────

import { Component }                     from '@/core/ecs/Component'
import type { InspectorSchema }           from '@/types/inspector'
import type { PhysicsBody, PhysicsShapeContainer } from '@babylonjs/core'

// ── Motion type ────────────────────────────────────────────────────────────

export type MotionType = 'Dynamic' | 'Static' | 'Animated'

const MOTION_TYPES: Array<{ label: string; value: string }> = [
  { label: 'Dynamic',  value: 'Dynamic'  },
  { label: 'Static',   value: 'Static'   },
  { label: 'Animated', value: 'Animated' },
]

// ── Component ──────────────────────────────────────────────────────────────

export class RigidBodyComponent extends Component {
  readonly type = 'RigidBody'

  /** Determines how this body interacts with the physics simulation. */
  motionType: MotionType = 'Dynamic'

  /** Mass in kg. Ignored for Static bodies. */
  mass: number = 1

  /** Coulomb friction coefficient (0 = frictionless, 1 = very grippy). */
  friction: number = 0.5

  /** Coefficient of restitution / bounciness (0 = no bounce, 1 = perfect bounce). */
  restitution: number = 0

  /**
   * Linear velocity damping per second (0 = no damping).
   * Simulates air resistance for translation.
   */
  linearDamping: number = 0

  /**
   * Angular velocity damping per second (0 = no damping).
   * Simulates air resistance for rotation.
   */
  angularDamping: number = 0

  /**
   * Multiplier applied to the scene gravity for this body only.
   * 0 = no gravity effect, 1 = normal gravity, -1 = inverse gravity.
   */
  gravityFactor: number = 1

  /**
   * Whether the body starts sleeping (not simulated until disturbed).
   * Useful for performance when many static-ish Dynamic bodies are in the scene.
   */
  startSleeping: boolean = false

  /**
   * When true, Babylon skips the pre-step that copies the TransformNode world
   * matrix into the physics body before each simulation tick.  Set to false
   * (the default) when you need to move this body programmatically by writing
   * to its TransformComponent — the physics engine will pick up the new
   * transform at the start of the next step.
   */
  disablePreStep: boolean = true

  // ── Runtime refs — not serialised ─────────────────────────────────
  /**
   * Live Babylon PhysicsBody for this entity.
   * Assigned by HavokPhysicsSystem after the body is created; cleared by onDispose().
   * Read from external code — do **not** store a duplicate ref anywhere else.
   */
  physicsBody: PhysicsBody | null = null

  /**
   * The PhysicsShapeContainer that aggregates all ColliderComponent shapes for
   * this rigid body.  Also assigned by HavokPhysicsSystem; disposed here.
   */
  physicsContainerShape: PhysicsShapeContainer | null = null

  /** Stored by onCreate so syncToBabylon can push changes without external help. */
  override onCreate(_scene: unknown, _world: unknown): void { /* body created by HavokPhysicsSystem */ }

  override onDispose(): void {
    this.physicsBody?.dispose()
    this.physicsBody = null
    this.physicsContainerShape?.dispose()
    this.physicsContainerShape = null
  }

  /**
   * Push all mutable data properties to the live PhysicsBody.
   * Called automatically by the inspector after every property edit.
   * Safe to call when physicsBody is null (simulation not running).
   */
  override syncToBabylon(): void {
    const body = this.physicsBody
    if (!body) return

    if (this.motionType === 'Dynamic') {
      body.setMassProperties({ mass: this.mass })
      body.setLinearDamping(this.linearDamping)
      body.setAngularDamping(this.angularDamping)
      body.setGravityFactor(this.gravityFactor)
    }
    body.disablePreStep = this.disablePreStep

    if (this.physicsContainerShape) {
      this.physicsContainerShape.material = {
        friction:    this.friction,
        restitution: this.restitution,
      }
    }
  }

  // ── Inspector ──────────────────────────────────────────────────────────────

  override onInspectorDraw(): InspectorSchema {
    const fields: InspectorSchema[0]['fields'] = [
      { key: 'motionType',  label: 'Motion Type',    type: 'enum',    options: MOTION_TYPES },
      { key: 'friction',    label: 'Friction',       type: 'number',  min: 0, max: 10, step: 0.01 },
      { key: 'restitution', label: 'Restitution',    type: 'number',  min: 0, max: 1,  step: 0.01 },
    ]

    if (this.motionType === 'Dynamic') {
      fields.push(
        { key: 'mass',           label: 'Mass (kg)',       type: 'number',  min: 0.001, step: 0.1 },
        { key: 'gravityFactor',  label: 'Gravity Factor',  type: 'number',  min: -10, max: 10, step: 0.1 },
        { key: 'linearDamping',  label: 'Linear Damping',  type: 'number',  min: 0, max: 1, step: 0.01 },
        { key: 'angularDamping', label: 'Angular Damping', type: 'number',  min: 0, max: 1, step: 0.01 },
        { key: 'startSleeping',  label: 'Start Sleeping',  type: 'boolean' },
        )
    }

    fields.push({ key: 'disablePreStep', label: 'Disable Pre-Step', type: 'boolean' })

    return [{ title: 'Rigid Body', fields }]
  }

  // ── Serialisation ──────────────────────────────────────────────────────────

  override serialize(): Record<string, unknown> {
    return {
      motionType:      this.motionType,
      mass:            this.mass,
      friction:        this.friction,
      restitution:     this.restitution,
      linearDamping:   this.linearDamping,
      angularDamping:  this.angularDamping,
      gravityFactor:   this.gravityFactor,
      startSleeping:   this.startSleeping,
      disablePreStep:  this.disablePreStep,
    }
  }

  static deserialize(data: Record<string, unknown>): RigidBodyComponent {
    const c = new RigidBodyComponent()
    if (typeof data.motionType     === 'string')  c.motionType     = data.motionType as MotionType
    if (typeof data.mass           === 'number')  c.mass           = data.mass
    if (typeof data.friction       === 'number')  c.friction       = data.friction
    if (typeof data.restitution    === 'number')  c.restitution    = data.restitution
    if (typeof data.linearDamping  === 'number')  c.linearDamping  = data.linearDamping
    if (typeof data.angularDamping === 'number')  c.angularDamping = data.angularDamping
    if (typeof data.gravityFactor  === 'number')  c.gravityFactor  = data.gravityFactor
    if (typeof data.startSleeping  === 'boolean') c.startSleeping  = data.startSleeping
    if (typeof data.disablePreStep  === 'boolean') c.disablePreStep = data.disablePreStep
    return c
  }
}
