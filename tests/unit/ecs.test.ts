import { describe, it, expect } from 'vitest'
import { World } from '@/core/ecs/World'
import { Component } from '@/core/ecs/Component'
import { TransformComponent, toVec3 } from '@/core/ecs/components/TransformComponent'
import { NameComponent } from '@/core/ecs/components/NameComponent'
import { getComponentFactory } from '@/core/ecs/componentRegistry'

class MarkerComponent extends Component {
  readonly type = 'Marker'
  value = 0
  override serialize(): Record<string, unknown> { return { value: this.value } }
}

describe('World / Entity', () => {
  it('gives every new entity the four default components', () => {
    const e = new World().createEntity('Thing')
    expect(e.componentTypes.sort()).toEqual(['Active', 'Name', 'Tag', 'Transform'])
  })

  it('honours an explicit id', () => {
    expect(new World().createEntity('Thing', 'fixed-id').id).toBe('fixed-id')
  })

  it('looks components up by type', () => {
    const e = new World().createEntity()
    expect(e.getComponent<TransformComponent>('Transform')).toBeInstanceOf(TransformComponent)
    expect(e.getComponent('Nope')).toBeUndefined()
  })

  it('stamps entityId onto added components', () => {
    const e = new World().createEntity('Thing', 'abc')
    e.addComponent(new MarkerComponent())
    expect(e.getComponent<MarkerComponent>('Marker')!.entityId).toBe('abc')
  })

  it('replaces a component of the same type rather than duplicating it', () => {
    const e = new World().createEntity()
    const a = new MarkerComponent(); a.value = 1
    const b = new MarkerComponent(); b.value = 2
    e.addComponent(a)
    e.addComponent(b)
    expect(e.componentTypes.filter(t => t === 'Marker')).toHaveLength(1)
    expect(e.getComponent<MarkerComponent>('Marker')!.value).toBe(2)
  })

  it('removes and destroys', () => {
    const w = new World()
    const e = w.createEntity()
    expect(e.removeComponent('Transform')).toBe(true)
    expect(e.hasComponent('Transform')).toBe(false)
    expect(w.destroyEntity(e.id)).toBe(true)
    expect(w.getEntity(e.id)).toBeUndefined()
  })
})

describe('World.query', () => {
  it('returns only entities holding every listed type', () => {
    const w  = new World()
    const a  = w.createEntity('A')
    w.createEntity('B')
    a.addComponent(new MarkerComponent())

    expect(w.query('Transform')).toHaveLength(2)
    const marked = w.query('Transform', 'Marker')
    expect(marked).toHaveLength(1)
    expect(marked[0]!.name).toBe('A')
  })

  it('returns nothing for an unknown type', () => {
    const w = new World()
    w.createEntity()
    expect(w.query('Nope')).toHaveLength(0)
  })
})

describe('World serialization', () => {
  it('round-trips entities, hierarchy and component data', () => {
    const w      = new World()
    const parent = w.createEntity('Parent')
    const child  = w.createEntity('Child')
    child.parentId = parent.id
    child.tags     = ['enemy']
    child.active   = false
    child.getComponent<TransformComponent>('Transform')!.position = { x: 1, y: 2, z: 3 }

    const restored = new World()
    restored.deserialize(w.serialize(), getComponentFactory)

    const rChild = restored.getEntity(child.id)!
    expect(restored.entities.size).toBe(2)
    expect(rChild.parentId).toBe(parent.id)
    expect(rChild.tags).toEqual(['enemy'])
    expect(rChild.active).toBe(false)
    expect(toVec3(rChild.getComponent<TransformComponent>('Transform')!.position))
      .toEqual({ x: 1, y: 2, z: 3 })
  })

  it('skips entities flagged non-persistent', () => {
    const w = new World()
    w.createEntity('Keep')
    const helper = w.createEntity('EditorGrid')
    helper.persistent = false

    const names = w.serialize().entities.map(e => e.name)
    expect(names).toEqual(['Keep'])
  })

  it('skips components flagged non-persistent', () => {
    const w = new World()
    const e = w.createEntity('Thing')
    const m = new MarkerComponent()
    m.persistent = false
    e.addComponent(m)

    const types = w.serialize().entities[0]!.components.map(c => c.type)
    expect(types).not.toContain('Marker')
    expect(types).toContain('Transform')
  })

  it('silently skips component types with no registered factory', () => {
    const w = new World()
    w.createEntity('Thing').addComponent(new MarkerComponent())

    const restored = new World()
    restored.deserialize(w.serialize(), getComponentFactory)
    // Marker is not in the registry, so it drops out — the entity survives.
    expect(restored.entities.size).toBe(1)
    expect([...restored.entities.values()][0]!.hasComponent('Marker')).toBe(false)
  })

  it('clears existing entities before deserializing', () => {
    const w = new World()
    w.createEntity('Old')
    w.deserialize({ entities: [] }, getComponentFactory)
    expect(w.entities.size).toBe(0)
  })
})

describe('componentRegistry', () => {
  it('resolves built-in types', () => {
    expect(getComponentFactory('Transform')).toBeTypeOf('function')
    expect(getComponentFactory('Name')).toBeTypeOf('function')
  })

  it('resolves the dynamic Script:<guid> keys that cannot be pre-registered', () => {
    expect(getComponentFactory('Script:abc-123')).toBeTypeOf('function')
  })

  it('returns undefined for unknown types', () => {
    expect(getComponentFactory('TotallyUnknown')).toBeUndefined()
  })

  it('produces working instances', () => {
    const name = getComponentFactory('Name')!({ name: 'Restored' })
    expect(name).toBeInstanceOf(NameComponent)
  })
})

describe('Component change notification', () => {
  it('fires listeners and can unsubscribe', () => {
    const c = new MarkerComponent()
    let hits = 0
    const off = c.onChange(() => { hits++ })

    c.notifyChanged()
    expect(hits).toBe(1)

    off()
    c.notifyChanged()
    expect(hits).toBe(1)
  })

  it('supports multiple independent listeners', () => {
    const c = new MarkerComponent()
    let a = 0, b = 0
    c.onChange(() => { a++ })
    c.onChange(() => { b++ })
    c.notifyChanged()
    expect([a, b]).toEqual([1, 1])
  })
})
