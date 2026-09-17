import { defineStore }       from 'pinia'
import { ref, shallowRef }   from 'vue'
import { AssetPool }         from '@/core/assets/AssetPool'
import type {
  AssetEntry, AssetMeta, AssetType,
  ModelAssetInfo, ModelMeshNode, ExtractedMaterialRef, ExtractedTextureRef,
} from '@/types/asset'
import type { NebuFileMeta }   from '@/types/project'
import { generateGuid }      from '@/lib/guid'
import { fileSystemService } from '@/lib/fs/FileSystemService'
import { useNotificationStore } from '@/stores/notificationStore'

function detectAssetType(filename: string): AssetType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['glb', 'gltf', 'obj', 'fbx', 'babylon', 'stl', 'dae', 'obj'].includes(ext)) return 'model'
  if (['png', 'jpg', 'jpeg', 'webp', 'ktx', 'ktx2'].includes(ext))  return 'texture'
  if (['mp3', 'ogg', 'wav'].includes(ext))                           return 'audio'
  if (['ts', 'js'].includes(ext))                                    return 'script'
  return 'unknown'
}

/** The model extensions that @babylonjs/loaders can scan via AssetContainer. */
const MODEL_EXTS = new Set(['glb', 'gltf', 'obj', 'fbx', 'babylon', 'stl', 'dae'])

export const useAssetStore = defineStore('asset', () => {
  const pool      = shallowRef(new AssetPool())
  const assetList = ref<AssetEntry[]>([])

  function _syncList(): void {
    assetList.value = [...pool.value.entries]
  }

  /**
   * Import a File from the browser into the project's `assets/` folder.
   * Writes the binary and generates a `.meta` sidecar.
   * For texture assets, a 128×128 preview thumbnail is generated and embedded in the meta.
   * For model assets, the file is loaded into a temporary Babylon AssetContainer so its
   * meshes, materials and textures can be catalogued without creating scene objects.
   */
  async function importAsset(
    file:              File,
    projectDirHandle:  FileSystemDirectoryHandle,
    relativeFolder     = '',
  ): Promise<AssetEntry> {
    const type     = detectAssetType(file.name)
    const guid     = generateGuid()
    const ext      = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
    const baseName = file.name.slice(0, file.name.length - ext.length)
    const subPath  = relativeFolder ? `${relativeFolder}/${file.name}` : file.name
    const destPath = `assets/${subPath}`

    await fileSystemService.copyFileInto(projectDirHandle, destPath, file)

    // Generate 128×128 thumbnail for image assets
    let thumbnail: string | undefined
    if (type === 'texture') {
      thumbnail = await _generateTextureThumbnail(file) ?? undefined
    }

    // Scan model assets for their embedded meshes / materials / textures
    let modelInfo: import('@/types/asset').ModelAssetInfo | undefined
    if (type === 'model' && MODEL_EXTS.has(ext.replace('.', '').toLowerCase())) {
      const notify = useNotificationStore()
      notify.info(`Importing model "${file.name}"…`)
      try {
        modelInfo = await _extractModelAssets(file, projectDirHandle, subPath) ?? undefined
        notify.success(`Model "${file.name}" imported successfully`)
      } catch (err) {
        notify.error(`Model import failed: ${err instanceof Error ? err.message : String(err)}`)
        modelInfo = undefined
      }
    }

    const meta: AssetMeta = {
      guid,
      type,
      originalPath:   (file as File & { path?: string }).path ?? file.name,
      importSettings: {},
      lastModified:   Date.now(),
      thumbnail,
      modelInfo,
    }
    await fileSystemService.writeJson(projectDirHandle, `${destPath}.meta`, meta)

    const entry: AssetEntry = { meta, name: baseName, relativePath: subPath, loaded: false }
    pool.value.register(entry)
    _syncList()

    // Load extracted textures + materials into live stores for immediate use.
    if (modelInfo?.extracted) {
      await _loadExtractedModelAssets(modelInfo, projectDirHandle)
    }

    return entry
  }

  /** Sanitise a string into a safe filename component. */
  function _safeName(raw: string): string {
    return raw.replace(/[^a-zA-Z0-9_\- ]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'unnamed'
  }

  /**
   * Full model extraction — ONE-TIME operation at import.
   *
   * Loads the GLB into a Babylon AssetContainer with a real WebGL engine
   * (OffscreenCanvas) so textures are GPU-decoded.  Then walks the live
   * scene graph to:
   *   1. readPixels() each texture → PNG file on disk
   *   2. Read material properties + texture refs → .mat files
   *   3. Record mesh hierarchy (parent-child, material refs, transforms)
   *
   * For non-GLB formats, falls back to a basic name-only scan.
   */
  async function _extractModelAssets(
    file:              File,
    projectDirHandle:  FileSystemDirectoryHandle,
    modelSubPath:      string,   // e.g. "models/knight.glb" — relative within assets/
  ): Promise<ModelAssetInfo | null> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

    // Full extraction only for GLB; others get basic scan
    if (ext !== 'glb') return _scanModelFileBasic(file)

    try {
      const modelBaseName = file.name.replace(/\.[^.]+$/, '')

      // Folder paths — materials/ sits alongside the model file
      const parentFolder = modelSubPath.includes('/')
        ? modelSubPath.slice(0, modelSubPath.lastIndexOf('/'))
        : ''
      const materialsDir = parentFolder
        ? `assets/${parentFolder}/materials`
        : 'assets/materials'
      const texturesDir = `${materialsDir}/textures`

      // ────────────── 1. Load container ──────────────────────────

      const [{ Engine, Scene: BScene }, { SceneLoader }, loaders] = await Promise.all([
        import('@babylonjs/core'),
        import('@babylonjs/core/Loading/sceneLoader'),
        import('@babylonjs/loaders'),
      ])
      void loaders // side-effect: registers loaders

      // Use an OffscreenCanvas with a real WebGL context so texture decoding
      // works correctly (NullEngine has no GPU and cannot decode images).
      const offscreen = new OffscreenCanvas(512, 512)
      // Babylon's InputManager expects a DOM element with style.cursor;
      // OffscreenCanvas has no `style`, so provide a shim to prevent crashes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(offscreen as any).style = { cursor: '' }

      const ownEngine  = new Engine(offscreen as unknown as HTMLCanvasElement, false)
      const scene      = new BScene(ownEngine)

      const url = URL.createObjectURL(file)

      const extractedTextures:  ExtractedTextureRef[]  = []
      const extractedMaterials: ExtractedMaterialRef[] = []
      const materialNames: string[] = []
      const meshNames:     string[] = []
      const meshHierarchy: ModelMeshNode[] = []
      let   totalTriangles = 0

      try {
        const container = await SceneLoader.LoadAssetContainerAsync(
          url, '', scene, null, '.glb',
        )

        // ── 1a. Wait for all textures to finish loading ───────
        await Promise.all(container.textures.map(tex => {
          if (tex.isReady()) return Promise.resolve()
          return new Promise<void>(resolve => {
            tex.onLoadObservable.addOnce(() => resolve())
            setTimeout(resolve, 5000)
          })
        }))

        // ── 1b. Extract textures via readPixels ─────────────
        // Map: Babylon texture object → assigned GUID (deduplicates shared textures)
        const texToGuid = new Map<object, string>()

        if (container.textures.length > 0) {
          await fileSystemService.ensureDir(projectDirHandle, texturesDir)
        }

        for (let ti = 0; ti < container.textures.length; ti++) {
          const tex  = container.textures[ti]
          if (texToGuid.has(tex)) continue

          const size = tex.getSize()
          if (size.width <= 0 || size.height <= 0) continue

          let data: ArrayBuffer | null = null
          try {
            const pixels = await tex.readPixels()
            if (pixels && pixels.byteLength > 0) {
              let rgba: Uint8ClampedArray
              if (pixels instanceof Float32Array) {
                rgba = new Uint8ClampedArray(pixels.length)
                for (let i = 0; i < pixels.length; i++) {
                  rgba[i] = Math.round(Math.min(1, Math.max(0, pixels[i])) * 255)
                }
              } else {
                rgba = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength)
              }
              const cvs = new OffscreenCanvas(size.width, size.height)
              const ctx = cvs.getContext('2d')!
              ctx.putImageData(new ImageData(rgba, size.width, size.height), 0, 0)
              const blob = await cvs.convertToBlob({ type: 'image/png' })
              data = await blob.arrayBuffer()
            }
          } catch (e) {
            console.warn('[assetStore] readPixels failed for texture', tex.name, e)
          }

          if (!data || data.byteLength === 0) continue

          // Generate 128×128 thumbnail from the full-size PNG
          let thumbnail: string | undefined
          try {
            const thumbSize = 128
            const thumbCvs  = new OffscreenCanvas(thumbSize, thumbSize)
            const thumbCtx  = thumbCvs.getContext('2d')!
            const imgBitmap = await createImageBitmap(
              new Blob([data], { type: 'image/png' }),
            )
            thumbCtx.drawImage(imgBitmap, 0, 0, thumbSize, thumbSize)
            imgBitmap.close()
            const thumbBlob = await thumbCvs.convertToBlob({ type: 'image/png' })
            thumbnail = await new Promise<string>(res => {
              const r = new FileReader()
              r.onloadend = () => res(r.result as string)
              r.readAsDataURL(thumbBlob)
            })
          } catch { /* thumbnail generation failed — not critical */ }

          const texGuid    = generateGuid()
          const safeName   = _safeName(`${modelBaseName}_${tex.name || `tex_${ti}`}`)
          const texRelPath = `${texturesDir}/${safeName}.png`

          await fileSystemService.writeBinary(projectDirHandle, texRelPath, data)

          const texMeta: AssetMeta = {
            guid: texGuid, type: 'texture', originalPath: `${safeName}.png`,
            importSettings: {}, lastModified: Date.now(),
            thumbnail,
          }
          await fileSystemService.writeJson(projectDirHandle, `${texRelPath}.meta`, texMeta)

          const texAssetRel = texRelPath.replace(/^assets\//, '')
          pool.value.register({
            meta: texMeta, name: safeName, relativePath: texAssetRel, loaded: false,
          })
          extractedTextures.push({ name: tex.name || `tex_${ti}`, guid: texGuid, relativePath: texAssetRel })
          texToGuid.set(tex, texGuid)
        }
        if (extractedTextures.length > 0) _syncList()

        // ── 2. Materials → .mat files ─────────────────────────
        if (container.materials.length > 0) {
          await fileSystemService.ensureDir(projectDirHandle, materialsDir)
        }

        for (let mi = 0; mi < container.materials.length; mi++) {
          const bMat = container.materials[mi]
          materialNames.push(bMat.name)

          const matGuid  = generateGuid()
          const safeName = _safeName(`${modelBaseName}_${bMat.name || `material_${mi}`}`)

          const { serialized, textureSlots } = _buildMaterialJson(bMat, matGuid, safeName, texToGuid)

          const matPath = `${materialsDir}/${safeName}.mat`
          await fileSystemService.writeJson(projectDirHandle, matPath, serialized)

          const matFileMeta: NebuFileMeta = {
            guid: matGuid, kind: 'material', relPath: matPath, lastModified: Date.now(),
          }
          await fileSystemService.writeJson(projectDirHandle, `${matPath}.meta`, matFileMeta)

          extractedMaterials.push({
            name: bMat.name || `material_${mi}`,
            guid: matGuid, matType: 'PBR', textureSlots, relPath: matPath,
          })
        }

        // ── 3. Mesh hierarchy ─────────────────────────────────
        const matNameToGuid = new Map<string, string>()
        for (const em of extractedMaterials) matNameToGuid.set(em.name, em.guid)

        for (let i = 0; i < container.meshes.length; i++) {
          const m = container.meshes[i]
          if (m.name === '__root__') continue

          meshNames.push(m.name)

          let triCount = 0
          const mesh = m as import('@babylonjs/core').Mesh
          if (typeof mesh.getTotalIndices === 'function') {
            try { triCount = Math.floor(mesh.getTotalIndices() / 3) } catch { /* skip */ }
          }
          totalTriangles += triCount

          meshHierarchy.push({
            name:          m.name,
            index:         i,
            parentName:    m.parent?.name === '__root__' ? null : (m.parent?.name ?? null),
            materialName:  m.material?.name ?? null,
            triangleCount: triCount,
            position:      { x: m.position.x,  y: m.position.y,  z: m.position.z  },
            rotation:      { x: m.rotation.x,  y: m.rotation.y,  z: m.rotation.z  },
            scale:         { x: m.scaling.x,   y: m.scaling.y,   z: m.scaling.z   },
          })
        }

        container.dispose()
      } finally {
        URL.revokeObjectURL(url)
        scene.dispose()
        ownEngine.dispose()
      }

      return {
        meshNames,
        materialNames,
        textureNames:       extractedTextures.map(t => t.name),
        triangleCount:      totalTriangles,
        meshHierarchy,
        extractedMaterials,
        extractedTextures,
        extracted:          true,
      }
    } catch (err) {
      console.warn('[assetStore] model extraction failed:', err)
      return _scanModelFileBasic(file)
    }
  }

  /**
   * Build a serialised MaterialDef (PBR type) from a live Babylon material.
   * Reads colour/scalar props and resolves texture channels directly from
   * the material's texture references using the texToGuid identity map.
   */
  function _buildMaterialJson(
    bMat:      import('@babylonjs/core').Material,
    guid:      string,
    name:      string,
    texToGuid: Map<object, string>,
  ): { serialized: Record<string, unknown>; textureSlots: Record<string, string> } {
    const textureSlots: Record<string, string> = {}

    // Default PBR property bag
    const pbrProps: Record<string, unknown> = {
      albedoColor:           { r: 1,   g: 1,   b: 1 },
      reflectivityColor:     { r: 1,   g: 1,   b: 1 },
      emissiveColor:         { r: 0,   g: 0,   b: 0 },
      metallic:              0.0,
      roughness:             0.5,
      alpha:                 1.0,
      wireframe:             false,
      backFaceCulling:       true,
      albedoTextureId:       null as string | null,
      bumpTextureId:         null as string | null,
      metallicTextureId:     null as string | null,
      emissiveTextureId:     null as string | null,
      ambientTextureId:      null as string | null,
      opacityTextureId:      null as string | null,
      reflectionTextureId:   null as string | null,
      lightmapTextureId:     null as string | null,
      reflectivityTextureId: null as string | null,
      microSurfaceTextureId: null as string | null,
    }

    const className = bMat.getClassName()

    // PBR texture channels: [Babylon property, nebu pbrProps key, slot label]
    const PBR_CHANNELS: [string, string, string][] = [
      ['albedoTexture',       'albedoTextureId',       'albedo'],
      ['bumpTexture',         'bumpTextureId',         'normal'],
      ['metallicTexture',     'metallicTextureId',     'metallicRoughness'],
      ['emissiveTexture',     'emissiveTextureId',     'emissive'],
      ['ambientTexture',      'ambientTextureId',      'occlusion'],
      ['opacityTexture',      'opacityTextureId',      'opacity'],
      ['reflectionTexture',   'reflectionTextureId',   'reflection'],
      ['lightmapTexture',     'lightmapTextureId',     'lightmap'],
      ['reflectivityTexture', 'reflectivityTextureId', 'reflectivity'],
      ['microSurfaceTexture', 'microSurfaceTextureId', 'microSurface'],
    ]

    if (className === 'PBRMaterial') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pbr = bMat as any
      if (pbr.albedoColor) {
        pbrProps.albedoColor = { r: pbr.albedoColor.r, g: pbr.albedoColor.g, b: pbr.albedoColor.b }
      }
      if (pbr.reflectivityColor) {
        pbrProps.reflectivityColor = { r: pbr.reflectivityColor.r, g: pbr.reflectivityColor.g, b: pbr.reflectivityColor.b }
      }
      if (pbr.emissiveColor) {
        pbrProps.emissiveColor = { r: pbr.emissiveColor.r, g: pbr.emissiveColor.g, b: pbr.emissiveColor.b }
      }
      pbrProps.metallic        = pbr.metallic  ?? 0.0
      pbrProps.roughness       = pbr.roughness ?? 0.5
      pbrProps.alpha           = pbr.alpha ?? 1.0
      pbrProps.backFaceCulling = pbr.backFaceCulling ?? true

      // Resolve texture channels directly from the live material
      for (const [bjsProp, nebuProp, slotLabel] of PBR_CHANNELS) {
        const tex = pbr[bjsProp]
        if (tex && texToGuid.has(tex)) {
          const texGuid = texToGuid.get(tex)!
          pbrProps[nebuProp]       = texGuid
          textureSlots[slotLabel]  = texGuid
        }
      }
    } else if (className === 'StandardMaterial') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const std = bMat as any
      if (std.diffuseColor) {
        pbrProps.albedoColor = { r: std.diffuseColor.r, g: std.diffuseColor.g, b: std.diffuseColor.b }
      }
      if (std.emissiveColor) {
        pbrProps.emissiveColor = { r: std.emissiveColor.r, g: std.emissiveColor.g, b: std.emissiveColor.b }
      }
      pbrProps.alpha           = std.alpha ?? 1.0
      pbrProps.backFaceCulling = std.backFaceCulling ?? true
      // Map Standard texture channels → PBR equivalents
      if (std.diffuseTexture && texToGuid.has(std.diffuseTexture)) {
        const g = texToGuid.get(std.diffuseTexture)!
        pbrProps.albedoTextureId = g; textureSlots.albedo = g
      }
      if (std.bumpTexture && texToGuid.has(std.bumpTexture)) {
        const g = texToGuid.get(std.bumpTexture)!
        pbrProps.bumpTextureId = g; textureSlots.normal = g
      }
      if (std.emissiveTexture && texToGuid.has(std.emissiveTexture)) {
        const g = texToGuid.get(std.emissiveTexture)!
        pbrProps.emissiveTextureId = g; textureSlots.emissive = g
      }
      if (std.ambientTexture && texToGuid.has(std.ambientTexture)) {
        const g = texToGuid.get(std.ambientTexture)!
        pbrProps.ambientTextureId = g; textureSlots.occlusion = g
      }
    }

    // Default Standard props (unused placeholder for serialisation shape)
    const defaultStdProps = {
      diffuseColor: { r: 0.8, g: 0.8, b: 0.8 }, specularColor: { r: 1, g: 1, b: 1 },
      emissiveColor: { r: 0, g: 0, b: 0 }, ambientColor: { r: 0, g: 0, b: 0 },
      specularPower: 64, alpha: 1, wireframe: false, backFaceCulling: true,
      diffuseTextureId: null, ambientTextureId: null, opacityTextureId: null,
      emissiveTextureId: null, specularTextureId: null, bumpTextureId: null,
      reflectionTextureId: null, lightmapTextureId: null,
    }

    const serialized = {
      id:             guid,
      name,
      matType:        'PBR',
      isDefault:      false,
      standardProps:  defaultStdProps,
      pbrProps,
      shaderProps:    { vertexSource: '', fragmentSource: '' },
      customProps:    { ...defaultStdProps, customVertex: '', customFragment: '' },
      pbrCustomProps: { ...pbrProps, customVertex: '', customFragment: '' },
    }

    return { serialized, textureSlots }
  }

  /**
   * Load extracted textures + materials into their live stores so they're
   * immediately available in the editor (no reload needed).  No-ops for any
   * store whose Babylon scene hasn't been set yet — the project-load pipeline
   * will pick them up later.
   */
  async function _loadExtractedModelAssets(
    info:             ModelAssetInfo,
    projectDirHandle: FileSystemDirectoryHandle,
  ): Promise<void> {
    // Textures
    if (info.extractedTextures?.length) {
      const { useTextureStore }   = await import('@/stores/textureStore')
      const texStore = useTextureStore()
      for (const tex of info.extractedTextures) {
        if (!texStore.hasTexture(tex.guid)) {
          try {
            const f = await fileSystemService.readAsFile(projectDirHandle, `assets/${tex.relativePath}`)
            await texStore.loadFromFile(tex.guid, f)
          } catch (e) {
            console.warn('[assetStore] texture load failed for', tex.guid, tex.relativePath, e)
          }
        }
      }
    }

    // Materials
    if (info.extractedMaterials?.length) {
      const { useMaterialStore }  = await import('@/stores/materialStore')
      const { MaterialDef }       = await import('@/core/materials/MaterialDef')
      const matStore = useMaterialStore()
      for (const matRef of info.extractedMaterials) {
        if (!matStore.getMaterial(matRef.guid)) {
          try {
            const data = await fileSystemService.readJson<import('@/types/material').SerializedMaterial>(
              projectDirHandle, matRef.relPath,
            )
            const def = MaterialDef.deserialize(data)
            matStore.loadDef(def)
          } catch {
            // Material file may be corrupt or missing — skip silently
          }
        }
      }
    }
  }

  /**
   * Basic name-only scan — fallback for non-GLB formats.
   * Uses a NullEngine to load the container and extract names only.
   */
  async function _scanModelFileBasic(file: File): Promise<ModelAssetInfo | null> {
    try {
      // Dynamically import the loaders so the main Babylon bundle is not bloated
      // when no model import happens.
      const [{ NullEngine, Scene: BScene }, { SceneLoader }, loaders] = await Promise.all([
        import('@babylonjs/core'),
        import('@babylonjs/core/Loading/sceneLoader'),
        import('@babylonjs/loaders'),
      ])
      void loaders  // side-effect: registers all loaders

      const engine = new NullEngine()
      const scene  = new BScene(engine)

      const url       = URL.createObjectURL(file)
      const fileExt   = '.' + (file.name.split('.').pop()?.toLowerCase() ?? 'glb')

      let meshNames:     string[] = []
      let materialNames: string[] = []
      let textureNames:  string[] = []
      let triangleCount = 0

      try {
        const container = await SceneLoader.LoadAssetContainerAsync(
          url,
          '',
          scene,
          null,
          fileExt,
        )

        meshNames = container.meshes
          .filter(m => m.name !== '__root__')
          .map(m => m.name)

        materialNames = container.materials.map(m => m.name)

        textureNames = container.textures
          .filter(t => t.name && !t.name.startsWith('data:'))
          .map(t => t.name)

        for (const m of container.meshes) {
          const mesh = m as import('@babylonjs/core').Mesh
          if (typeof mesh.getTotalIndices === 'function') {
            try { triangleCount += Math.floor(mesh.getTotalIndices() / 3) } catch { /* skip */ }
          }
        }

        container.dispose()
      } finally {
        URL.revokeObjectURL(url)
        scene.dispose()
        engine.dispose()
      }

      return { meshNames, materialNames, textureNames, triangleCount }
    } catch (err) {
      console.warn('[assetStore] model scan failed:', err)
      return null
    }
  }

  /** Render the image file into a 128×128 canvas and return a PNG data-URL. */
  async function _generateTextureThumbnail(file: File): Promise<string | null> {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        try {
          const canvas = document.createElement('canvas')
          canvas.width  = 128
          canvas.height = 128
          const ctx = canvas.getContext('2d')
          if (!ctx) { resolve(null); return }
          ctx.drawImage(img, 0, 0, 128, 128)
          resolve(canvas.toDataURL('image/png'))
        } catch { resolve(null) }
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
      img.src = url
    })
  }

  /**
   * Scan a project's `assets/` folder recursively for `.meta` sidecars
   * and re-populate the pool without re-loading binary data.
   */
  async function loadMetaFromFolder(projectDirHandle: FileSystemDirectoryHandle): Promise<void> {
    pool.value.clear()
    try {
      await _scanForMeta(projectDirHandle, 'assets')
    } catch {
      // assets/ folder may not exist yet in brand-new projects
    }
    _syncList()
  }

  async function _scanForMeta(
    root:       FileSystemDirectoryHandle,
    dirRelPath: string,   // e.g. 'assets' or 'assets/models'
  ): Promise<void> {
    const handles = await fileSystemService.listDir(root, dirRelPath)
    for (const handle of handles) {
      const childPath = `${dirRelPath}/${handle.name}`
      if (handle.kind === 'directory') {
        await _scanForMeta(root, childPath)
      } else if (handle.kind === 'file' && handle.name.endsWith('.meta')) {
        try {
          const meta        = await fileSystemService.readJson<AssetMeta>(root, childPath)
          const assetFile   = handle.name.slice(0, -5)  // strip .meta
          const dotIdx      = assetFile.lastIndexOf('.')
          const baseName    = dotIdx >= 0 ? assetFile.slice(0, dotIdx) : assetFile
          // relativePath is within assets/, e.g. "models/knight.glb"
          const assetRel    = childPath.replace(/^assets\//, '').slice(0, -5)
          const entry: AssetEntry = {
            meta, name: baseName, relativePath: assetRel, loaded: false,
          }
          pool.value.register(entry)
        } catch { /* skip malformed .meta */ }
      }
    }
  }

  function removeAsset(guid: string): void {
    pool.value.remove(guid)
    _syncList()
  }

  function getAsset(guid: string): AssetEntry | undefined {
    return pool.value.get(guid)
  }

  return { pool, assetList, importAsset, loadMetaFromFolder, removeAsset, getAsset }
})
