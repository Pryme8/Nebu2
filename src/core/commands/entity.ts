// 
// Commands  Entity operations
// 

import type { ICommand }         from '@/types/command'
import type { SerializedEntity, SerializedComponent } from '@/core/ecs/World'
import type { Entity }           from '@/core/ecs/Entity'
import { useSceneStore }         from '@/stores/sceneStore'
import { generateGuid }          from '@/lib/guid'

//  Shared helpers 

export function snapshotSubtree(rootId: string): SerializedEntity[] {
  const entities = useSceneStore().activeScene?.world.entities
  if (!entities) return []
  return _collectSubtree(entities, rootId).map(_snapshotEntity)
}

function _snapshotEntity(entity: Entity): SerializedEntity {
  const components: SerializedComponent[] = []
  for (const comp of entity.components) {
    if (comp.persistent) components.push({ type: comp.type, data: comp.serialize() })
  }
  return {
    id:         entity.id,
    name:       entity.name,
    parentId:   entity.parentId,
    sortOrder:  entity.sortOrder,
    tags:       [...entity.tags],
    active:     entity.active,
    components,
  }
}

function _collectSubtree(
  entities: ReadonlyMap<string, Entity>,
  rootId:   string,
): Entity[] {
  const result: Entity[] = []
  const queue: string[]  = [rootId]
  while (queue.length > 0) {
    const id     = queue.shift()!
    const entity = entities.get(id)
    if (!entity) continue
    result.push(entity)
    for (const [, e] of entities) {
      if (e.parentId === id) queue.push(e.id)
    }
  }
  return result
}

//  CreateEntityCommand 

type ComponentFactory = () => import('@/core/ecs/Component').Component

export class CreateEntityCommand implements ICommand {
  readonly description:        string
  readonly silent              = false
  private  _snapshot:          SerializedEntity | null = null
  private  _entityName:        string
  private  _parentId:          string | null
  private  _initialComponents: ComponentFactory[]

  constructor(
    entityName:        string,
    parentId:          string | null,
    initialComponents: ComponentFactory[] = [],
  ) {
    this._entityName        = entityName
    this._parentId          = parentId
    this._initialComponents = initialComponents
    this.description        = `Create ${entityName}`
  }

  execute(): void {
    const sceneStore = useSceneStore()

    if (this._snapshot) {
      sceneStore.restoreEntity(this._snapshot)
      return
    }

    const entity = sceneStore.createEntity(this._entityName, this._parentId)
    for (const factory of this._initialComponents) {
      sceneStore.addComponentToEntity(entity.id, factory())
    }

    const live = sceneStore.activeScene?.world.getEntity(entity.id)
    if (live) this._snapshot = _snapshotEntity(live)
  }

  undo(): void {
    if (!this._snapshot) return
    const sceneStore = useSceneStore()
    const entity = sceneStore.activeScene?.world.getEntity(this._snapshot.id)
    if (entity) this._snapshot = _snapshotEntity(entity)
    sceneStore.destroyEntity(this._snapshot!.id)
  }
}

//  DestroyEntityCommand 

export class DestroyEntityCommand implements ICommand {
  readonly description: string
  readonly silent       = false
  private  _snapshots:  SerializedEntity[] = []
  private  _entityId:   string

  constructor(entityId: string, entityName: string) {
    this._entityId   = entityId
    this.description = `Delete "${entityName}"` 
  }

  execute(): void {
    const sceneStore = useSceneStore()
    const entities   = sceneStore.activeScene?.world.entities
    if (!entities) return

    const subtree   = _collectSubtree(entities, this._entityId)
    this._snapshots = subtree.map(_snapshotEntity)

    for (const entity of [...subtree].reverse()) {
      sceneStore.destroyEntity(entity.id)
    }
  }

  undo(): void {
    const sceneStore = useSceneStore()
    for (const snapshot of this._snapshots) {
      sceneStore.restoreEntity(snapshot)
    }
  }
}

//  RenameEntityCommand 

export class RenameEntityCommand implements ICommand {
  readonly description: string
  readonly silent       = true
  private  _entityId:   string
  private  _oldName:    string
  private  _newName:    string

  constructor(entityId: string, oldName: string, newName: string) {
    this._entityId   = entityId
    this._oldName    = oldName
    this._newName    = newName
    this.description = `Rename "${oldName}" -> "${newName}"`
  }

  execute(): void { useSceneStore().renameEntity(this._entityId, this._newName) }
  undo():    void { useSceneStore().renameEntity(this._entityId, this._oldName) }
}

//  SetEntityActiveCommand 

export class SetEntityActiveCommand implements ICommand {
  readonly description: string
  readonly silent       = true
  private  _entityId:   string
  private  _oldActive:  boolean
  private  _newActive:  boolean

  constructor(entityId: string, oldActive: boolean, newActive: boolean) {
    this._entityId   = entityId
    this._oldActive  = oldActive
    this._newActive  = newActive
    this.description = newActive ? 'Show Entity' : 'Hide Entity'
  }

  execute(): void { useSceneStore().setEntityActive(this._entityId, this._newActive) }
  undo():    void { useSceneStore().setEntityActive(this._entityId, this._oldActive) }
}

//  ReparentEntityCommand 

export class ReparentEntityCommand implements ICommand {
  readonly description: string
  readonly silent       = true
  private  _entityId:    string
  private  _oldParentId: string | null
  private  _newParentId: string | null

  constructor(entityId: string, oldParentId: string | null, newParentId: string | null) {
    this._entityId    = entityId
    this._oldParentId = oldParentId
    this._newParentId = newParentId
    this.description  = 'Reparent Entity'
  }

  execute(): void { useSceneStore().reparentEntity(this._entityId, this._newParentId) }
  undo():    void { useSceneStore().reparentEntity(this._entityId, this._oldParentId) }
}

// ── ReorderEntityCommand ─────────────────────────────────────────────

/**
 * Reorders an entity relative to a sibling (insert before or after).
 * Also reparents to the relative entity’s parent level if they differ.
 * Fully undoable: snapshots all affected entities’ parentId + sortOrder.
 */
export class ReorderEntityCommand implements ICommand {
  readonly description: string
  readonly silent       = false
  private _entityId:    string
  private _relativeId:  string
  private _before:      boolean
  private _snapshot: { id: string; parentId: string | null; sortOrder: number }[] = []

  constructor(entityId: string, relativeId: string, insertBefore: boolean) {
    this._entityId   = entityId
    this._relativeId = relativeId
    this._before     = insertBefore
    this.description = 'Reorder'
  }

  execute(): void {
    const store = useSceneStore()
    const scene = store.activeScene
    if (!scene) return
    const entity   = scene.world.getEntity(this._entityId)
    const relative = scene.world.getEntity(this._relativeId)
    if (!entity || !relative) return

    // Snapshot siblings in both old and new parent levels for undo
    const newParent = relative.parentId
    const oldParent = entity.parentId
    const affected  = new Set([this._entityId])
    for (const e of scene.world.entities.values()) {
      if (e.parentId === newParent || e.parentId === oldParent) affected.add(e.id)
    }
    this._snapshot = [...affected].map(id => {
      const e = scene.world.getEntity(id)!
      return { id, parentId: e.parentId, sortOrder: e.sortOrder }
    })

    store.reorderEntity(this._entityId, this._relativeId, this._before)
  }

  undo(): void {
    useSceneStore().restoreEntityParentsAndSortOrders(this._snapshot)
  }
}

// ── CopyEntityCommand ─────────────────────────────────────────────────

/**
 * Computes the next available copy name for the given entity.
 * Strips any trailing " (N)" from the entity's name to get the root,
 * then returns "Root (N+1)" where N is the highest existing copy number.
 */
function _generateCopyName(sourceId: string): string {
  const store = useSceneStore()
  const world = store.activeScene?.world
  if (!world) return 'Copy'
  const source = world.getEntity(sourceId)
  if (!source) return 'Copy'

  const rootName = source.name.replace(/\s*\(\d+\)$/, '')
  let max = 1
  for (const [, entity] of world.entities) {
    if (entity.name === rootName) {
      max = Math.max(max, 1)
    } else {
      const m = entity.name.match(/^(.+?)\s*\((\d+)\)$/)
      if (m && m[1] === rootName) max = Math.max(max, parseInt(m[2]!, 10))
    }
  }
  return `${rootName} (${max + 1})`
}

export class CopyEntityCommand implements ICommand {
  description:     string
  readonly silent  = false
  private _sourceId:  string
  private _parentId:  string | null
  private _snapshot:  SerializedEntity | null = null

  constructor(sourceId: string, parentId: string | null) {
    this._sourceId  = sourceId
    this._parentId  = parentId
    this.description = 'Copy Entity'
  }

  execute(): void {
    const store = useSceneStore()
    if (this._snapshot) {
      store.restoreEntity(this._snapshot)
      return
    }
    const name  = _generateCopyName(this._sourceId)
    this.description = `Copy "${name}"`
    const clone = store.cloneEntity(this._sourceId, this._parentId, name)
    const live  = store.activeScene?.world.getEntity(clone.id)
    if (live) this._snapshot = _snapshotEntity(live)
  }

  undo(): void {
    if (!this._snapshot) return
    const store = useSceneStore()
    // Refresh snapshot before destroying (sortOrder may have changed)
    const live = store.activeScene?.world.getEntity(this._snapshot.id)
    if (live) this._snapshot = _snapshotEntity(live)
    store.destroyEntity(this._snapshot!.id)
  }
}

// ── PasteEntityCommand ───────────────────────────────────────────────────────

/**
 * Re-instantiate a previously snapshotted subtree under `parentId`.
 *
 * Every id in the snapshot is remapped to a fresh GUID, with internal
 * parent links rewritten to match, so the same clipboard contents can be
 * pasted repeatedly and survive the source being deleted (Cut).
 */
export class PasteEntityCommand implements ICommand {
  readonly description: string
  readonly silent      = false
  private  _source:    SerializedEntity[]
  private  _parentId:  string | null
  /** Ids created by execute(), so undo() can remove exactly those. */
  private  _createdIds: string[] = []

  constructor(snapshots: SerializedEntity[], parentId: string | null) {
    this._source     = snapshots
    this._parentId   = parentId
    this.description = `Paste "${snapshots[0]?.name ?? 'Entity'}"`
  }

  execute(): void {
    const sceneStore = useSceneStore()
    if (this._source.length === 0) return

    // Old id → new id for the whole subtree, resolved before any restore so
    // child parentIds can be rewritten in one pass.
    const idMap = new Map<string, string>()
    for (const snap of this._source) idMap.set(snap.id, generateGuid())

    const rootOldId = this._source[0]?.id
    this._createdIds = []

    for (const snap of this._source) {
      const newId = idMap.get(snap.id)!
      const clone: SerializedEntity = {
        ...snap,
        id:       newId,
        name:     snap.id === rootOldId ? `${snap.name} (Copy)` : snap.name,
        // Root re-parents to the paste target; descendants follow the remap.
        parentId: snap.id === rootOldId
          ? this._parentId
          : (snap.parentId ? idMap.get(snap.parentId) ?? null : null),
        tags:       [...snap.tags],
        components: snap.components.map(c => ({ type: c.type, data: { ...c.data } })),
      }
      sceneStore.restoreEntity(clone)
      this._createdIds.push(newId)
    }
  }

  undo(): void {
    const sceneStore = useSceneStore()
    // Children first so parents never disappear out from under them.
    for (const id of [...this._createdIds].reverse()) {
      sceneStore.destroyEntity(id)
    }
    this._createdIds = []
  }
}
