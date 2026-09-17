// ─────────────────────────────────────────────
// ECS — World
// ─────────────────────────────────────────────

import { Entity }             from './Entity'
import type { Component }     from './Component'
import type { System }        from './System'
import { TransformComponent } from './components/TransformComponent'
import { NameComponent }      from './components/NameComponent'
import { TagComponent }       from './components/TagComponent'
import { ActiveComponent }    from './components/ActiveComponent'
import { generateGuid }       from '@/lib/guid'

// ── Serialization shapes ─────────────────────────────────────────

export interface SerializedComponent {
  type: string
  data: Record<string, unknown>
}

export interface SerializedEntity {
  id:         string
  name:       string
  parentId:   string | null
  sortOrder?: number
  tags:       string[]
  active:     boolean
  components: SerializedComponent[]
}

export interface SerializedWorld {
  entities: SerializedEntity[]
}

// ── World ────────────────────────────────────────────────────────

/**
 * The ECS World — owns all entities and systems for a single scene.
 * Every entity created here automatically receives the four default
 * components: Transform, Name, Tag, Active.
 */
export class World {
  private readonly _entities = new Map<string, Entity>()
  private readonly _systems:  System[] = []

  // ── Entity CRUD ─────────────────────────────────────────────────

  createEntity(name = 'Empty Entity', id?: string): Entity {
    const entityId = id ?? generateGuid()
    const entity   = new Entity(entityId, name)
    entity.addComponent(new NameComponent(name))
    entity.addComponent(new TagComponent())
    entity.addComponent(new ActiveComponent())
    entity.addComponent(new TransformComponent())
    this._entities.set(entityId, entity)
    return entity
  }

  destroyEntity(id: string): boolean {
    return this._entities.delete(id)
  }

  getEntity(id: string): Entity | undefined {
    return this._entities.get(id)
  }

  get entities(): ReadonlyMap<string, Entity> {
    return this._entities
  }

  // ── Systems ──────────────────────────────────────────────────────

  addSystem(system: System): this {
    system.world = this
    this._systems.push(system)
    return this
  }

  removeSystem(system: System): void {
    const i = this._systems.indexOf(system)
    if (i !== -1) this._systems.splice(i, 1)
  }

  // ── Queries ──────────────────────────────────────────────────────

  /** Return all entities that have every listed component type. */
  query(...componentTypes: string[]): Entity[] {
    const result: Entity[] = []
    for (const entity of this._entities.values()) {
      if (componentTypes.every(t => entity.hasComponent(t))) result.push(entity)
    }
    return result
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  onStart(): void    { for (const s of this._systems) s.onStart() }
  onUpdate(dt: number): void { for (const s of this._systems) s.onUpdate(dt) }
  onShutdown(): void {
    for (const s of this._systems) s.onShutdown()
    this._entities.clear()
  }

  // ── Serialization ────────────────────────────────────────────────

  serialize(): SerializedWorld {
    const entities: SerializedEntity[] = []
    for (const entity of this._entities.values()) {
      // Skip runtime-only entities (editor grids, gizmo proxies, etc.)
      if (!entity.persistent) continue

      const components: SerializedComponent[] = []
      for (const comp of entity.components) {
        // Skip components that explicitly opt out of serialization
        if (!comp.persistent) continue
        components.push({ type: comp.type, data: comp.serialize() })
      }
      entities.push({
        id:         entity.id,
        name:       entity.name,
        parentId:   entity.parentId,
        sortOrder:  entity.sortOrder,
        tags:       [...entity.tags],
        active:     entity.active,
        components,
      })
    }
    return { entities }
  }

  /**
   * Populate this world from serialized data.
   *
   * @param data        The serialized world produced by `serialize()`.
   * @param lookupFactory  A function that maps a component type string to its
   *   deserializer factory.  Returning `undefined` silently skips that component.
   *   Pass `getComponentFactory` from `componentRegistry` to automatically handle
   *   all registered types (including dynamic ones like `'Script:*'`) without any
   *   per-type wiring here.
   */
  deserialize(
    data:          SerializedWorld,
    lookupFactory: (type: string) => ((d: Record<string, unknown>) => Component) | undefined,
  ): void {
    this._entities.clear()
    for (const se of data.entities) {
      const entity    = new Entity(se.id, se.name)
      entity.parentId  = se.parentId
      entity.tags      = [...se.tags]
      entity.active    = se.active
      entity.sortOrder = se.sortOrder ?? 0
      for (const sc of se.components) {
        const factory = lookupFactory(sc.type)
        if (factory) entity.addComponent(factory(sc.data))
      }
      this._entities.set(entity.id, entity)
    }
  }
}
