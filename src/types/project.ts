// ─────────────────────────────────────────────
// Project Types
// ─────────────────────────────────────────────

/** Babylon.js engine back-ends the project may target. */
export type EngineTarget = 'webgl1' | 'webgl2' | 'webgpu'

/** All viable engine targets in priority order (best → fallback). */
export const ENGINE_PRIORITY: EngineTarget[] = ['webgpu', 'webgl2', 'webgl1']

/** Stored as JSON in the root `.nebu` marker file of a project folder. */
export interface NebuProjectMeta {
  version:       string         // '1.0.0'
  name:          string
  description:   string
  author:        string
  created:       number         // unix ms
  lastModified:  number         // unix ms
  lastSceneId:   string | null  // GUID of the scene to re-open on load
  /** Which engine back-ends this project explicitly allows. All enabled = no restriction. */
  engineTargets: EngineTarget[]
  /**
   * IDs of plugins that are active for this project.
   * Persisted in the .nebu manifest so the same plugins are reactivated on
   * every project open.  Built-in plugins are listed here by their `id`
   * string exactly as declared in their NebuPlugin descriptor.
   */
  activePlugins: string[]
}

/**
 * Nebu-file kinds that the file browser knows about.
 * 'texture' is a sub-kind of imported assets for image files.
 * 'asset' covers other imported binary assets (meshes, audio…).
 * 'prefab' is a serialized entity subtree (or whole scene) for re-instantiation.
 */
export type NebuFileKind = 'scene' | 'asset' | 'model' | 'texture' | 'material' | 'folder' | 'script' | 'prefab' | 'unknown'

/**
 * Sidecar `.meta` file stored alongside every tracked nebu file.
 *
 * `<filename>.scene.meta`  — next to the `.scene` file
 * `<filename>.glb.meta`    — already handled by AssetMeta for assets
 *
 * For scenes and other non-asset nebu files we use this unified structure.
 * `relPath` is the path of the actual data file relative to the project root
 * (e.g. `scenes/Main Scene.scene`).  If the file is not found at that location
 * the browser shows a "Missing" badge.
 *
 * `thumbnail` is an optional data-URL (base64 PNG) used as the item preview —
 * e.g. the last viewport capture for a scene.
 */
export interface NebuFileMeta {
  guid:         string
  kind:         NebuFileKind
  /** Path relative to the project root where the actual data file lives. */
  relPath:      string
  lastModified: number        // unix ms
  /** Optional base-64 data-URL preview image (e.g. scene viewport capture). */
  thumbnail?:   string
}
