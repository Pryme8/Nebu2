// ─────────────────────────────────────────────
// PhysicsWorldComponent
//
// Configures the physics simulation for a scene.
// Only one of these should exist per scene — the HavokPhysicsSystem reads
// the first entity that has this component to set up the Havok physics engine.
//
// Placing this on an entity in the hierarchy makes the physics configuration
// explicit, serialisable, and inspector-editable like any other component.
// ─────────────────────────────────────────────

import { Component }           from '@/core/ecs/Component'
import type { InspectorSchema } from '@/types/inspector'
import type { Vec3Like }        from '@/types/inspector'

export class PhysicsWorldComponent extends Component {
  readonly type = 'PhysicsWorld'

  /** Scene gravity vector (m/s²). */
  gravity: Vec3Like = { x: 0, y: -9.81, z: 0 }

  /**
   * Fixed physics time-step in seconds.
   * Smaller values = more accurate but more CPU load.
   * Default: 1/60 ≈ 0.01667
   */
  timeStep: number = 1 / 60

  /**
   * Maximum number of sub-steps per rendered frame.
   * Prevents the "spiral of death" when the frame rate drops below the
   * physics tick rate.
   */
  maxSubSteps: number = 10

  /**
   * Global restitution applied by the Havok solver when no material
   * restitution is specified (0 = fully inelastic, 1 = perfectly elastic).
   */
  defaultRestitution: number = 0

  /**
   * Global friction applied by the Havok solver when no material friction is
   * specified.
   */
  defaultFriction: number = 0.5

  /** Called when the physics world is activated. Plugin setup is handled by HavokPhysicsSystem. */
  onCreate(_scene: unknown, _world: unknown): void { /* physics world setup done by HavokPhysicsSystem */ }

  /** Called when the physics world component is disposed. */
  onDispose(): void { /* Havok plugin teardown done by HavokPhysicsSystem.onShutdown() */ }

  // ── Inspector ──────────────────────────────────────────────────────────────

  override onInspectorDraw(): InspectorSchema {
    return [
      {
        title: 'Gravity',
        fields: [
          { key: 'gravity', label: 'Gravity', type: 'vec3', step: 0.1 },
        ],
      },
      {
        title: 'Solver',
        fields: [
          { key: 'timeStep',         label: 'Time Step',          type: 'number', min: 0.001, max: 0.1,  step: 0.001 },
          { key: 'maxSubSteps',      label: 'Max Sub-steps',      type: 'number', min: 1,     max: 32,   step: 1     },
          { key: 'defaultRestitution', label: 'Default Restitution', type: 'number', min: 0, max: 1,   step: 0.01  },
          { key: 'defaultFriction',    label: 'Default Friction',    type: 'number', min: 0, max: 10,  step: 0.01  },
        ],
      },
    ]
  }

  // ── Serialisation ──────────────────────────────────────────────────────────

  override serialize(): Record<string, unknown> {
    return {
      gravity:            { ...this.gravity },
      timeStep:           this.timeStep,
      maxSubSteps:        this.maxSubSteps,
      defaultRestitution: this.defaultRestitution,
      defaultFriction:    this.defaultFriction,
    }
  }

  static deserialize(data: Record<string, unknown>): PhysicsWorldComponent {
    const c = new PhysicsWorldComponent()
    if (data.gravity && typeof data.gravity === 'object') {
      c.gravity = { ...c.gravity, ...(data.gravity as Vec3Like) }
    }
    if (typeof data.timeStep         === 'number') c.timeStep         = data.timeStep
    if (typeof data.maxSubSteps      === 'number') c.maxSubSteps      = data.maxSubSteps
    if (typeof data.defaultRestitution === 'number') c.defaultRestitution = data.defaultRestitution
    if (typeof data.defaultFriction  === 'number') c.defaultFriction  = data.defaultFriction
    return c
  }
}
