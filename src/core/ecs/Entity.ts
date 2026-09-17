// ─────────────────────────────────────────────
// ECS — Entity
// ─────────────────────────────────────────────

import type { Component } from './Component'

/** A scene entity.  Holds a typed component map and lightweight hierarchy info. */
export class Entity {
  readonly id:  string
  name:         string
  parentId:     string | null = null
  tags:         string[]      = []
  active:       boolean       = true

  /**   * Sort order within the entity's sibling group.
   * Lower values appear earlier in the hierarchy.
   * Assigned automatically by sceneStore.createEntity.
   */
  sortOrder: number = 0

  /**   * Whether this entity is written to the scene file when the world is
   * serialized.  Set to `false` for runtime-only / editor-helper entities
   * (ground grids, gizmo proxies, preview objects, etc.) that should never
   * appear in saved scenes.
   */
  persistent: boolean = true

  private readonly _components = new Map<string, Component>()

  constructor(id: string, name: string) {
    this.id   = id
    this.name = name
  }

  addComponent<T extends Component>(component: T): T {
    component.entityId = this.id
    this._components.set(component.type, component)
    return component
  }

  getComponent<T extends Component>(type: string): T | undefined {
    return this._components.get(type) as T | undefined
  }

  hasComponent(type: string): boolean {
    return this._components.has(type)
  }

  removeComponent(type: string): boolean {
    return this._components.delete(type)
  }

  get components(): IterableIterator<Component> {
    return this._components.values()
  }

  get componentTypes(): string[] {
    return [...this._components.keys()]
  }
}
