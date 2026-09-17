// ─────────────────────────────────────────────
// Material Store
//
// Manages MaterialDef instances and their live Babylon.js material objects.
// Seeded with a "Default" StandardMaterial that mirrors the Babylon scene
// default.  All other materials are user-created.
// ─────────────────────────────────────────────

import { defineStore }    from 'pinia'
import { shallowRef, markRaw } from 'vue'
import {
  StandardMaterial, PBRMaterial, ShaderMaterial, Color3,
  type Scene as BabylonScene,
} from '@babylonjs/core'
import { CustomMaterial }    from '@babylonjs/materials/custom/customMaterial'
import { PBRCustomMaterial } from '@babylonjs/materials/custom/pbrCustomMaterial'
import { MaterialDef }       from '@/core/materials/MaterialDef'
import { useTextureStore }   from './textureStore'
import type { MaterialType, SerializedMaterial } from '@/types/material'
import { generateGuid }      from '@/lib/guid'

/** Stable ID that always refers to the scene's default StandardMaterial. */
export const DEFAULT_MATERIAL_ID = '__default__'

export const useMaterialStore = defineStore('material', () => {
  const materialList   = shallowRef<MaterialDef[]>([])  // shallowRef: elements are class instances, not deep-proxied
  const _scene         = shallowRef<BabylonScene | null>(null)

  // ── Babylon scene wiring ─────────────────────────────────────

  /**
   * Called (by sceneStore or BabylonViewport) when the Babylon scene
   * changes.  Disposes all existing Babylon material instances and recreates
   * them against the new scene.
   */
  function setBabylonScene(scene: BabylonScene | null): void {
    // Dispose all existing Babylon material instances first.
    for (const def of materialList.value) {
      if (!def.isDefault) def.babylonMaterial?.dispose()
      def.babylonMaterial = null
      def.onRebuildNeeded = null
    }
    _scene.value = scene
    if (!scene) return

    // Ensure the default material entry exists.
    if (!materialList.value.find(m => m.id === DEFAULT_MATERIAL_ID)) {
      _seedDefault(scene)
    }

    // Recreate Babylon instances for all existing defs.
    for (const def of materialList.value) {
      _rebuildBabylonMaterial(def, scene)
    }
  }

  /** Auto-seed a "Default" entry referencing the scene's built-in material. */
  function _seedDefault(scene: BabylonScene): void {
    const def         = new MaterialDef(DEFAULT_MATERIAL_ID, 'Default', 'Standard')
    def.isDefault     = true
    // Sync props from the actual Babylon default material so the inspector
    // reflects the scene's current default values.
    const bMat = scene.defaultMaterial as StandardMaterial
    def.standardProps.diffuseColor  = { r: bMat.diffuseColor.r,  g: bMat.diffuseColor.g,  b: bMat.diffuseColor.b  }
    def.standardProps.specularColor = { r: bMat.specularColor.r, g: bMat.specularColor.g, b: bMat.specularColor.b }
    def.babylonMaterial              = markRaw(bMat)
    def.onRebuildNeeded              = () => { /* default material cannot be re-typed */ }
    materialList.value = [def, ...materialList.value.filter(m => m.id !== DEFAULT_MATERIAL_ID)]
  }

  // ── CRUD ────────────────────────────────────────────────────────

  /**
   * Create a new named material of the given type.
   * Returns the new MaterialDef (which has `babylonMaterial` set if the
   * Babylon scene is available).
   */
  function createMaterial(name = 'New Material', type: MaterialType = 'Standard'): MaterialDef {
    const def = new MaterialDef(generateGuid(), name, type)
    materialList.value = [...materialList.value, def]
    const scene = _scene.value
    if (scene) _rebuildBabylonMaterial(def, scene)
    return def
  }

  /**
   * Remove a user-created material by its ID.
   * The default material cannot be removed.
   */
  function removeMaterial(id: string): void {
    const def = materialList.value.find(m => m.id === id)
    if (!def || def.isDefault) return
    def.babylonMaterial?.dispose()
    def.babylonMaterial = null
    def.onRebuildNeeded = null
    materialList.value = materialList.value.filter(m => m.id !== id)
  }

  /** Retrieve a MaterialDef by ID. */
  function getMaterial(id: string): MaterialDef | undefined {
    return materialList.value.find(m => m.id === id)
  }

  /**
   * Load a pre-deserialized MaterialDef (e.g. from a .mat asset file) into
   * the store.  No-ops if a material with the same ID is already present.
   */
  function loadDef(def: MaterialDef): void {
    if (materialList.value.find(m => m.id === def.id)) return
    materialList.value = [...materialList.value, def]
    const scene = _scene.value
    if (scene) _rebuildBabylonMaterial(def, scene)
  }

  /**
   * Retrieve the live Babylon material for a given material ID.
   * Returns null when the material doesn't exist or the scene isn't ready.
   */
  function getBabylonMaterial(id: string): import('@babylonjs/core').Material | null {
    const def = materialList.value.find(m => m.id === id)
    if (!def) return null
    if (def.babylonMaterial) return def.babylonMaterial
    const scene = _scene.value
    if (!scene) return null
    _rebuildBabylonMaterial(def, scene)
    return def.babylonMaterial
  }

  // ── Babylon material lifecycle ───────────────────────────────────

  /**
   * Dispose any existing Babylon material for `def`, create a new one of
   * the appropriate type, push all current properties to it, and install
   * the `onRebuildNeeded` callback.
   */
  function _rebuildBabylonMaterial(def: MaterialDef, scene: BabylonScene): void {
    if (def.isDefault) return  // default material is owned by the Babylon scene

    def.babylonMaterial?.dispose()
    def.babylonMaterial = null

    const id = def.id

    switch (def.matType) {
      case 'Standard': {
        const m = new StandardMaterial(id, scene)
        const p = def.standardProps
        m.diffuseColor  = new Color3(p.diffuseColor.r,  p.diffuseColor.g,  p.diffuseColor.b)
        m.specularColor = new Color3(p.specularColor.r, p.specularColor.g, p.specularColor.b)
        m.emissiveColor = new Color3(p.emissiveColor.r, p.emissiveColor.g, p.emissiveColor.b)
        m.ambientColor  = new Color3(p.ambientColor.r,  p.ambientColor.g,  p.ambientColor.b)
        m.specularPower   = p.specularPower
        m.alpha           = p.alpha
        m.wireframe       = p.wireframe
        m.backFaceCulling = p.backFaceCulling
        // Apply texture channels
        const tStore = useTextureStore()
        m.diffuseTexture    = p.diffuseTextureId    ? tStore.getTexture(p.diffuseTextureId)    : null
        m.ambientTexture    = p.ambientTextureId    ? tStore.getTexture(p.ambientTextureId)    : null
        m.opacityTexture    = p.opacityTextureId    ? tStore.getTexture(p.opacityTextureId)    : null
        m.emissiveTexture   = p.emissiveTextureId   ? tStore.getTexture(p.emissiveTextureId)   : null
        m.specularTexture   = p.specularTextureId   ? tStore.getTexture(p.specularTextureId)   : null
        m.bumpTexture       = p.bumpTextureId       ? tStore.getTexture(p.bumpTextureId)       : null
        m.reflectionTexture = p.reflectionTextureId ? tStore.getTexture(p.reflectionTextureId) : null
        m.lightmapTexture   = p.lightmapTextureId   ? tStore.getTexture(p.lightmapTextureId)   : null
        def.babylonMaterial = markRaw(m)
        break
      }

      case 'PBR': {
        const m = new PBRMaterial(id, scene)
        const p = def.pbrProps
        m.albedoColor       = new Color3(p.albedoColor.r,       p.albedoColor.g,       p.albedoColor.b)
        m.reflectivityColor = new Color3(p.reflectivityColor.r, p.reflectivityColor.g, p.reflectivityColor.b)
        m.emissiveColor     = new Color3(p.emissiveColor.r,     p.emissiveColor.g,     p.emissiveColor.b)
        m.metallic          = p.metallic
        m.roughness         = p.roughness
        m.alpha             = p.alpha
        m.wireframe         = p.wireframe
        m.backFaceCulling   = p.backFaceCulling
        // Apply texture channels
        const tStore = useTextureStore()
        m.albedoTexture       = p.albedoTextureId       ? tStore.getTexture(p.albedoTextureId)       : null
        m.bumpTexture         = p.bumpTextureId         ? tStore.getTexture(p.bumpTextureId)         : null
        m.metallicTexture     = p.metallicTextureId     ? tStore.getTexture(p.metallicTextureId)     : null
        m.emissiveTexture     = p.emissiveTextureId     ? tStore.getTexture(p.emissiveTextureId)     : null
        m.ambientTexture      = p.ambientTextureId      ? tStore.getTexture(p.ambientTextureId)      : null
        m.opacityTexture      = p.opacityTextureId      ? tStore.getTexture(p.opacityTextureId)      : null
        m.reflectionTexture   = p.reflectionTextureId   ? tStore.getTexture(p.reflectionTextureId)   : null
        m.lightmapTexture     = p.lightmapTextureId     ? tStore.getTexture(p.lightmapTextureId)     : null
        m.reflectivityTexture = p.reflectivityTextureId ? tStore.getTexture(p.reflectivityTextureId) : null
        m.microSurfaceTexture = p.microSurfaceTextureId ? tStore.getTexture(p.microSurfaceTextureId) : null
        def.babylonMaterial = markRaw(m)
        break
      }

      case 'Shader': {
        const p = def.shaderProps
        if (!p.vertexSource || !p.fragmentSource) {
          // No source yet — use a placeholder StandardMaterial so the mesh is visible.
          def.babylonMaterial = markRaw(new StandardMaterial(id + '_placeholder', scene))
        } else {
          const m = new ShaderMaterial(id, scene, {
            vertexSource:   p.vertexSource,
            fragmentSource: p.fragmentSource,
          }, { attributes: ['position', 'normal', 'uv'], uniforms: ['world', 'worldViewProjection'] })
          def.babylonMaterial = markRaw(m)
        }
        break
      }

      case 'Custom': {
        const m = new CustomMaterial(id, scene)
        const p = def.customProps
        m.diffuseColor  = new Color3(p.diffuseColor.r,  p.diffuseColor.g,  p.diffuseColor.b)
        m.specularColor = new Color3(p.specularColor.r, p.specularColor.g, p.specularColor.b)
        m.emissiveColor = new Color3(p.emissiveColor.r, p.emissiveColor.g, p.emissiveColor.b)
        m.ambientColor  = new Color3(p.ambientColor.r,  p.ambientColor.g,  p.ambientColor.b)
        m.specularPower   = p.specularPower
        m.alpha           = p.alpha
        m.wireframe       = p.wireframe
        m.backFaceCulling = p.backFaceCulling
        if (p.customVertex)   m.Vertex_Definitions(p.customVertex)
        if (p.customFragment) m.Fragment_Definitions(p.customFragment)
        def.babylonMaterial = markRaw(m) as unknown as import('@babylonjs/core').Material
        break
      }

      case 'PBRCustom': {
        const m = new PBRCustomMaterial(id, scene)
        const p = def.pbrCustomProps
        m.albedoColor       = new Color3(p.albedoColor.r,       p.albedoColor.g,       p.albedoColor.b)
        m.reflectivityColor = new Color3(p.reflectivityColor.r, p.reflectivityColor.g, p.reflectivityColor.b)
        m.emissiveColor     = new Color3(p.emissiveColor.r,     p.emissiveColor.g,     p.emissiveColor.b)
        m.metallic          = p.metallic
        m.roughness         = p.roughness
        m.alpha             = p.alpha
        m.wireframe         = p.wireframe
        m.backFaceCulling   = p.backFaceCulling
        if (p.customVertex)   m.Vertex_Definitions(p.customVertex)
        if (p.customFragment) m.Fragment_Definitions(p.customFragment)
        def.babylonMaterial = markRaw(m) as unknown as import('@babylonjs/core').Material
        break
      }
    }

    // Install callbacks so syncToBabylon() can resolve textures and trigger rebuilds.
    def.onRebuildNeeded = () => _rebuildBabylonMaterial(def, scene)
    def.onGetTexture    = (guid: string) => useTextureStore().getTexture(guid)
  }

  // ── Serialisation ────────────────────────────────────────────────

  function serialize(): SerializedMaterial[] {
    return materialList.value
      .filter(m => !m.isDefault)   // default is always recreated from Babylon
      .map(m => m.serialize())
  }

  function deserialize(list: SerializedMaterial[]): void {
    materialList.value = materialList.value.filter(m => m.isDefault)
    const scene = _scene.value
    for (const data of list) {
      const def = MaterialDef.deserialize(data)
      materialList.value = [...materialList.value, def]
      if (scene) _rebuildBabylonMaterial(def, scene)
    }
  }

  return {
    materialList,
    setBabylonScene,
    createMaterial,
    removeMaterial,
    getMaterial,
    loadDef,
    getBabylonMaterial,
    serialize,
    deserialize,
  }
})
