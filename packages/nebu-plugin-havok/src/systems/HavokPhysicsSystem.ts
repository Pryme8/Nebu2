// ─────────────────────────────────────────────
// HavokPhysicsSystem
//
// ECS System that bridges Nebu's entity/component data with Babylon.js's
// Havok physics integration.
//
// Responsibilities:
//   onStart     — Build a PhysicsShapeContainer for every entity that has a
//                 RigidBodyComponent.  Collider shapes are gathered from the
//                 entity itself AND all descendants that don't have their own
//                 RigidBodyComponent, enabling compound / hierarchical bodies.
//                 Also creates all Physics constraints from paired
//                 PhysicsConstraintComponents.  onChange subscriptions are
//                 registered so inspector/script edits or async model loads
//                 trigger an immediate targeted rebuild — no per-frame polling.
//   onUpdate    — Empty.  Babylon automatically syncs Dynamic body transforms
//                 back to the TransformNode every physics tick.
//   onShutdown  — Dispose all PhysicsBody / PhysicsShapeContainer / constraint
//                 objects, unsubscribe all onChange listeners, and disable the
//                 physics engine on the Babylon scene.
//
// Babylon docs:
//   https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin
//   https://doc.babylonjs.com/features/featuresDeepDive/physics/compounds/
//   https://doc.babylonjs.com/features/featuresDeepDive/physics/constraints/
// ─────────────────────────────────────────────

import {
  PhysicsBody,
  PhysicsShapeContainer,
  PhysicsShapeBox,
  PhysicsShapeSphere,
  PhysicsShapeCapsule,
  PhysicsShapeCylinder,
  PhysicsShapeConvexHull,
  PhysicsShapeMesh,
  type PhysicsShape,
  PhysicsMotionType,
  HavokPlugin,
  Vector3,
  Quaternion,
  Mesh,
  BallAndSocketConstraint,
  DistanceConstraint,
  HingeConstraint,
  SliderConstraint,
  LockConstraint,
  PrismaticConstraint,
  type PhysicsConstraint,
  type Scene,
} from '@babylonjs/core'
import { System }              from '@/core/ecs/System'
import type { Entity }         from '@/core/ecs/Entity'
import { TransformComponent }  from '@/core/ecs/components/TransformComponent'
import { MeshComponent }       from '@/core/ecs/components/MeshComponent'
import type { ColliderComponent }              from '../components/ColliderComponent'
import type { RigidBodyComponent }             from '../components/RigidBodyComponent'
import type { PhysicsWorldComponent }          from '../components/PhysicsWorldComponent'
import type { PhysicsConstraintComponent }     from '../components/PhysicsConstraintComponent'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Map a RigidBodyComponent.motionType string to a Babylon PhysicsMotionType. */
function toPhysicsMotionType(motion: RigidBodyComponent['motionType']): PhysicsMotionType {
  switch (motion) {
    case 'Dynamic':  return PhysicsMotionType.DYNAMIC
    case 'Static':   return PhysicsMotionType.STATIC
    case 'Animated': return PhysicsMotionType.ANIMATED
    default:         return PhysicsMotionType.DYNAMIC
  }
}

// ── Per-container bookkeeping ──────────────────────────────────────────────

interface ContainerEntry {
  unsubRigidBody:     () => void
  unsubRootTransform: (() => void) | null
  /** One unsub callback per collider entity in the subtree. */
  unsubColliders:     Map<string, () => void>
}

// ── Per-constraint bookkeeping ─────────────────────────────────────────────

/**
 * A canonical pair key so each constraint appears only once regardless of
 * which entity is A and which is B.
 */
function constraintPairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`
}

interface ConstraintEntry {
  constraint: PhysicsConstraint
  unsub:      () => void
}

// ── System ─────────────────────────────────────────────────────────────────

export class HavokPhysicsSystem extends System {
  private readonly _scene:         Scene
  private readonly _havokInstance: unknown

  /** Map from rigidBody-entityId → container entry. */
  private readonly _containers = new Map<string, ContainerEntry>()

  /** Map from canonical pair-key → constraint entry. */
  private readonly _constraints = new Map<string, ConstraintEntry>()

  /**
   * @param havokInstance  The raw WASM object returned by `HavokPhysics()`,
   *                       NOT a HavokPlugin.  A fresh HavokPlugin wrapper is
   *                       created on every onStart() so the disposed instance
   *                       from the previous play session is never reused.
   */
  constructor(scene: Scene, havokInstance: unknown) {
    super()
    this._scene         = scene
    this._havokInstance = havokInstance
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override onStart(): void {
    // Always create a fresh HavokPlugin — the previous instance is disposed
    // by disablePhysicsEngine() in onShutdown and cannot be reused.
    const freshPlugin = new HavokPlugin(true, this._havokInstance)
    const worldEntities = this.world.query('PhysicsWorld')
    const pw = worldEntities[0]?.getComponent<PhysicsWorldComponent>('PhysicsWorld')
    const gravity = pw
      ? new Vector3(pw.gravity.x, pw.gravity.y, pw.gravity.z)
      : new Vector3(0, -9.81, 0)
    this._scene.enablePhysics(gravity, freshPlugin)
    this._initContainers()
    this._initConstraints()
    this._applyWorldSettings()
  }

  // onUpdate intentionally omitted — Babylon syncs Dynamic body transforms to
  // their TransformNode automatically every physics tick.  All container/constraint
  // rebuilds are driven by onChange subscriptions, not per-frame polling.

  override onShutdown(): void {
    for (const entry of this._constraints.values()) {
      entry.unsub()
      entry.constraint.dispose()
    }
    this._constraints.clear()
    for (const [id, entry] of this._containers) {
      this._removeContainer(id, entry)
    }
    this._containers.clear()
    this._scene.disablePhysicsEngine()
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * Apply PhysicsWorld settings (gravity etc.) to the live physics engine.
   * Called on start and whenever the PhysicsWorld component changes.
   */
  private _applyWorldSettings(): void {
    const physicsEngine = this._scene.getPhysicsEngine()
    if (!physicsEngine) return

    const worldEntities = this.world.query('PhysicsWorld')
    if (worldEntities.length === 0) return
    const pw = worldEntities[0]!.getComponent<PhysicsWorldComponent>('PhysicsWorld')
    if (!pw) return

    physicsEngine.setGravity(new Vector3(pw.gravity.x, pw.gravity.y, pw.gravity.z))
    physicsEngine.setTimeStep(pw.timeStep)
  }

  /**
   * Build a parentId → childId[] map over all world entities.
   * Used for O(n) subtree walks instead of O(n²) ancestor scanning.
   */
  private _buildChildrenMap(): Map<string | null, string[]> {
    const map = new Map<string | null, string[]>()
    for (const entity of this.world.entities.values()) {
      const arr = map.get(entity.parentId) ?? []
      arr.push(entity.id)
      map.set(entity.parentId, arr)
    }
    return map
  }

  /**
   * Recursively collect all Collider entities in the subtree rooted at
   * `entityId`.  Recursion stops at child entities that have their own
   * RigidBodyComponent — they form independent physics bodies.
   */
  private _gatherSubtreeColliders(
    entityId:    string,
    isRoot:      boolean,
    childrenMap: Map<string | null, string[]>,
    result:      Entity[],
  ): void {
    const entity = this.world.getEntity(entityId)
    if (!entity) return
    // Non-root entity with its own RigidBody → separate body, stop here.
    if (!isRoot && entity.hasComponent('RigidBody')) return
    if (entity.hasComponent('Collider')) result.push(entity)
    for (const childId of (childrenMap.get(entityId) ?? [])) {
      this._gatherSubtreeColliders(childId, false, childrenMap, result)
    }
  }

  /** One-shot container init — called once from onStart(). */
  private _initContainers(): void {
    const childrenMap = this._buildChildrenMap()
    for (const rbEntity of this.world.query('RigidBody')) {
      const tc = rbEntity.getComponent<TransformComponent>('Transform')
      if (!tc?.babylonNode) continue

      const colliderEntities: Entity[] = []
      this._gatherSubtreeColliders(rbEntity.id, true, childrenMap, colliderEntities)
      if (colliderEntities.length === 0) continue

      this._createContainer(rbEntity, colliderEntities)
    }
  }

  /**
   * Rebuild a single container — called directly from onChange subscriptions,
   * never on every frame.  Runs only when a property genuinely changed.
   */
  private _rebuildContainer(id: string): void {
    const existing = this._containers.get(id)
    if (existing) this._removeContainer(id, existing)

    const rbEntity = this.world.getEntity(id)
    if (!rbEntity) return

    const childrenMap      = this._buildChildrenMap()
    const colliderEntities: Entity[] = []
    this._gatherSubtreeColliders(id, true, childrenMap, colliderEntities)
    if (colliderEntities.length === 0) return

    this._createContainer(rbEntity, colliderEntities)
  }

  /**
   * Build a PhysicsShapeContainer for a RigidBody entity and its collider subtree.
   *
   * The ContainerEntry (with onChange subscriptions) is stored immediately so that
   * rebuilds are triggered by component changes even if shapes can't be built yet
   * (e.g. ConvexHull/Mesh collider whose model mesh hasn't finished loading).
   * sceneStore calls collider.notifyChanged() once the model mesh is ready, which
   * calls _rebuildContainer — no per-frame polling required.
   */
  private _createContainer(
    rbEntity:         Entity,
    colliderEntities: Entity[],
  ): void {
    const rb       = rbEntity.getComponent<RigidBodyComponent>('RigidBody')!
    const rootTc   = rbEntity.getComponent<TransformComponent>('Transform')
    const rootNode = rootTc?.babylonNode
    if (!rootNode) return

    // Store the entry before building shapes so subscriptions are held even if
    // shape building fails this time (async model not loaded yet).
    const entry: ContainerEntry = {
      unsubRigidBody:     () => {},
      unsubRootTransform: null,
      unsubColliders:     new Map(),
    }
    this._containers.set(rbEntity.id, entry)

    // onChange → immediate one-shot rebuild.  Never runs on every frame.
    entry.unsubRigidBody = rb.onChange(() => this._rebuildContainer(rbEntity.id))
    for (const colliderEntity of colliderEntities) {
      const collider = colliderEntity.getComponent<ColliderComponent>('Collider')!
      entry.unsubColliders.set(
        colliderEntity.id,
        collider.onChange(() => this._rebuildContainer(rbEntity.id)),
      )
    }
    // Transform onChange: covers inspector scale edits.  Physics simulation does
    // NOT call notifyChanged() on Transform so there are no spurious rebuilds.
    if (rootTc) {
      entry.unsubRootTransform = rootTc.onChange(() => this._rebuildContainer(rbEntity.id))
    }

    // ── Build shapes ─────────────────────────────────────────────────────
    const containerShape = new PhysicsShapeContainer(this._scene)
    let builtShapeCount  = 0

    for (const colliderEntity of colliderEntities) {
      const collider       = colliderEntity.getComponent<ColliderComponent>('Collider')!
      const primitiveShape = this._buildShape(collider, colliderEntity)
      if (!primitiveShape) {
        console.warn('[Havok] _buildShape returned null for entity',
          colliderEntity.name, colliderEntity.id,
          '| shape:', collider.shape,
          '| mesh source:', colliderEntity.getComponent<MeshComponent>('Mesh')?.source ?? '(no MeshComp)',
          '| babylonModelMesh:', colliderEntity.getComponent<MeshComponent>('Mesh')?.babylonModelMesh?.name ?? '(null)')
        continue
      }
      console.log('[Havok] Built shape', collider.shape, 'for', colliderEntity.name, colliderEntity.id)

      if (collider.isTrigger) primitiveShape.isTrigger = true

      const colliderNode = colliderEntity
        .getComponent<TransformComponent>('Transform')?.babylonNode

      if (colliderNode && colliderNode !== rootNode) {
        // Child entity — addChildFromParent computes the local transform of
        // colliderNode relative to rootNode and applies it to the shape.
        containerShape.addChildFromParent(rootNode, primitiveShape, colliderNode)
      } else {
        // Same entity as the root (or node unavailable).  The shape's centre
        // parameter already encodes the collider offset in root-local space.
        containerShape.addChild(primitiveShape)
      }

      // Component owns its shape ref from here.
      collider.physicsShape = primitiveShape
      builtShapeCount++
    }

    if (builtShapeCount === 0) {
      // Shapes not available yet (async model load in progress).  Entry and
      // subscriptions are held — _rebuildContainer fires when mesh arrives.
      containerShape.dispose()
      return
    }

    // ── Finalise and activate ─────────────────────────────────────────────
    rootNode.computeWorldMatrix(true)

    containerShape.material = { friction: rb.friction, restitution: rb.restitution }

    const motionType  = toPhysicsMotionType(rb.motionType)
    const startAsleep = rb.motionType === 'Dynamic' && rb.startSleeping
    const body        = new PhysicsBody(rootNode, motionType, startAsleep, this._scene)
    body.shape        = containerShape

    if (rb.motionType === 'Dynamic') {
      body.setMassProperties({ mass: rb.mass })
      body.setLinearDamping(rb.linearDamping)
      body.setAngularDamping(rb.angularDamping)
      body.setGravityFactor(rb.gravityFactor)
    }

    body.disablePreStep = rb.disablePreStep

    // Component owns its refs from here — system does not cache them.
    rb.physicsBody           = body
    rb.physicsContainerShape = containerShape
  }

  /** Unsubscribe all listeners and clear Babylon object refs from the components. */
  private _removeContainer(id: string, entry: ContainerEntry): void {
    entry.unsubRigidBody()
    entry.unsubRootTransform?.()

    // Dispose each collider's shape via its component, then remove subscription.
    for (const [colliderEntityId, unsub] of entry.unsubColliders) {
      unsub()
      const collider = this.world.getEntity(colliderEntityId)?.getComponent<ColliderComponent>('Collider')
      if (collider) {
        collider.physicsShape?.dispose()
        collider.physicsShape = null
      }
    }

    // Dispose body + container shape via RigidBodyComponent ownership.
    const rb = this.world.getEntity(id)?.getComponent<RigidBodyComponent>('RigidBody')
    if (rb) {
      rb.physicsBody?.dispose()
      rb.physicsBody = null
      rb.physicsContainerShape?.dispose()
      rb.physicsContainerShape = null
    }

    this._containers.delete(id)
  }

  /**
   * Find the Babylon Mesh for the given entity — the geometry that will be
   * used to build a PhysicsShapeConvexHull or PhysicsShapeMesh.
   *
   * Search order (first match wins):
   *  1. Procedural mesh — Babylon mesh named with the entity id.
   *  2. Model mesh — read directly from MeshComponent.babylonModelMesh
   *     (authoritative live reference set by sceneStore after async load).
   *     If the model root is a TransformNode (full instantiateModels path),
   *     recurse into its children to find the first Mesh with geometry.
   *  3. Child-mesh fallback — any Mesh parented to the entity's TransformNode.
   */
  private _findMeshForEntity(entity: Entity): Mesh | null {
    // 1. Procedural mesh — named exactly with the entity id.
    for (const m of this._scene.meshes) {
      if (m instanceof Mesh && m.name === entity.id) return m
    }

    // 2. Model mesh — read from the ECS component (set after async load).
    const meshComp = entity.getComponent<MeshComponent>('Mesh')
    const modelMesh = meshComp?.babylonModelMesh
    if (modelMesh) {
      // Submesh clone path: babylonModelMesh IS a Mesh with geometry.
      if (modelMesh instanceof Mesh && modelMesh.getTotalVertices() > 0) {
        return modelMesh
      }
      // Full-model path: babylonModelMesh is the instantiated root
      // (TransformNode).  Recurse to find the first child Mesh with geometry.
      const child = modelMesh.getChildMeshes(false)
        .find(m => m instanceof Mesh && (m as Mesh).getTotalVertices() > 0)
      if (child) return child as Mesh
    }

    // 3. Fallback: any child Mesh of the entity's TransformNode.
    const tfNode = entity.getComponent<TransformComponent>('Transform')?.babylonNode
    if (tfNode) {
      const child = tfNode.getChildMeshes(false)
        .find(m => m instanceof Mesh && (m as Mesh).getTotalVertices() > 0)
      if (child) return child as Mesh
    }

    return null
  }

  /**
   * Build a PhysicsShape for the given ColliderComponent.
   *
   * The collider offset (offsetX/Y/Z) is baked into the shape's local center
   * so the collision geometry is correctly displaced from the transform origin.
   *
   * ConvexHull and Mesh shapes require a real Babylon Mesh — returns null if
   * no mesh is found for the entity.
   */
  private _buildShape(collider: ColliderComponent, entity: Entity): PhysicsShape | null {
    const cx = collider.offsetX
    const cy = collider.offsetY
    const cz = collider.offsetZ

    switch (collider.shape) {
      case 'Box':
        return new PhysicsShapeBox(
          new Vector3(cx, cy, cz),
          Quaternion.Identity(),
          // extents = full dimensions (sizeX/Y/Z are half-extents)
          new Vector3(collider.sizeX * 2, collider.sizeY * 2, collider.sizeZ * 2),
          this._scene,
        )

      case 'Sphere':
        return new PhysicsShapeSphere(new Vector3(cx, cy, cz), collider.radius, this._scene)

      case 'Capsule': {
        // PhysicsShapeCapsule is defined by two segment endpoints + radius.
        // The segment (inner pillar) height = total height - 2 * radius.
        const halfInner = Math.max(0, collider.height / 2 - collider.radius)
        return new PhysicsShapeCapsule(
          new Vector3(cx, cy - halfInner, cz),
          new Vector3(cx, cy + halfInner, cz),
          collider.radius,
          this._scene,
        )
      }

      case 'Cylinder': {
        // PhysicsShapeCylinder is defined by two endpoints + radius.
        const halfH = collider.height / 2
        return new PhysicsShapeCylinder(
          new Vector3(cx, cy - halfH, cz),
          new Vector3(cx, cy + halfH, cz),
          collider.radius,
          this._scene,
        )
      }

      case 'ConvexHull': {
        const mesh = this._findMeshForEntity(entity)
        if (!mesh) {
          console.warn('[Havok] ConvexHull: no mesh found for', entity.name, entity.id)
          return null
        }
        console.log('[Havok] ConvexHull: using mesh', mesh.name, 'verts:', mesh.getTotalVertices())
        try {
          return new PhysicsShapeConvexHull(mesh, this._scene)
        } catch (e) {
          console.error('[Havok] ConvexHull creation FAILED for', entity.name, e)
          return null
        }
      }

      case 'Mesh': {
        const mesh = this._findMeshForEntity(entity)
        if (!mesh) {
          console.warn('[Havok] MeshShape: no mesh found for', entity.name, entity.id)
          return null
        }
        console.log('[Havok] MeshShape: using mesh', mesh.name, 'verts:', mesh.getTotalVertices())
        try {
          return new PhysicsShapeMesh(mesh, this._scene)
        } catch (e) {
          console.error('[Havok] MeshShape creation FAILED for', entity.name, e)
          return null
        }
      }

      default:
        return null
    }
  }

  // ── Constraint sync ────────────────────────────────────────────────────────

  /** One-shot constraint init — called once from onStart(). */
  private _initConstraints(): void {
    const seenPairs = new Set<string>()
    for (const entity of this.world.query('PhysicsConstraint')) {
      const comp = entity.getComponent<PhysicsConstraintComponent>('PhysicsConstraint')!
      if (!comp.linkedEntityId) continue

      const pairKey = constraintPairKey(entity.id, comp.linkedEntityId)
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)

      this._buildAndStoreConstraint(entity.id, comp.linkedEntityId, comp, pairKey)
    }
  }

  /**
   * Build a single constraint and wire up an onChange subscription.
   * When the component changes, the handler disposes the old constraint and
   * calls this method again — no per-frame polling needed.
   */
  private _buildAndStoreConstraint(
    idA:     string,
    idB:     string,
    comp:    PhysicsConstraintComponent,
    pairKey: string,
  ): void {
    const constraint = this._buildConstraint(idA, idB, comp)
    if (!constraint) return

    const unsub = comp.onChange(() => {
      const e = this._constraints.get(pairKey)
      if (e) {
        e.unsub()
        e.constraint.dispose()
        this._constraints.delete(pairKey)
      }
      this._buildAndStoreConstraint(idA, idB, comp, pairKey)
    })
    this._constraints.set(pairKey, { constraint, unsub })
  }

  /**
   * Create a Babylon PhysicsConstraint for the pair (idA, idB) using the
   * properties from compA (the canonical A-side component).
   * Attaches the constraint to bodyA → bodyB via PhysicsBody.addConstraint.
   */
  private _buildConstraint(
    idA:   string,
    idB:   string,
    compA: PhysicsConstraintComponent,
  ): PhysicsConstraint | null {
    const bodyA = this.world.getEntity(idA)?.getComponent<RigidBodyComponent>('RigidBody')?.physicsBody ?? null
    const bodyB = this.world.getEntity(idB)?.getComponent<RigidBodyComponent>('RigidBody')?.physicsBody ?? null

    // Try to resolve body from parent containers if entity itself has no container
    // (e.g. child entity with Collider but no RigidBody — body is on the root).
    const resolvedBodyA = bodyA ?? this._resolveBodyForEntity(idA)
    const resolvedBodyB = bodyB ?? this._resolveBodyForEntity(idB)
    if (!resolvedBodyA || !resolvedBodyB) return null

    const pivotA = new Vector3(compA.pivotA.x, compA.pivotA.y, compA.pivotA.z)
    const pivotB = new Vector3(compA.pivotB.x, compA.pivotB.y, compA.pivotB.z)
    const axisA  = new Vector3(compA.axisA.x,  compA.axisA.y,  compA.axisA.z)
    const axisB  = new Vector3(compA.axisB.x,  compA.axisB.y,  compA.axisB.z)

    let constraint: PhysicsConstraint

    switch (compA.constraintType) {
      case 'BallAndSocket':
        constraint = new BallAndSocketConstraint(pivotA, pivotB, axisA, axisB, this._scene)
        break
      case 'Distance':
        constraint = new DistanceConstraint(compA.maxDistance, this._scene)
        break
      case 'Hinge':
        constraint = new HingeConstraint(pivotA, pivotB, axisA, axisB, this._scene)
        break
      case 'Slider':
        constraint = new SliderConstraint(pivotA, pivotB, axisA, axisB, this._scene)
        break
      case 'Lock':
        constraint = new LockConstraint(pivotA, pivotB, axisA, axisB, this._scene)
        break
      case 'Prismatic':
        constraint = new PrismaticConstraint(pivotA, pivotB, axisA, axisB, this._scene)
        break
      default:
        return null
    }

    resolvedBodyA.addConstraint(resolvedBodyB, constraint)
    constraint.isCollisionsEnabled = compA.collisionsEnabled
    return constraint
  }

  /**
   * Find the PhysicsBody responsible for the given entity.  This may be the
   * body on the entity itself (if it has a RigidBody) or the body on the
   * nearest ancestor with a RigidBody (because compound shapes attach to the root).
   */
  private _resolveBodyForEntity(entityId: string): PhysicsBody | null {
    let current = this.world.getEntity(entityId)
    while (current) {
      const rb = current.getComponent<RigidBodyComponent>('RigidBody')
      if (rb?.physicsBody) return rb.physicsBody
      if (!current.parentId) return null
      current = this.world.getEntity(current.parentId)
    }
    return null
  }

}

