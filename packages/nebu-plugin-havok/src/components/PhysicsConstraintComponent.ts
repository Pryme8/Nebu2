// 
// PhysicsConstraintComponent
//
// Defines a physics joint between this entity and one other entity.
// The component lives only on the entity that owns the joint (entity A).
// The linked entity (entity B) needs no component of its own.
//
// Babylon docs reference:
//   https://doc.babylonjs.com/features/featuresDeepDive/physics/constraints/
// 

import { Vector3, type Scene }            from '@babylonjs/core'
import { Component }                      from '@/core/ecs/Component'
import type { InspectorSchema, Vec3Like } from '@/types/inspector'
import type { WidgetSchema }              from '@/types/widget'
import { pivotMarker }                    from '@/lib/widgetShapes'

//  Constraint type 

export type ConstraintType =
  | 'BallAndSocket'
  | 'Distance'
  | 'Hinge'
  | 'Slider'
  | 'Lock'
  | 'Prismatic'

const CONSTRAINT_TYPES: Array<{ label: string; value: string }> = [
  { label: 'Ball & Socket', value: 'BallAndSocket' },
  { label: 'Distance',      value: 'Distance'      },
  { label: 'Hinge',         value: 'Hinge'         },
  { label: 'Slider',        value: 'Slider'        },
  { label: 'Lock',          value: 'Lock'          },
  { label: 'Prismatic',     value: 'Prismatic'     },
]

//  Component 

export class PhysicsConstraintComponent extends Component {
  readonly type = 'PhysicsConstraint'

  /** Joint type. */
  constraintType: ConstraintType = 'BallAndSocket'

  /** ID of entity B this constraint links to. Null until assigned. */
  linkedEntityId: string | null = null

  //  Pivot points 

  /** Pivot in entity A's (this entity's) local space. */
  pivotA: Vec3Like = { x: 0, y: 0, z: 0 }

  /** Pivot in entity B's (linked entity's) local space. */
  pivotB: Vec3Like = { x: 0, y: 0, z: 0 }

  //  Axis vectors (BallAndSocket, Hinge, Slider, Lock, Prismatic) 

  /** Constraint axis in entity A's local space. */
  axisA: Vec3Like = { x: 0, y: 1, z: 0 }

  /** Constraint axis in entity B's local space. */
  axisB: Vec3Like = { x: 0, y: 1, z: 0 }

  //  Distance constraint 

  /** Maximum allowed distance. Only used by the Distance constraint. */
  maxDistance: number = 1

  //  Collision 

  collisionsEnabled: boolean = true

  //  Internal 

  private _bScene: Scene | null = null

  //  Lifecycle 

  override onWidgetAttach(scene: unknown): void {
    this._bScene = scene as Scene
  }

  //  Viewport widget 

  override onWidgetDraw(): WidgetSchema | null {
    if (!this.linkedEntityId) return { groups: [] }

    const ax = this.pivotA.x, ay = this.pivotA.y, az = this.pivotA.z

    let bx = this.pivotB.x, by = this.pivotB.y, bz = this.pivotB.z
    if (this._bScene) {
      const thisNode   = this._bScene.transformNodes.find(n => n.id === this.entityId)   ?? null
      const linkedNode = this._bScene.transformNodes.find(n => n.id === this.linkedEntityId) ?? null
      if (thisNode && linkedNode) {
        const worldB      = linkedNode.getWorldMatrix()
        const invWorldA   = thisNode.getWorldMatrix().clone().invert()
        const pivotBWorld = Vector3.TransformCoordinates(new Vector3(bx, by, bz), worldB)
        const pivotBLocal = Vector3.TransformCoordinates(pivotBWorld, invWorldA)
        bx = pivotBLocal.x
        by = pivotBLocal.y
        bz = pivotBLocal.z
      }
    }

    return {
      groups: [
        { lines: pivotMarker(ax, ay, az), color: { r: 0.3, g: 0.5, b: 1.0 } },
        { lines: pivotMarker(bx, by, bz), color: { r: 1.0, g: 0.3, b: 0.3 } },
        { lines: [[ { x: ax, y: ay, z: az }, { x: bx, y: by, z: bz } ]], color: { r: 0.7, g: 0.7, b: 0.7 } },
      ],
    }
  }

  //  Serialization 

  override serialize(): Record<string, unknown> {
    return {
      constraintType:    this.constraintType,
      linkedEntityId:    this.linkedEntityId,
      pivotA:            { ...this.pivotA },
      pivotB:            { ...this.pivotB },
      axisA:             { ...this.axisA },
      axisB:             { ...this.axisB },
      maxDistance:       this.maxDistance,
      collisionsEnabled: this.collisionsEnabled,
    }
  }

  static deserialize(data: Record<string, unknown>): PhysicsConstraintComponent {
    const c = new PhysicsConstraintComponent()
    if (typeof data.constraintType === 'string') c.constraintType = data.constraintType as ConstraintType
    if (typeof data.linkedEntityId === 'string' || data.linkedEntityId === null)
      c.linkedEntityId = data.linkedEntityId as string | null
    if (data.pivotA && typeof data.pivotA === 'object') c.pivotA = { ...(data.pivotA as Vec3Like) }
    if (data.pivotB && typeof data.pivotB === 'object') c.pivotB = { ...(data.pivotB as Vec3Like) }
    if (data.axisA  && typeof data.axisA  === 'object') c.axisA  = { ...(data.axisA  as Vec3Like) }
    if (data.axisB  && typeof data.axisB  === 'object') c.axisB  = { ...(data.axisB  as Vec3Like) }
    if (typeof data.maxDistance       === 'number')  c.maxDistance       = data.maxDistance
    if (typeof data.collisionsEnabled === 'boolean') c.collisionsEnabled = data.collisionsEnabled
    return c
  }

  //  Inspector 

  override onInspectorDraw(): InspectorSchema {
    const fields: InspectorSchema[0]['fields'] = [
      { key: 'showWidget',        label: 'Show Widget',        type: 'boolean' },
      { key: 'constraintType',    label: 'Type',               type: 'enum', options: CONSTRAINT_TYPES },
      { key: 'linkedEntityId',    label: 'Linked Body',        type: 'entity-ref' },
      { key: 'collisionsEnabled', label: 'Collisions Enabled', type: 'boolean' },
    ]

    if (this.constraintType === 'Distance') {
      fields.push(
        { key: 'maxDistance', label: 'Max Distance', type: 'number', min: 0, step: 0.1 },
      )
    } else if (this.constraintType === 'Hinge') {
      fields.push(
        { key: 'pivotA', label: 'Pivot A', type: 'vec3', step: 0.01 },
        { key: 'pivotB', label: 'Pivot B', type: 'vec3', step: 0.01 },
        { key: 'axisA',  label: 'Axis A',  type: 'vec3', step: 0.01 },
        { key: 'axisB',  label: 'Axis B',  type: 'vec3', step: 0.01 },
      )
    } else {
      fields.push(
        { key: 'pivotA', label: 'Pivot A', type: 'vec3', step: 0.01 },
        { key: 'pivotB', label: 'Pivot B', type: 'vec3', step: 0.01 },
        { key: 'axisA',  label: 'Axis A',  type: 'vec3', step: 0.01 },
        { key: 'axisB',  label: 'Axis B',  type: 'vec3', step: 0.01 },
      )
    }

    return [{ title: 'Physics Constraint', fields }]
  }
}
