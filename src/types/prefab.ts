// ─────────────────────────────────────────────
// Prefab Types
// ─────────────────────────────────────────────

import type { SerializedEntity } from '@/core/ecs/World'

/**
 * Serialized form of a `.prefab` file.
 *
 * A prefab captures an entity subtree (or an entire scene's entities) so it can
 * be re-instantiated with fresh GUIDs at any time — in scripts, via the file
 * browser, or by dragging into the hierarchy.
 *
 * On-disk layout:
 *   prefabs/<name>.prefab        ← this data (JSON)
 *   prefabs/<name>.prefab.meta   ← NebuFileMeta sidecar (kind: 'prefab', guid, relPath…)
 *
 * The `.prefab.meta` guid is the stable identity for asset-reference purposes
 * (e.g. `instantiatePrefab(guid)` in scripts).
 */
export interface SerializedPrefab {
  version:      '1.0.0'
  /** Stable identity — same across re-saves of the same prefab file. */
  guid:         string
  /** Display name (mirrors the filename without the `.prefab` extension). */
  name:         string
  created:      number   // unix ms
  lastModified: number   // unix ms
  /**
   * Serialized entity subtree — root entity first then all descendants in BFS
   * order.  On instantiation every entity receives a new GUID; `parentId`
   * references within the list are remapped to the new GUIDs accordingly.
   */
  entities:     SerializedEntity[]
}
