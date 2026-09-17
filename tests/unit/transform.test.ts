import { describe, it, expect } from 'vitest'
import { Vector3 } from '@babylonjs/core'
import { TransformComponent, toVec3 } from '@/core/ecs/components/TransformComponent'

describe('toVec3', () => {
  it('reads the accessor values, not Babylon private fields', () => {
    const v = new Vector3(1, 2, 3)
    expect(toVec3(v)).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('is the reason spreading a Vector3 must not be used', () => {
    // Regression guard: x/y/z are prototype accessors, so a spread copies
    // _x/_y/_z/_isDirty instead. This silently produced coordinate-less
    // snapshots in the gizmo undo and prefab-apply paths.
    const spread = { ...new Vector3(1, 2, 3) } as Record<string, unknown>
    expect(spread.x).toBeUndefined()
    expect(toVec3(new Vector3(1, 2, 3)).x).toBe(1)
  })

  it('detaches from the source vector', () => {
    const v    = new Vector3(1, 2, 3)
    const snap = toVec3(v)
    v.set(9, 9, 9)
    expect(snap).toEqual({ x: 1, y: 2, z: 3 })
  })
})

describe('TransformComponent', () => {
  it('defaults to origin with unit scale', () => {
    const t = new TransformComponent()
    expect(toVec3(t.position)).toEqual({ x: 0, y: 0, z: 0 })
    expect(toVec3(t.rotation)).toEqual({ x: 0, y: 0, z: 0 })
    expect(toVec3(t.scale)).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('accepts a plain Vec3 on assignment', () => {
    const t = new TransformComponent()
    t.position = { x: 4, y: 5, z: 6 }
    expect(toVec3(t.position)).toEqual({ x: 4, y: 5, z: 6 })
  })

  it('accepts a Babylon Vector3 on assignment', () => {
    const t = new TransformComponent()
    t.scale = new Vector3(2, 2, 2)
    expect(toVec3(t.scale)).toEqual({ x: 2, y: 2, z: 2 })
  })

  it('copies in place rather than replacing the vector instance', () => {
    const t   = new TransformComponent()
    const ref = t.position
    t.position = { x: 7, y: 8, z: 9 }
    // Scripts hold on to transform.position — assignment must not swap it out.
    expect(t.position).toBe(ref)
    expect(ref.x).toBe(7)
  })

  it('round-trips through serialize / deserialize', () => {
    const t = new TransformComponent()
    t.position = { x: 1.5, y: -2, z: 0.25 }
    t.rotation = { x: 0.1, y: 0.2, z: 0.3 }
    t.scale    = { x: 2, y: 3, z: 4 }

    const restored = TransformComponent.deserialize(t.serialize())
    expect(toVec3(restored.position)).toEqual({ x: 1.5, y: -2, z: 0.25 })
    expect(toVec3(restored.scale)).toEqual({ x: 2, y: 3, z: 4 })
  })

  it('serializes plain numbers, not Babylon internals', () => {
    const t = new TransformComponent()
    t.position = { x: 1, y: 2, z: 3 }
    expect(t.serialize().position).toEqual({ x: 1, y: 2, z: 3 })
  })
})
