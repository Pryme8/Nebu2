// ─────────────────────────────────────────────
// @nebu/plugin-havok — Havok Physics Plugin
//
// Contributes three ECS components and one ECS system that integrate
// Babylon.js's Havok physics back-end into the Nebu2 editor.
//
// Components:
//   PhysicsWorld — configures scene-wide physics settings
//   Collider     — defines the collision shape for an entity
//   RigidBody    — controls how an entity participates in the simulation
//
// Usage (in App.vue):
//   import { havokPlugin } from '@nebu/plugin-havok'
//   pluginStore.registerPlugin(havokPlugin)
// ─────────────────────────────────────────────

import type { NebuPlugin } from '@/types/plugin'

import { PhysicsWorldComponent }                        from './components/PhysicsWorldComponent'
import { ColliderComponent }                            from './components/ColliderComponent'
import { RigidBodyComponent }                           from './components/RigidBodyComponent'
import { PhysicsConstraintComponent } from './components/PhysicsConstraintComponent'
import { HavokPhysicsSystem }                           from './systems/HavokPhysicsSystem'

// ── Shared system ref (one per plugin activation) ─────────────────────────

let _physicsSystem: HavokPhysicsSystem | null = null

// ── Plugin descriptor ─────────────────────────────────────────────────────

export const havokPlugin: NebuPlugin = {
  id:          'com.nebu.physics-havok',
  displayName: 'Havok Physics',
  description: 'Real-time rigid-body physics powered by the Havok SDK via Babylon.js.',
  version:     '0.1.0',
  builtin:     true,

  // ── Contributed ECS components ───────────────────────────────────────────

  components: [
    {
      type:        'PhysicsWorld',
      label:       'Physics World',
      factory:     () => new PhysicsWorldComponent(),
      deserialize: (d) => PhysicsWorldComponent.deserialize(d),
    },
    {
      type:        'Collider',
      label:       'Collider',
      factory:     () => new ColliderComponent(),
      deserialize: (d) => ColliderComponent.deserialize(d),
    },
    {
      type:        'RigidBody',
      label:       'Rigid Body',
      factory:     () => new RigidBodyComponent(),
      deserialize: (d) => RigidBodyComponent.deserialize(d),
    },
    {
      type:        'PhysicsConstraint',
      label:       'Physics Constraint',
      factory:     () => new PhysicsConstraintComponent(),
      deserialize: (d) => PhysicsConstraintComponent.deserialize(d),
    },
  ],

  // ── Monaco ambient type declarations ────────────────────────────────────
  // Injected into the script editor so user scripts get full IntelliSense
  // for Havok component types without any import statement.

  ambientTypes: /* ts */ `
// ── RigidBodyComponent (Havok Physics) ───────────────────────────────────────
declare class RigidBodyComponent extends Component {
  readonly type: 'RigidBody'
  /** How this body participates in the simulation. */
  motionType:     'Dynamic' | 'Static' | 'Animated'
  /** Mass in kg. Ignored for Static bodies. */
  mass:           number
  /** Coulomb friction coefficient (0 = frictionless). */
  friction:       number
  /** Coefficient of restitution / bounciness (0–1). */
  restitution:    number
  linearDamping:  number
  angularDamping: number
  /** Multiplier applied to scene gravity for this body only. */
  gravityFactor:  number
  startSleeping:  boolean
  disablePreStep: boolean
  /** Live Babylon PhysicsBody — available after Play starts, null otherwise. */
  physicsBody: import('@babylonjs/core').PhysicsBody | null
  /** PhysicsShapeContainer aggregating all ColliderComponent shapes for this body. */
  physicsContainerShape: import('@babylonjs/core').PhysicsShapeContainer | null
}

// ── ColliderComponent (Havok Physics) ────────────────────────────────────────
declare class ColliderComponent extends Component {
  readonly type: 'Collider'
  shape:     'Box' | 'Sphere' | 'Capsule' | 'Cylinder' | 'ConvexHull' | 'Mesh'
  sizeX:     number
  sizeY:     number
  sizeZ:     number
  radius:    number
  height:    number
  /** When true, reports overlap events but does not block movement. */
  isTrigger: boolean
  offsetX:   number
  offsetY:   number
  offsetZ:   number
  /** Live Babylon PhysicsShape for this collider — available after Play starts, null otherwise. */
  physicsShape: import('@babylonjs/core').PhysicsShape | null
}

// ── PhysicsWorldComponent (Havok Physics) ────────────────────────────────────
declare class PhysicsWorldComponent extends Component {
  readonly type: 'PhysicsWorld'
  gravity:            Vec3
  timeStep:           number
  maxSubSteps:        number
  defaultRestitution: number
  defaultFriction:    number
}

// ── PhysicsConstraintComponent (Havok Physics) ───────────────────────────────
declare class PhysicsConstraintComponent extends Component {
  readonly type: 'PhysicsConstraint'
  constraintType:    'BallAndSocket' | 'Distance' | 'Hinge' | 'Slider' | 'Lock' | 'Prismatic'
  /** Entity ID of the second body in the joint. */
  linkedEntityId:    string | null
  /** Pivot point in this entity's local space. */
  pivotA:            Vec3
  /** Pivot point in the linked entity's local space. */
  pivotB:            Vec3
  /** Constraint axis in this entity's local space. */
  axisA:             Vec3
  /** Constraint axis in the linked entity's local space. */
  axisB:             Vec3
  /** Maximum allowed distance (Distance constraint only). */
  maxDistance:       number
  collisionsEnabled: boolean
}
`,

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async onActivate(ctx) {
    // Load the Havok wasm module.  Pass locateFile so the emscripten loader
    // fetches from /HavokPhysics.wasm (served by havokWasm() Vite plugin)
    // with the correct application/wasm MIME type instead of guessing a path
    // that resolves to an HTML 404 page and fails the magic-byte check.
    // Imported here rather than at module scope: this plugin is *registered*
    // at app boot so it can appear in Project Settings, but most projects never
    // activate it. A static import would pull the Havok emscripten glue into
    // the main bundle for everyone.
    const { default: HavokPhysics } = await import('@babylonjs/havok')
    const havokInstance = await HavokPhysics({ locateFile: () => '/HavokPhysics.wasm' })

    // Create the physics system and register it with the world.
    // The system itself enables the physics engine in onStart() each time
    // play mode begins, so we don't call enablePhysics or onStart here.
    // The raw WASM instance is passed so each onStart() creates a fresh
    // HavokPlugin (the old one is disposed by disablePhysicsEngine).
    _physicsSystem = new HavokPhysicsSystem(ctx.scene, havokInstance)
    ctx.world.addSystem(_physicsSystem)
  },

  onDeactivate(ctx) {
    if (_physicsSystem) {
      _physicsSystem.onShutdown()
      _physicsSystem = null
    }
    if (ctx.scene.getPhysicsEngine()) {
      ctx.scene.disablePhysicsEngine()
    }
  },

  onWorldChanged(oldWorld, newWorld) {
    if (_physicsSystem) {
      oldWorld.removeSystem(_physicsSystem)
      newWorld.addSystem(_physicsSystem)
    }
  },
}

// Named re-exports so consumers can import individual components without
// importing the whole plugin descriptor.
export { PhysicsWorldComponent } from './components/PhysicsWorldComponent'
export { ColliderComponent }     from './components/ColliderComponent'
export { RigidBodyComponent }    from './components/RigidBodyComponent'
export { PhysicsConstraintComponent } from './components/PhysicsConstraintComponent'
export { HavokPhysicsSystem }    from './systems/HavokPhysicsSystem'
