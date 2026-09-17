// ─────────────────────────────────────────────────────────────────────────────
// ModelManager — manages loaded Babylon.js AssetContainers for model assets.
//
// Responsibility:
//   • Load a model file (from the project's assets/ folder) into an
//     AssetContainer the first time it is needed — then cache it.
//   • Provide a "base" mesh (the merged/root mesh of the container) that can
//     be cloned for regular instances or used as the source for thin-instances.
//   • Dispose the container and all derived meshes when the scene changes or
//     when the last consumer releases the model.
//
// Instance modes (maps to MeshComponent.instanceMode):
//   'base'         — the container's meshes are added directly to the scene.
//                    Each entity using the same model gets its OWN full mesh
//                    hierarchy (independent transforms, materials).
//   'instance'     — a Babylon InstancedMesh spawned from the base mesh.
//                    Shares geometry + material; has its own transform.
//   'thinInstance' — a thin-instance entry written into the base mesh's
//                    thinInstanceBuffer.  Fastest; matrix-only, no per-mesh
//                    properties.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SceneLoader,
  type Scene as BabylonScene,
  type AssetContainer,
  type AbstractMesh,
} from '@babylonjs/core'
import '@babylonjs/loaders'

export interface ModelEntry {
  /** The loaded AssetContainer — holds all original meshes, materials, skeletons, etc. */
  container:   AssetContainer
  /** The primary renderable mesh that serves as the instancing source.
   *  For multi-mesh models this is the first non-root mesh with geometry. */
  baseMesh:    AbstractMesh
  /** How many scene objects are currently referencing this model. */
  refCount:    number
}

/**
 * ModelManager — singleton-per-scene service.
 * Owned by sceneStore; replaced every time the Babylon scene changes.
 */
export class ModelManager {
  private readonly _scene:   BabylonScene
  /** Map from asset GUID to the loaded container + usage metadata. */
  private readonly _entries = new Map<string, ModelEntry>()
  /** Pending loads: map from GUID to the in-flight Promise so two callers
   *  requesting the same GUID simultaneously share a single load operation. */
  private readonly _pending = new Map<string, Promise<ModelEntry>>()

  constructor(scene: BabylonScene) {
    this._scene = scene
  }

  // ── Load / acquire ────────────────────────────────────────────────────────

  /**
   * Load (or return the cached) AssetContainer for `guid`.
   * `blobUrl` must be a `URL.createObjectURL(file)` URL that is valid for the
   * duration of this call — the ModelManager keeps the container alive so the
   * URL is only needed until loading completes.
   *
   * `fileExtension` must include the leading dot, e.g. `'.glb'`.
   */
  async acquire(
    guid:          string,
    blobUrl:       string,
    fileExtension: string,
  ): Promise<ModelEntry> {
    const cached = this._entries.get(guid)
    if (cached) {
      cached.refCount++
      return cached
    }

    // Coalesce concurrent requests for the same GUID.
    const existing = this._pending.get(guid)
    if (existing) return existing

    const load = this._load(guid, blobUrl, fileExtension)
    this._pending.set(guid, load)
    try {
      const entry = await load
      this._entries.set(guid, entry)
      return entry
    } finally {
      this._pending.delete(guid)
    }
  }

  private async _load(
    guid:          string,
    blobUrl:       string,
    fileExtension: string,
  ): Promise<ModelEntry> {
    const container = await SceneLoader.LoadAssetContainerAsync(
      blobUrl,
      '',
      this._scene,
      null,
      fileExtension,
    )

    // Identify the primary mesh — skip the __root__ helper Babylon adds for
    // glTF files and prefer the first mesh that actually has geometry.
    const primaryMesh: AbstractMesh =
      container.meshes.find(m => m.name !== '__root__' && m.getTotalVertices() > 0)
      ?? container.meshes.find(m => m.name !== '__root__')
      ?? container.meshes[0]

    if (!primaryMesh) {
      container.dispose()
      throw new Error(`[ModelManager] No usable mesh found in container for guid=${guid}`)
    }

    const entry: ModelEntry = { container, baseMesh: primaryMesh, refCount: 1 }
    return entry
  }

  // ── Release ───────────────────────────────────────────────────────────────

  /**
   * Decrement the ref-count for `guid`.
   * When it reaches 0 the container is NOT automatically disposed — the
   * container stays cached for fast re-acquisition.  Call `disposeAll()` when
   * you want to fully unload everything (e.g. scene change).
   */
  release(guid: string): void {
    const entry = this._entries.get(guid)
    if (!entry) return
    entry.refCount = Math.max(0, entry.refCount - 1)
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  getEntry(guid: string): ModelEntry | undefined {
    return this._entries.get(guid)
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  /** Dispose a single container and remove it from the cache. */
  disposeEntry(guid: string): void {
    const entry = this._entries.get(guid)
    if (!entry) return
    try { entry.container.dispose() } catch { /* ignore */ }
    this._entries.delete(guid)
  }

  /** Dispose ALL cached containers.  Call this when the Babylon scene changes. */
  disposeAll(): void {
    for (const [guid] of this._entries) {
      this.disposeEntry(guid)
    }
    this._entries.clear()
    this._pending.clear()
  }
}
