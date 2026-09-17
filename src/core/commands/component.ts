// ─────────────────────────────────────────────
// Commands — Component operations
// ─────────────────────────────────────────────

import type { ICommand }         from '@/types/command'
import type { InspectorTarget }  from '@/types/inspector'
import type { Component }        from '@/core/ecs/Component'
import { getComponentFactory }   from '@/core/ecs/componentRegistry'
import { useSceneStore }         from '@/stores/sceneStore'

// ── AddComponentCommand ─────────────────────────────────────────

export class AddComponentCommand implements ICommand {
  readonly description:  string
  readonly silent        = false
  private  _entityId:    string
  private  _factory:     () => Component
  private  _addedType:   string | null = null

  constructor(entityId: string, componentType: string, factory: () => Component) {
    this._entityId   = entityId
    this._factory    = factory
    this.description = `Add ${componentType}`
  }

  execute(): void {
    const component  = this._factory()
    this._addedType  = component.type
    useSceneStore().addComponentToEntity(this._entityId, component)
  }

  undo(): void {
    if (!this._addedType) return
    useSceneStore().removeComponentFromEntity(this._entityId, this._addedType)
    this._addedType = null
  }
}

// ── RemoveComponentCommand ───────────────────────────────────────

export class RemoveComponentCommand implements ICommand {
  readonly description:    string
  readonly silent          = false
  private  _entityId:      string
  private  _componentType: string
  private  _snapshot:      { type: string; data: Record<string, unknown> } | null = null

  constructor(entityId: string, componentType: string) {
    this._entityId      = entityId
    this._componentType = componentType
    this.description    = `Remove ${componentType}`
  }

  execute(): void {
    const sceneStore = useSceneStore()
    const entity     = sceneStore.activeScene?.world.getEntity(this._entityId)
    const comp       = entity?.getComponent(this._componentType)
    if (comp) this._snapshot = { type: comp.type, data: comp.serialize() }
    sceneStore.removeComponentFromEntity(this._entityId, this._componentType)
  }

  undo(): void {
    if (!this._snapshot) return
    const factory = getComponentFactory(this._snapshot.type)
    if (!factory) return
    useSceneStore().addComponentToEntity(this._entityId, factory(this._snapshot.data))
  }
}

// ── SetPropertyCommand ───────────────────────────────────────────

function _deepRead(target: unknown, key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = target
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function _deepWrite(target: unknown, key: string, value: unknown): void {
  const parts = key.split('.')
  const last  = parts.pop()!
  let cur: unknown = target
  for (const p of parts) {
    const parent = cur as Record<string, unknown>
    // Initialise a missing or non-object intermediate so we can traverse into it
    // (e.g. a vec3 propValue that was incorrectly stored as a primitive).
    if (typeof parent[p] !== 'object' || parent[p] === null) {
      parent[p] = {}
    }
    cur = parent[p]
  }
  const dest = cur as Record<string, unknown>
  // If both destination and value are non-null objects (e.g. a Vec3 proxy and a
  // plain { x, y, z } snapshot), write through via Object.assign so that proxy
  // setters are invoked and the underlying Babylon node stays in sync rather
  // than replacing the proxy reference entirely.
  if (typeof value === 'object' && value !== null &&
      typeof dest[last] === 'object' && dest[last] !== null) {
    Object.assign(dest[last] as object, value)
  } else {
    dest[last] = value
  }
}

function _cloneValue(v: unknown): unknown {
  if (typeof v === 'object' && v !== null) return JSON.parse(JSON.stringify(v))
  return v
}

/**
 * Sets a single dot-path property on an InspectorTarget and syncs to Babylon.
 * Consecutive writes to the SAME context+key are merged into one undo step.
 */
export class SetPropertyCommand implements ICommand {
  readonly description: string
  readonly silent       = true   // high-frequency; undo/redo still notifies
  readonly mergeKey:    string
  private  _component:  InspectorTarget
  private  _key:        string
  private  _oldValue:   unknown
  private  _newValue:   unknown

  constructor(
    component:  InspectorTarget,
    key:        string,
    oldValue:   unknown,
    newValue:   unknown,
    contextId:  string,
  ) {
    this._component  = component
    this._key        = key
    this._oldValue   = oldValue
    this._newValue   = newValue
    this.description = `Set ${key}`
    this.mergeKey    = `${contextId}:${key}`
  }

  execute(): void {
    _deepWrite(this._component, this._key, this._newValue)
    this._component.syncToBabylon()
    this._component.notifyChanged()
  }

  undo(): void {
    _deepWrite(this._component, this._key, this._oldValue)
    this._component.syncToBabylon()
    this._component.notifyChanged()
  }

  tryMerge(newer: ICommand): ICommand | null {
    if (!(newer instanceof SetPropertyCommand)) return null
    this._newValue = newer._newValue
    return this
  }

  static capture(
    component: InspectorTarget,
    key:       string,
    newValue:  unknown,
    contextId: string,
  ): SetPropertyCommand {
    const oldValue = _cloneValue(_deepRead(component, key))
    return new SetPropertyCommand(component, key, oldValue, newValue, contextId)
  }
}
