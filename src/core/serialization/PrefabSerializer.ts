// ─────────────────────────────────────────────
// Prefab Serialization / Instantiation Helpers
// ─────────────────────────────────────────────

import type { World, SerializedEntity } from '@/core/ecs/World'
import { generateGuid }                 from '@/lib/guid'

// ── Serialise ────────────────────────────────────────────────────

/**
 * Collect the entity subtree rooted at `rootId` (the root entity plus every
 * descendant), returning them in BFS order with full component data.
 *
 * Only persistent entities and persistent components are included — the same
 * filtering rules as `World.serialize()`.
 */
export function serializeEntitySubtree(world: World, rootId: string): SerializedEntity[] {
  // Pre-build a parentId → children[] map for O(1) child lookup.
  const childrenOf = new Map<string, string[]>()
  for (const entity of world.entities.values()) {
    if (!entity.parentId) continue
    const arr = childrenOf.get(entity.parentId) ?? []
    arr.push(entity.id)
    childrenOf.set(entity.parentId, arr)
  }

  const result: SerializedEntity[] = []
  const queue: string[] = [rootId]

  while (queue.length) {
    const id     = queue.shift()!
    const entity = world.getEntity(id)
    if (!entity || !entity.persistent) continue

    const components: SerializedEntity['components'] = []
    for (const comp of entity.components) {
      if (!comp.persistent) continue
      components.push({ type: comp.type, data: comp.serialize() })
    }

    result.push({
      id:        entity.id,
      name:      entity.name,
      parentId:  entity.parentId,
      sortOrder: entity.sortOrder,
      tags:      [...entity.tags],
      active:    entity.active,
      components,
    })

    for (const childId of childrenOf.get(id) ?? []) {
      queue.push(childId)
    }
  }

  return result
}

/**
 * Collect ALL persistent entities from the world (for a scene-to-prefab save).
 * Original `parentId` links are preserved so the full hierarchy is captured.
 */
export function serializeWorldEntities(world: World): SerializedEntity[] {
  const result: SerializedEntity[] = []

  for (const entity of world.entities.values()) {
    if (!entity.persistent) continue

    const components: SerializedEntity['components'] = []
    for (const comp of entity.components) {
      if (!comp.persistent) continue
      components.push({ type: comp.type, data: comp.serialize() })
    }

    result.push({
      id:        entity.id,
      name:      entity.name,
      parentId:  entity.parentId,
      sortOrder: entity.sortOrder,
      tags:      [...entity.tags],
      active:    entity.active,
      components,
    })
  }

  return result
}

// ── Instantiate ──────────────────────────────────────────────────

/**
 * Remap every entity ID in a prefab snapshot to a fresh GUID, then patch all
 * internal `parentId` and `CameraComponent.targetEntityId` cross-references so
 * the spawned copy is completely self-contained.
 *
 * Entities whose `parentId` is `null` or points outside the prefab's own
 * entity set are treated as root entities and re-parented to `targetParentId`.
 *
 * @returns Remapped `SerializedEntity` array ready for `sceneStore.restoreEntity()`.
 */
export function remapPrefabEntities(
  entities:       SerializedEntity[],
  targetParentId: string | null,
): SerializedEntity[] {
  // 1. Build old-GUID → new-GUID map
  const guidMap     = new Map<string, string>()
  const internalIds = new Set<string>()
  for (const e of entities) {
    guidMap.set(e.id, generateGuid())
    internalIds.add(e.id)
  }

  // 2. Remap each entity
  return entities.map(e => ({
    ...e,
    id: guidMap.get(e.id)!,
    parentId:
      e.parentId === null || !internalIds.has(e.parentId)
        // Root entity (or parent outside the prefab) → attach to chosen parent
        ? targetParentId
        // Internal parent reference → remap to the new GUID
        : guidMap.get(e.parentId)!,
    components: e.components.map(c => {
      // Patch CameraComponent.targetEntityId when it references a prefab entity
      if (c.type === 'Camera' && typeof c.data.targetEntityId === 'string') {
        const remapped = guidMap.get(c.data.targetEntityId as string)
        if (remapped) return { ...c, data: { ...c.data, targetEntityId: remapped } }
      }
      return c
    }),
  }))
}
