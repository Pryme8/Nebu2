// ─────────────────────────────────────────────
// Asset Types
// ─────────────────────────────────────────────

export type AssetType = 'model' | 'mesh' | 'texture' | 'audio' | 'material' | 'script' | 'unknown'

export interface MeshImportSettings {
  scale:  number
  flipYZ: boolean
}

export interface TextureImportSettings {
  channels:        1 | 3 | 4
  generateMipmaps: boolean
  srgb:            boolean
}

/**
 * Import-time settings for a 3-D model asset (.glb / .gltf / etc.).
 */
export interface ModelImportSettings {
  scale:  number
  /** Swap Y/Z axes — useful for assets authored in Z-up coordinate systems. */
  flipYZ: boolean
}

/** One mesh node in the model's hierarchy manifest. */
export interface ModelMeshNode {
  /** Mesh name from the model file. */
  name:          string
  /** Index in the container's meshes array. */
  index:         number
  /** Parent mesh name — null for root-level meshes. */
  parentName:    string | null
  /** Material name from the source file — maps to ExtractedMaterialRef.name. */
  materialName:  string | null
  /** Per-mesh triangle count. */
  triangleCount: number
  /** Local position extracted from the model. */
  position?:     { x: number; y: number; z: number }
  /** Local rotation (euler) extracted from the model. */
  rotation?:     { x: number; y: number; z: number }
  /** Local scale extracted from the model. */
  scale?:        { x: number; y: number; z: number }
}

/** A material extracted from a model and saved as a .mat project asset. */
export interface ExtractedMaterialRef {
  /** Original material name from the model file. */
  name:          string
  /** GUID of the created .mat asset file. */
  guid:          string
  /** Material type used in the MaterialDef. */
  matType:       string
  /** Map of texture channel key → texture asset GUID. */
  textureSlots:  Record<string, string>
  /** Path of the .mat file relative to the project root. */
  relPath:       string
}

/** A texture extracted from a model and saved as an image file. */
export interface ExtractedTextureRef {
  /** Image name from the model file. */
  name:          string
  /** GUID of the created texture asset. */
  guid:          string
  /** Path within the project `assets/` folder, e.g. `models/materials/textures/diffuse.png`. */
  relativePath:  string
}

/**
 * Information extracted from a model file during import.
 * Captures the names of every mesh, material and embedded texture found in
 * the container so the editor can display them and cross-reference assets
 * without needing the Babylon scene to be active.
 */
export interface ModelAssetInfo {
  /** Names of every root mesh found in the container (excluding the __root__ helper). */
  meshNames:     string[]
  /** Names of every material defined in the file. */
  materialNames: string[]
  /** Names of every texture defined in the file. */
  textureNames:  string[]
  /** Total triangle count across all meshes, 0 if unavailable. */
  triangleCount: number

  // ── Extended manifest (populated by full extraction) ──────────
  /** Full mesh hierarchy — used to create the entity tree on drop. */
  meshHierarchy?:       ModelMeshNode[]
  /** Materials extracted and saved as .mat files. */
  extractedMaterials?:  ExtractedMaterialRef[]
  /** Textures extracted and saved as image files. */
  extractedTextures?:   ExtractedTextureRef[]
  /** True once full one-time extraction has been performed. */
  extracted?:           boolean
}

export type ImportSettings = Partial<MeshImportSettings & TextureImportSettings & ModelImportSettings>

/**
 * Sidecar metadata stored as `<filename>.meta` alongside every imported asset.
 * Contains the stable GUID, type, original import path, and per-type settings.
 */
export interface AssetMeta {
  guid:           string
  type:           AssetType
  /** Absolute path on the user's filesystem at the time of import — informational only. */
  originalPath:   string
  importSettings: ImportSettings
  lastModified:   number        // unix ms
  /** 128×128 base-64 PNG data-URL preview — generated on import for texture assets. */
  thumbnail?:     string
  /** Populated on model import — describes the meshes / materials / textures inside the file. */
  modelInfo?:     ModelAssetInfo
}

/** In-memory registry entry combining meta with runtime state. */
export interface AssetEntry {
  meta:         AssetMeta
  /** Display name — filename without extension. */
  name:         string
  /** Path within the project `assets/` folder, e.g. `models/knight.glb`. */
  relativePath: string
  loaded:       boolean
  /** Holds the live Babylon.js mesh/texture/etc. reference once loaded. */
  babylonRef?:  unknown
}
