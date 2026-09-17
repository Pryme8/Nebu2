// ─────────────────────────────────────────────
// ColliderComponent
//
// Defines the collision shape for an entity.
// Works together with RigidBodyComponent — the HavokPhysicsSystem reads
// both components to create a PhysicsAggregate (Babylon's combined
// shape + body descriptor).
//
// Havok shape mapping:
//   Box        → PhysicsShapeType.BOX         (size = half-extents)
//   Sphere     → PhysicsShapeType.SPHERE       (radius)
//   Capsule    → PhysicsShapeType.CAPSULE       (radius + height)
//   Cylinder   → PhysicsShapeType.CYLINDER      (radius + height)
//   ConvexHull → PhysicsShapeType.CONVEX_HULL   (auto from mesh)
//   Mesh       → PhysicsShapeType.MESH           (triangle mesh, Static only)
// ─────────────────────────────────────────────

import { Component }           from '@/core/ecs/Component'
import type { InspectorSchema } from '@/types/inspector'
import type { WidgetSchema }    from '@/types/widget'
import { Mesh, TransformNode, VertexBuffer, type PhysicsShape, type Scene } from '@babylonjs/core'
import { boxWireframe, sphereWireframe, cylinderWireframe, capsuleWireframe, meshWireframe } from '@/lib/widgetShapes'

// ── Shape type ─────────────────────────────────────────────────────────────

export type ColliderShape =
  | 'Box'
  | 'Sphere'
  | 'Capsule'
  | 'Cylinder'
  | 'ConvexHull'
  | 'Mesh'

const SHAPE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Box',          value: 'Box'         },
  { label: 'Sphere',       value: 'Sphere'      },
  { label: 'Capsule',      value: 'Capsule'     },
  { label: 'Cylinder',     value: 'Cylinder'    },
  { label: 'Convex Hull',  value: 'ConvexHull'  },
  { label: 'Mesh (Static)', value: 'Mesh'        },
]

// ── Component ──────────────────────────────────────────────────────────────

export class ColliderComponent extends Component {
  readonly type = 'Collider'

  /** Shape primitive used for collision detection. */
  shape: ColliderShape = 'Box'

  // Per-shape sizing (HavokPhysicsSystem picks relevant fields based on shape)

  /** Half-extents for Box shape (world units). */
  sizeX: number = 0.5
  sizeY: number = 0.5
  sizeZ: number = 0.5

  /** Radius for Sphere, Capsule, and Cylinder shapes. */
  radius: number = 0.5

  /** Total height for Capsule and Cylinder shapes. */
  height: number = 1.0

  /**
   * When true this collider acts as a trigger volume — it detects overlaps
   * but does not generate contact forces.
   *
   * Note: triggers are supported through Havok's isTrigger IPhysicsShape flag.
   */
  isTrigger: boolean = false

  /**
   * Position offset of the collider relative to the entity's transform.
   * Useful when the visual mesh is not centred at the origin.
   */
  offsetX: number = 0
  offsetY: number = 0
  offsetZ: number = 0

  // ── Runtime refs — not serialised ─────────────────────────────────
  /** Babylon scene reference — set by onWidgetAttach(), used by onWidgetDraw(). */
  private _bScene: Scene | null = null

  /**
   * The Babylon PhysicsShape built for this collider.
   * Assigned by HavokPhysicsSystem when the parent RigidBody is wired up.
   * Disposed here in onDispose() — do **not** store a duplicate ref anywhere else.
   */
  physicsShape: PhysicsShape | null = null

  override onWidgetAttach(scene: unknown): void {
    this._bScene = scene as Scene
  }

  override onDispose(): void {
    this.physicsShape?.dispose()
    this.physicsShape = null
  }

  // ── Inspector ──────────────────────────────────────────────────────────────

  override onInspectorDraw(): InspectorSchema {
    const fields: InspectorSchema[0]['fields'] = [
      { key: 'showWidget', label: 'Show Widget', type: 'boolean' },
      { key: 'shape',      label: 'Shape',       type: 'enum',    options: SHAPE_OPTIONS },
      { key: 'isTrigger',  label: 'Is Trigger',  type: 'boolean' },
    ]

    if (this.shape === 'Box') {
      fields.push(
        { key: 'sizeX', label: 'Half-Extent X', type: 'number', min: 0.001, step: 0.05 },
        { key: 'sizeY', label: 'Half-Extent Y', type: 'number', min: 0.001, step: 0.05 },
        { key: 'sizeZ', label: 'Half-Extent Z', type: 'number', min: 0.001, step: 0.05 },
      )
    } else if (this.shape === 'Sphere') {
      fields.push(
        { key: 'radius', label: 'Radius', type: 'number', min: 0.001, step: 0.05 },
      )
    } else if (this.shape === 'Capsule' || this.shape === 'Cylinder') {
      fields.push(
        { key: 'radius', label: 'Radius', type: 'number', min: 0.001, step: 0.05 },
        { key: 'height', label: 'Height', type: 'number', min: 0.001, step: 0.1  },
      )
    }

    fields.push(
      { key: 'offsetX', label: 'Offset X', type: 'number', step: 0.01 },
      { key: 'offsetY', label: 'Offset Y', type: 'number', step: 0.01 },
      { key: 'offsetZ', label: 'Offset Z', type: 'number', step: 0.01 },
    )

    return [{ title: 'Collider', fields }]
  }

  // ── Viewport widget ────────────────────────────────────────────

  override onWidgetDraw(): WidgetSchema {
    const { offsetX: cx, offsetY: cy, offsetZ: cz } = this
    const color = { r: 0.0, g: 0.9, b: 0.4 }

    switch (this.shape) {
      case 'Box':
        return { groups: [{ lines: boxWireframe(this.sizeX, this.sizeY, this.sizeZ, cx, cy, cz), color }] }
      case 'Sphere':
        return { groups: [{ lines: sphereWireframe(this.radius, 32, cx, cy, cz), color }] }
      case 'Capsule':
        return { groups: [{ lines: capsuleWireframe(this.radius, this.height, 32, cx, cy, cz), color }] }
      case 'Cylinder':
        return { groups: [{ lines: cylinderWireframe(this.radius, this.height, 32, cx, cy, cz), color }] }
      case 'ConvexHull':
      case 'Mesh': {
        if (!this._bScene) return { groups: [] }
        // 1. Procedural mesh — named exactly with the entity id.
        let bMesh = this._bScene.meshes.find(
          m => m instanceof Mesh && m.name === this.entityId,
        ) as Mesh | undefined
        // 2. Imported model mesh — parented under the entity's TransformNode
        //    (id = entityId because sceneStore does: new TransformNode(entity.id, scene)).
        if (!bMesh) {
          const tfNode = this._bScene.getTransformNodeById(this.entityId)
          if (tfNode instanceof TransformNode) {
            bMesh = tfNode.getChildMeshes(false).find(m => m instanceof Mesh) as Mesh | undefined
          }
        }
        if (!bMesh) return { groups: [] }
        const rawPos = bMesh.getVerticesData(VertexBuffer.PositionKind)
        const rawIdx = bMesh.getIndices()
        if (!rawPos || !rawIdx) return { groups: [] }
        const verts = []
        for (let i = 0; i < rawPos.length; i += 3) {
          verts.push({ x: rawPos[i]!, y: rawPos[i + 1]!, z: rawPos[i + 2]! })
        }
        return { groups: [{ lines: meshWireframe(verts, Array.from(rawIdx), cx, cy, cz), color }] }
      }
      default:
        return { groups: [] }
    }
  }

  // ── Serialisation ──────────────────────────────────────────────────────────

  override serialize(): Record<string, unknown> {
    return {
      showWidget: this.showWidget,
      shape:     this.shape,
      sizeX:     this.sizeX,
      sizeY:     this.sizeY,
      sizeZ:     this.sizeZ,
      radius:    this.radius,
      height:    this.height,
      isTrigger: this.isTrigger,
      offsetX:   this.offsetX,
      offsetY:   this.offsetY,
      offsetZ:   this.offsetZ,
    }
  }

  static deserialize(data: Record<string, unknown>): ColliderComponent {
    const c = new ColliderComponent()
    if (typeof data.showWidget === 'boolean') c.showWidget = data.showWidget
    if (typeof data.shape     === 'string')   c.shape      = data.shape as ColliderShape
    if (typeof data.sizeX     === 'number')  c.sizeX     = data.sizeX
    if (typeof data.sizeY     === 'number')  c.sizeY     = data.sizeY
    if (typeof data.sizeZ     === 'number')  c.sizeZ     = data.sizeZ
    if (typeof data.radius    === 'number')  c.radius    = data.radius
    if (typeof data.height    === 'number')  c.height    = data.height
    if (typeof data.isTrigger === 'boolean') c.isTrigger = data.isTrigger
    if (typeof data.offsetX   === 'number')  c.offsetX   = data.offsetX
    if (typeof data.offsetY   === 'number')  c.offsetY   = data.offsetY
    if (typeof data.offsetZ   === 'number')  c.offsetZ   = data.offsetZ
    return c
  }
}
