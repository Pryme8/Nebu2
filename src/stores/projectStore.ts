import { defineStore }              from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type { NebuProjectMeta, NebuFileMeta, NebuFileKind, EngineTarget } from '@/types/project'
import type { SerializedScene }      from '@/core/scene/NebuScene'
import type { SerializedPrefab }     from '@/types/prefab'
import { fileSystemService }         from '@/lib/fs/FileSystemService'
import { scriptWatcher }             from '@/lib/fs/ScriptWatcher'
import { generateGuid }              from '@/lib/guid'
import { useSceneStore }             from './sceneStore'
import { useAssetStore }             from './assetStore'
import { useTextureStore }           from './textureStore'
import { useNotificationStore }      from './notificationStore'
import { useMaterialStore }          from './materialStore'
import { usePluginStore }            from './pluginStore'
import { MaterialDef }               from '@/core/materials/MaterialDef'
import type { SerializedMaterial }   from '@/types/material'
import type { PluginContext }        from '@/types/plugin'

const NEBU_MARKER     = '.nebu'
const PROJECT_VERSION = '1.0.0'

// ── File-browser node ────────────────────────────────────────────────────────

/**
 * A node shown in the file browser.
 * Directories are virtual (just grouping); actual nebu files carry a `meta`
 * sidecar.  When `missing` is true the data file could not be found at the
 * path recorded in `meta.relPath`.
 */
export interface FileBrowserNode {
  /** Display name (file/folder name without extension for known kinds). */
  name:      string
  kind:      'directory' | NebuFileKind
  /** Relative path of this item from the project root. */
  relPath:   string
  children:  FileBrowserNode[]
  /** True when `meta.relPath` points to a file that no longer exists. */
  missing:   boolean
  /** Sidecar meta — present for all non-directory nodes. */
  meta?:     NebuFileMeta
}

// Kept for backwards compat (other code may import FileTreeNode)
export type FileTreeNode = FileBrowserNode

export const useProjectStore = defineStore('project', () => {
  const directoryHandle = shallowRef<FileSystemDirectoryHandle | null>(null)
  const meta            = ref<NebuProjectMeta | null>(null)
  const fileTree        = ref<FileBrowserNode[]>([])
  const isDirty         = ref(false)

  const isOpen      = computed(() => directoryHandle.value !== null && meta.value !== null)
  const projectName = computed(() => meta.value?.name ?? null)

  // ── Plugin helpers ───────────────────────────────────────────────────────
  //
  // Plugins must be activated after the Babylon Scene is available (it is
  // created by BabylonViewport which mounts *after* the project store is
  // first accessed).  We store the IDs that still need activating and flush
  // them the moment BabylonViewport provides the Babylon context by calling
  // `activatePendingPlugins`.

  /** Plugin IDs waiting to be activated once ctx is available. */
  const _pendingPluginIds = ref<string[]>([])

  /**
   * Build a PluginContext from the current live Babylon + ECS state.
   * Returns `null` when the Babylon scene or active ECS world is not yet ready.
   */
  function _buildPluginContext(): PluginContext | null {
    const sceneStore = useSceneStore()
    const babel      = sceneStore.babylonScene
    const world      = sceneStore.activeScene?.world
    if (!babel || !world) return null
    // engine is exposed on the scene
    const engine = babel.getEngine() as import('@babylonjs/core').Engine
    return { scene: babel, engine, world }
  }

  /**
   * Activate any plugins that were deferred because the Babylon context
   * was not yet available.  Call this from BabylonViewport once the Engine
   * and Scene are initialised.
   */
  async function activatePendingPlugins(): Promise<void> {
    if (_pendingPluginIds.value.length === 0) return
    const ctx = _buildPluginContext()
    if (!ctx) return
    const pluginStore = usePluginStore()
    const ids = [..._pendingPluginIds.value]
    _pendingPluginIds.value = []
    for (const id of ids) {
      await pluginStore.activatePlugin(id, ctx)
    }
  }

  // ── New Project ──────────────────────────────────────────────────

  async function newProject(name: string): Promise<boolean> {
    const handle = await fileSystemService.openProjectFolder()
    if (!handle) return false

    // Scaffold folder structure
    await fileSystemService.ensureDir(handle, 'scenes')
    await fileSystemService.ensureDir(handle, 'assets')
    await fileSystemService.ensureDir(handle, 'assets/models')
    await fileSystemService.ensureDir(handle, 'assets/textures')
    await fileSystemService.ensureDir(handle, 'scripts')

    const projectMeta: NebuProjectMeta = {
      version:       PROJECT_VERSION,
      name,
      description:   '',
      author:        '',
      created:       Date.now(),
      lastModified:  Date.now(),
      lastSceneId:   null,
      engineTargets: ['webgl1', 'webgl2', 'webgpu'],
      activePlugins: [],
    }

    await fileSystemService.writeJson(handle, NEBU_MARKER, projectMeta)
    directoryHandle.value = handle
    meta.value            = projectMeta

    // Create default scene & persist it with a .meta sidecar
    const sceneStore = useSceneStore()
    const newScene   = sceneStore.createScene('Main Scene')
    await _saveScene(handle, newScene.guid)

    meta.value = { ...projectMeta, lastSceneId: newScene.guid, lastModified: Date.now() }
    await fileSystemService.writeJson(handle, NEBU_MARKER, meta.value)

    await refreshFileTree()
    _startScriptWatcher(handle)
    return true
  }

  // ── Open Project ─────────────────────────────────────────────────

  async function openProject(): Promise<'opened' | 'not_a_project' | 'cancelled'> {
    const handle = await fileSystemService.openProjectFolder()
    if (!handle) return 'cancelled'

    const hasMarker = await fileSystemService.fileExists(handle, NEBU_MARKER)
    if (!hasMarker) return 'not_a_project'

    const raw         = await fileSystemService.readJson<NebuProjectMeta>(handle, NEBU_MARKER)
    // Back-fill defaults for fields added after initial release
    const _defaults = {
      description:   '' as string,
      author:        '' as string,
      engineTargets: ['webgl1', 'webgl2', 'webgpu'] as NebuProjectMeta['engineTargets'],
      activePlugins: [] as string[],
    }
    const projectMeta: NebuProjectMeta = { ..._defaults, ...raw }
    directoryHandle.value = handle
    meta.value            = projectMeta

    const assetStore = useAssetStore()
    await assetStore.loadMetaFromFolder(handle)
    await _scanUntrackedAssets(handle)
    // Load textures into Babylon BEFORE materials so _rebuildBabylonMaterial
    // gets real Texture objects instead of the checkerboard placeholder.
    await useTextureStore().loadFromDirectory(assetStore.assetList, handle)
    await loadMaterialAssets(handle)

    // Prime the component registry with plugin deserializers BEFORE loading
    // the scene so that plugin-contributed component types (e.g. Collider,
    // RigidBody) survive World.deserialize.  Full onActivate (which needs a
    // live Babylon context) runs below via activatePendingPlugins.
    usePluginStore().primeComponentRegistry(projectMeta.activePlugins)

    const sceneStore = useSceneStore()
    if (projectMeta.lastSceneId) {
      await _loadSceneById(handle, projectMeta.lastSceneId, sceneStore)
    } else {
      sceneStore.createScene('Main Scene')
    }

    await refreshFileTree()
    _startScriptWatcher(handle)

    // Activate plugins that were enabled for this project.
    // Set pending IDs first, then immediately try to activate — if Babylon
    // is already mounted the plugins start right away; if not they will be
    // flushed when BabylonViewport calls activatePendingPlugins() on mount.
    _pendingPluginIds.value = [...projectMeta.activePlugins]
    await activatePendingPlugins()

    return 'opened'
  }

  // ── Save Project ─────────────────────────────────────────────────

  async function saveProject(): Promise<void> {
    const handle = directoryHandle.value
    if (!handle || !meta.value) return

    const sceneStore = useSceneStore()
    if (sceneStore.activeScene) {
      await _saveScene(handle, sceneStore.activeScene.guid)
      meta.value = { ...meta.value, lastSceneId: sceneStore.activeScene.guid }
    }

    meta.value = { ...meta.value, lastModified: Date.now() }
    await fileSystemService.writeJson(handle, NEBU_MARKER, meta.value)
    isDirty.value = false
    await refreshFileTree()
    useNotificationStore().success('Project saved')
  }

  async function saveActiveScene(): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const sceneStore = useSceneStore()
    if (sceneStore.activeScene) await _saveScene(handle, sceneStore.activeScene.guid)
  }

  // ── Close Project ────────────────────────────────────────────────

  function closeProject(): void {
    // Deactivate all plugins before clearing state so onDeactivate receives
    // valid ctx references.
    const ctx = _buildPluginContext()
    if (ctx) usePluginStore().deactivateAll(ctx)
    _pendingPluginIds.value = []

    // Stop watching scripts and clear the compiled registry.
    scriptWatcher.stop()
    import('@/stores/scriptStore').then(({ useScriptStore }) => useScriptStore().clearAll())

    directoryHandle.value = null
    meta.value            = null
    fileTree.value        = []
    isDirty.value         = false
  }

  // ── Scene: create + open ─────────────────────────────────────────

  /**
   * Create a brand-new scene, save it to disk under `folderRelPath` (relative
   * to project root, e.g. `scenes` or `scenes/levels`), and refresh the tree.
   */
  async function createScene(name: string, folderRelPath = 'scenes'): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return

    const sceneStore = useSceneStore()
    const newScene   = sceneStore.createScene(name)
    await _saveSceneTo(handle, newScene.guid, folderRelPath)
    await refreshFileTree()
  }

  /**
   * Open a scene from its meta.  Loads the scene data and sets it active.
   */
  async function openSceneFromMeta(fileMeta: NebuFileMeta): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const sceneStore = useSceneStore()

    // Already loaded?
    if (sceneStore.scenes.has(fileMeta.guid)) {
      sceneStore.setActiveScene(fileMeta.guid)
      return
    }

    try {
      const data = await fileSystemService.readJson<SerializedScene>(handle, fileMeta.relPath)
      const scene = sceneStore.loadSceneData(data)
      sceneStore.setActiveScene(scene.guid)

      // Update lastSceneId in project meta
      if (meta.value) {
        meta.value = { ...meta.value, lastSceneId: scene.guid, lastModified: Date.now() }
        await fileSystemService.writeJson(handle, NEBU_MARKER, meta.value)
      }
    } catch {
      console.warn('[projectStore] Could not load scene from', fileMeta.relPath)
    }
  }

  // ── Folder: create ───────────────────────────────────────────────

  async function createFolder(parentRelPath: string, folderName: string): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const newPath = parentRelPath ? `${parentRelPath}/${folderName}` : folderName
    await fileSystemService.ensureDir(handle, newPath)
    await refreshFileTree()
  }

  // ── Scene thumbnail ───────────────────────────────────────────────

  /**
   * Save a viewport thumbnail (base64 data-URL) into the scene's `.meta` file.
   */
  async function saveSceneThumbnail(sceneGuid: string, thumbnail: string): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    // Find matching node in the flat tree to get its meta path
    const node = _findNodeByGuid(fileTree.value, sceneGuid)
    if (!node?.meta) return
    const updatedMeta: NebuFileMeta = { ...node.meta, thumbnail, lastModified: Date.now() }
    await fileSystemService.writeJson(handle, `${node.meta.relPath}.meta`, updatedMeta)
    node.meta = updatedMeta
  }

  // ── File tree ────────────────────────────────────────────────────

  async function refreshFileTree(): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) { fileTree.value = []; return }
    fileTree.value = await _buildTree(handle, '')
  }

  async function _buildTree(
    root:    FileSystemDirectoryHandle,
    relPath: string,
  ): Promise<FileBrowserNode[]> {
    const nodes: FileBrowserNode[] = []
    try {
      const handles = await fileSystemService.listDir(root, relPath)
      for (const h of handles) {
        // Skip hidden sentinel files and .meta sidecars — never shown in browser
        if (h.name.startsWith('.') || h.name.endsWith('.meta')) continue

        const childRel = relPath ? `${relPath}/${h.name}` : h.name

        if (h.kind === 'directory') {
          const children = await _buildTree(root, childRel)
          nodes.push({ name: h.name, kind: 'directory', relPath: childRel, children, missing: false })
        } else {
          // Attempt to load the sidecar .meta
          const metaPath = `${childRel}.meta`
          let fileMeta: NebuFileMeta | undefined
          let missing = false

          if (await fileSystemService.fileExists(root, metaPath)) {
            try {
              fileMeta = await fileSystemService.readJson<NebuFileMeta>(root, metaPath)
              // Verify the recorded relPath still points to this file.
              // AssetMeta files (textures, meshes, etc.) have no relPath field —
              // skip the stale-path check for those; the file clearly exists since
              // we found it while iterating the directory.
              if (fileMeta.relPath !== undefined && fileMeta.relPath !== childRel) {
                missing = !(await fileSystemService.fileExists(root, fileMeta.relPath))
              }
            } catch {
              fileMeta = undefined
            }
          }

          // Infer kind from extension when no meta exists
          const kind: NebuFileKind = fileMeta?.kind ?? _inferKind(h.name)
          const displayName = _displayName(h.name, kind)

          nodes.push({
            name:    displayName,
            kind,
            relPath: childRel,
            children: [],
            missing,
            meta:    fileMeta,
          })
        }
      }
    } catch { /* directory may not exist */ }

    return nodes.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === 'directory' ? -1 : 1
        : a.name.localeCompare(b.name),
    )
  }

  // ── Internals ────────────────────────────────────────────────────

  // ── Script: watch + compile ───────────────────────────────────────

  /**
   * Start the ScriptWatcher against the given project directory.
   * Wires the three callbacks into scriptStore so all script lifecycle
   * events (initial load, hot-reload, deletion) are handled centrally.
   */
  function _startScriptWatcher(handle: FileSystemDirectoryHandle): void {
    scriptWatcher.start(handle, {
      onAdded(relPath, source, guid, name) {
        import('@/stores/scriptStore').then(({ useScriptStore }) => {
          useScriptStore().compileAndRegister(guid, source, name, relPath)
        })
        refreshFileTree()
      },
      onChanged(relPath, source, guid, name) {
        import('@/stores/scriptStore').then(({ useScriptStore }) => {
          useScriptStore().hotReload(guid, source, name, relPath)
        })
      },
      onRemoved(_relPath, guid) {
        import('@/stores/scriptStore').then(({ useScriptStore }) => {
          useScriptStore().removeScript(guid)
        })
        refreshFileTree()
      },
    })
  }

  /**
   * Create a new TypeScript script file under `folderRelPath` (default
   * `scripts/`) with a starter template, write its `.meta` sidecar, then
   * trigger a watcher rescan so it is compiled immediately.
   */
  async function createScript(name = 'NewScript', folderRelPath = 'scripts'): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return

    // Sanitise: strip illegal path chars, convert spaces to camelCase
    const safeName = name.trim().replace(/\s+(.)/g, (_, c: string) => c.toUpperCase()) || 'NewScript'
    await fileSystemService.ensureDir(handle, folderRelPath)
    const dataPath = `${folderRelPath}/${safeName}.ts`

    const template = [
      `// ${safeName}.ts`,
      `// ─────────────────────────────────────────────────────────────────────`,
      `// Entity script — override only the hooks you need.`,
      `// The engine detects overrides at load time; unimplemented hooks have`,
      `// zero overhead (no observable is ever registered for them).`,
      `// ─────────────────────────────────────────────────────────────────────`,
      ``,
      `export default class ${safeName} extends NebuScript {`,
      ``,
      `  // ── Exposed properties ────────────────────────────────────────────`,
      `  // Serialized fields that appear in the Inspector panel.`,
      `  // Supported types: 'number' | 'string' | 'boolean' | 'color' |`,
      `  //                  'vec3' | 'entity-ref' | 'material' | 'texture'`,
      `  //`,
      `  // static override readonly exposedProps: ExposedPropDef[] = [`,
      `  //   { key: 'speed',   type: 'number',     label: 'Speed',   default: 5,     min: 0, step: 0.1 },`,
      `  //   { key: 'active',  type: 'boolean',    label: 'Active',  default: true },`,
      `  //   { key: 'label',   type: 'string',     label: 'Label',   default: '' },`,
      `  //   { key: 'tint',    type: 'color',      label: 'Tint',    default: { r: 1, g: 1, b: 1 } },`,
      `  //   { key: 'offset',  type: 'vec3',       label: 'Offset',  default: { x: 0, y: 0, z: 0 } },`,
      `  //   { key: 'target',  type: 'entity-ref', label: 'Target',  default: null },`,
      `  // ]`,
      ``,
      `  // ── Editor-time lifecycle ─────────────────────────────────────────`,
      `  // Runs in the editor viewport even when Play is NOT active.`,
      `  //`,
      `  // override onEditorAwake(): void {`,
      `  //   // Called once when the script is compiled/reloaded in the editor.`,
      `  // }`,
      `  //`,
      `  // override onEditorUpdate(dt: number): void {`,
      `  //   // Called every editor frame (Babylon render loop).`,
      `  // }`,
      `  //`,
      `  // override onEditorDestroy(): void {`,
      `  //   // Called when the component is removed or the scene is closed.`,
      `  // }`,
      ``,
      `  // ── Runtime lifecycle ─────────────────────────────────────────────`,
      ``,
      `  override onAwake(): void {`,
      `    // First to run when Play starts — before onStart on any script.`,
      `    // Use for self-contained initialization (cache component refs, etc.).`,
      `    //`,
      `    // Useful helpers available on 'this':`,
      `    //   this.entity          — the Entity this script is attached to`,
      `    //   this.world           — the ECS World`,
      `    //   this.scene           — the live Babylon Scene`,
      `    //   this.transform       — shorthand for this.entity's TransformComponent`,
      `    //   this.getComponent<T>('Type')             — get a component by type key`,
      `    //   this.findEntity('Name')                  — find entity by name`,
      `    //   this.findEntitiesWithTag('tag')          — find entities by tag`,
      `    //   this.resolveRef('propKey')               — resolve an entity-ref prop`,
      `  }`,
      ``,
      `  // override onStart(): void {`,
      `  //   // Called on the first frame, after ALL scripts have received onAwake.`,
      `  //   // Use when your init depends on another script being ready first.`,
      `  // }`,
      ``,
      `  // override onEnable(): void {`,
      `  //   // Called whenever this entity/component becomes active.`,
      `  // }`,
      ``,
      `  // override onDisable(): void {`,
      `  //   // Called whenever this entity/component becomes inactive.`,
      `  // }`,
      ``,
      `  override onUpdate(dt: number): void {`,
      `    // Called every rendered frame. dt = seconds since last frame.`,
      `  }`,
      ``,
      `  // override onLateUpdate(dt: number): void {`,
      `  //   // Called after ALL scripts have finished their onUpdate this frame.`,
      `  //   // Good for camera follow, IK, or anything that reads other scripts' output.`,
      `  // }`,
      ``,
      `  // override onFixedUpdate(dt: number): void {`,
      `  //   // Called on the physics fixed timestep (requires an active physics engine).`,
      `  //   // Use for physics forces, raycasts, and collision queries.`,
      `  // }`,
      ``,
      `  // override onDestroy(): void {`,
      `  //   // Called just before this entity is destroyed.`,
      `  //   // Clean up timers, subscriptions, or external references here.`,
      `  // }`,
      `}`,
    ].join('\n')

    // Write script file (plain text — must NOT use writeJson here)
    await fileSystemService.writeText(handle, dataPath, template)

    // Write .meta sidecar
    const guid = generateGuid()
    const meta: NebuFileMeta = {
      guid,
      kind:         'script',
      relPath:      dataPath,
      lastModified: Date.now(),
    }
    await fileSystemService.writeJson(handle, `${dataPath}.meta`, meta)

    // Compile immediately — don't wait for the next watcher tick
    import('@/stores/scriptStore').then(({ useScriptStore }) => {
      useScriptStore().compileAndRegister(guid, template, safeName, dataPath)
    })

    // Trigger a rescan so the watcher cache includes the new file (prevents
    // a redundant recompile on the next scheduled poll tick).
    scriptWatcher.rescan()
    await refreshFileTree()
  }

  /** Read the raw TypeScript source of a script file by its project-relative path. */
  async function readScriptSource(relPath: string): Promise<string | null> {
    const handle = directoryHandle.value
    if (!handle) return null
    try {
      return await fileSystemService.readText(handle, relPath)
    } catch {
      return null
    }
  }

  /** Overwrite a script file with new source content and trigger hot-reload. */
  async function writeScriptSource(relPath: string, content: string): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    await fileSystemService.writeText(handle, relPath, content)
    // Rescan so the watcher picks up the new lastModified timestamp
    scriptWatcher.rescan()
  }

  function _inferKind(filename: string): NebuFileKind {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'scene') return 'scene'
    if (ext === 'prefab') return 'prefab'
    if (ext === 'mat')   return 'material'
    if (ext === 'ts')    return 'script'
    if (['png', 'jpg', 'jpeg', 'webp', 'ktx', 'ktx2'].includes(ext)) return 'texture'
    if (['glb', 'gltf', 'obj', 'fbx', 'babylon', 'stl', 'dae'].includes(ext)) return 'model'
    if (['mp3', 'ogg', 'wav'].includes(ext)) return 'asset'
    return 'unknown'
  }

  function _displayName(filename: string, kind: NebuFileKind): string {
    // Strip the extension for known nebu types to keep names clean
    if (kind === 'scene' && filename.endsWith('.scene'))
      return filename.slice(0, -6)
    if (kind === 'prefab' && filename.endsWith('.prefab'))
      return filename.slice(0, -7)
    if (kind === 'material' && filename.endsWith('.mat'))
      return filename.slice(0, -4)
    if (kind === 'script' && filename.endsWith('.ts'))
      return filename.slice(0, -3)
    return filename
  }

  async function _saveScene(handle: FileSystemDirectoryHandle, guid: string): Promise<void> {
    await _saveSceneTo(handle, guid, 'scenes')
  }

  async function _saveSceneTo(
    handle:        FileSystemDirectoryHandle,
    guid:          string,
    folderRelPath: string,
  ): Promise<void> {
    const sceneStore = useSceneStore()
    const scene      = sceneStore.scenes.get(guid)
    if (!scene) return

    await fileSystemService.ensureDir(handle, folderRelPath)
    const dataPath = `${folderRelPath}/${scene.name}.scene`
    await fileSystemService.writeJson(handle, dataPath, scene.serialize())

    // Write / update the .meta sidecar
    const metaPath = `${dataPath}.meta`
    let existingMeta: NebuFileMeta | undefined
    if (await fileSystemService.fileExists(handle, metaPath)) {
      try { existingMeta = await fileSystemService.readJson<NebuFileMeta>(handle, metaPath) }
      catch { /* ignore */ }
    }

    const fileMeta: NebuFileMeta = {
      guid:         scene.guid,   // must match NebuScene.guid so _loadSceneById can find it
      kind:         'scene',
      relPath:      dataPath,
      lastModified: Date.now(),
      thumbnail:    existingMeta?.thumbnail,
    }
    await fileSystemService.writeJson(handle, metaPath, fileMeta)
  }

  async function _loadSceneById(
    handle:     FileSystemDirectoryHandle,
    sceneId:    string,
    sceneStore: ReturnType<typeof useSceneStore>,
  ): Promise<void> {
    try {
      // Scan for .scene.meta files whose guid matches
      const nodes = await _buildTree(handle, 'scenes')
      for (const node of nodes) {
        if (node.meta?.guid === sceneId && node.kind === 'scene') {
          const data = await fileSystemService.readJson<SerializedScene>(handle, node.relPath)
          const scene = sceneStore.loadSceneData(data)
          sceneStore.setActiveScene(scene.guid)
          return
        }
      }
    } catch { /* scenes/ may not exist */ }
    sceneStore.createScene('Main Scene')
  }

  // ── Prefab: create + instantiate ──────────────────────────────────────────

  /**
   * Serialize the entity subtree rooted at `entityId` and save it as a
   * `.prefab` file (+  `.prefab.meta`) in `folderRelPath`.
   */
  async function createPrefabFromEntity(entityId: string, folderRelPath: string): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const sceneStore = useSceneStore()
    const scene      = sceneStore.activeScene
    if (!scene) return
    const entity = scene.world.getEntity(entityId)
    if (!entity) return

    const { serializeEntitySubtree } = await import('@/core/serialization/PrefabSerializer')
    const entities = serializeEntitySubtree(scene.world, entityId)

    const now  = Date.now()
    const guid = generateGuid()
    const prefabData: SerializedPrefab = {
      version: '1.0.0', guid, name: entity.name, created: now, lastModified: now, entities,
    }

    await fileSystemService.ensureDir(handle, folderRelPath)
    const dataPath = `${folderRelPath}/${entity.name}.prefab`
    await fileSystemService.writeJson(handle, dataPath, prefabData)
    const fileMeta: NebuFileMeta = { guid, kind: 'prefab', relPath: dataPath, lastModified: now }
    await fileSystemService.writeJson(handle, `${dataPath}.meta`, fileMeta)
    await refreshFileTree()
    useNotificationStore().success(`Prefab \"${entity.name}\" saved`)
  }

  /**
   * Serialize every persistent entity in the active scene into a `.prefab` file.
   * Useful for turning an entire scene into a reusable asset.
   */
  async function createPrefabFromScene(folderRelPath: string): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const sceneStore = useSceneStore()
    const scene      = sceneStore.activeScene
    if (!scene) return

    const { serializeWorldEntities } = await import('@/core/serialization/PrefabSerializer')
    const entities = serializeWorldEntities(scene.world)

    const now  = Date.now()
    const guid = generateGuid()
    const prefabData: SerializedPrefab = {
      version: '1.0.0', guid, name: scene.name, created: now, lastModified: now, entities,
    }

    await fileSystemService.ensureDir(handle, folderRelPath)
    const dataPath = `${folderRelPath}/${scene.name}.prefab`
    await fileSystemService.writeJson(handle, dataPath, prefabData)
    const fileMeta: NebuFileMeta = { guid, kind: 'prefab', relPath: dataPath, lastModified: now }
    await fileSystemService.writeJson(handle, `${dataPath}.meta`, fileMeta)
    await refreshFileTree()
    useNotificationStore().success(`Prefab \"${scene.name}\" saved from scene`)
  }

  /**
   * Look up a prefab file by GUID in the file tree, load it, and instantiate
   * it into the active scene under `parentId`.
   * Returns the newly created root entities, or an empty array on failure.
   */
  async function instantiatePrefabByGuid(
    prefabGuid: string,
    parentId:   string | null,
  ): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const node = _findNodeByGuid(fileTree.value, prefabGuid)
    if (!node?.meta) { console.warn('[projectStore] Prefab not found:', prefabGuid); return }
    try {
      const data = await fileSystemService.readJson<SerializedPrefab>(handle, node.meta.relPath)
      useSceneStore().instantiatePrefab(data.entities, parentId, data.guid, data.name)
      useNotificationStore().success(`Prefab \"${data.name}\" instantiated`)
    } catch (err) {
      console.warn('[projectStore] Failed to instantiate prefab', node.meta.relPath, err)
    }
  }

  /**
   * Re-serialize the entity subtree `rootEntityId` (which must have a
   * PrefabInstanceComponent) back into its source `.prefab` file, then update
   * every other instance of the same prefab in the active scene by destroying
   * it and re-instantiating the updated file.
   */
  async function applyPrefabToSource(
    rootEntityId: string,
    transformMask: { position: boolean; rotation: boolean; scale: boolean } = { position: true, rotation: true, scale: true },
  ): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const ss     = useSceneStore()
    const scene  = ss.activeScene
    if (!scene) return

    const { PrefabInstanceComponent } = await import('@/core/ecs/components/PrefabInstanceComponent')
    const root = scene.world.getEntity(rootEntityId)
    if (!root) return
    const prefabComp = root.getComponent<InstanceType<typeof PrefabInstanceComponent>>('PrefabInstance')
    if (!prefabComp) return

    const { prefabGuid, prefabName } = prefabComp
    const node = _findNodeByGuid(fileTree.value, prefabGuid)
    if (!node?.meta) { console.warn('[projectStore] Source prefab not found:', prefabGuid); return }

    // Re-serialize the current subtree.
    const { serializeEntitySubtree } = await import('@/core/serialization/PrefabSerializer')
    const entities = serializeEntitySubtree(scene.world, rootEntityId)

    const now = Date.now()
    const prefabData: SerializedPrefab = {
      version: '1.0.0', guid: prefabGuid, name: prefabName,
      created: now, lastModified: now, entities,
    }
    await fileSystemService.writeJson(handle, node.meta.relPath, prefabData)

    // Find all OTHER instances of this prefab (by PrefabInstance.prefabGuid).
    // Capture each root's current transform before destroying it.
    const { TransformComponent, toVec3 } = await import('@/core/ecs/components/TransformComponent')
    type Vec3 = { x: number; y: number; z: number }
    const otherRoots: Array<{
      id:       string
      parentId: string | null
      savedPos: Vec3 | null
      savedRot: Vec3 | null
      savedSca: Vec3 | null
    }> = []
    for (const e of scene.world.entities.values()) {
      if (e.id === rootEntityId) continue
      const c = e.getComponent<InstanceType<typeof PrefabInstanceComponent>>('PrefabInstance')
      if (c?.prefabGuid !== prefabGuid) continue
      const tf = e.getComponent<InstanceType<typeof TransformComponent>>('Transform')
      otherRoots.push({
        id:       e.id,
        parentId: e.parentId,
        savedPos: tf ? toVec3(tf.position) : null,
        savedRot: tf ? toVec3(tf.rotation) : null,
        savedSca: tf ? toVec3(tf.scale)    : null,
      })
    }

    // Destroy each other instance's subtree, re-instantiate, then restore
    // any transform axes that were excluded from the apply mask.
    for (const { id, parentId, savedPos, savedRot, savedSca } of otherRoots) {
      _destroySubtree(id, ss)
      const newRoots = ss.instantiatePrefab(entities, parentId, prefabGuid, prefabName)

      // Restore unchecked axes on the new root entity's Transform.
      const needRestore = (!transformMask.position && savedPos)
                       || (!transformMask.rotation && savedRot)
                       || (!transformMask.scale    && savedSca)
      const newRoot = newRoots[0]
      if (needRestore && newRoot) {
        const newTf = newRoot.getComponent<InstanceType<typeof TransformComponent>>('Transform')
        if (newTf) {
          if (!transformMask.position && savedPos) newTf.position = savedPos
          if (!transformMask.rotation && savedRot) newTf.rotation = savedRot
          if (!transformMask.scale    && savedSca) newTf.scale    = savedSca
          newTf.syncToBabylon()
          newTf.notifyChanged()
        }
      }
    }

    await refreshFileTree()
    useNotificationStore().success(`Prefab "${prefabName}" applied to all instances`)
  }

  /**
   * Save the entity subtree as a brand-new prefab file (breaks the link to the
   * original), then remove the PrefabInstanceComponent from the root entity so
   * it is no longer tracked as an instance of the old prefab.
   */
  async function saveInstanceAsUniquePrefab(rootEntityId: string, folderRelPath = 'prefabs'): Promise<void> {
    const ss    = useSceneStore()
    const scene = ss.activeScene
    if (!scene) return

    const { PrefabInstanceComponent } = await import('@/core/ecs/components/PrefabInstanceComponent')
    const root = scene.world.getEntity(rootEntityId)
    if (!root) return
    const prefabComp = root.getComponent<InstanceType<typeof PrefabInstanceComponent>>('PrefabInstance')
    const displayName = prefabComp?.prefabName ?? root.name

    // Detach from original prefab before serializing so the new file is clean.
    root.removeComponent('PrefabInstance')

    // Delegate to the existing helper (same logic as drag-to-folder).
    await createPrefabFromEntity(rootEntityId, folderRelPath)
    useNotificationStore().success(`"${displayName}" saved as unique prefab`)
  }

  /**
   * Destroy the entity subtree `rootEntityId` and re-instantiate the original
   * prefab in its place, effectively reverting any changes.
   */
  async function revertPrefabInstance(rootEntityId: string): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const ss     = useSceneStore()
    const scene  = ss.activeScene
    if (!scene) return

    const { PrefabInstanceComponent } = await import('@/core/ecs/components/PrefabInstanceComponent')
    const root = scene.world.getEntity(rootEntityId)
    if (!root) return
    const prefabComp = root.getComponent<InstanceType<typeof PrefabInstanceComponent>>('PrefabInstance')
    if (!prefabComp) return

    const { prefabGuid } = prefabComp
    const parentId       = root.parentId
    const node = _findNodeByGuid(fileTree.value, prefabGuid)
    if (!node?.meta) { console.warn('[projectStore] Source prefab not found:', prefabGuid); return }

    try {
      const data = await fileSystemService.readJson<SerializedPrefab>(handle, node.meta.relPath)
      _destroySubtree(rootEntityId, ss)
      ss.instantiatePrefab(data.entities, parentId, data.guid, data.name)
      useNotificationStore().success(`Prefab "${data.name}" reverted`)
    } catch (err) {
      console.warn('[projectStore] Failed to revert prefab', err)
    }
  }

  /** Recursively destroy an entity and all its descendants. */
  function _destroySubtree(rootId: string, ss: ReturnType<typeof useSceneStore>): void {
    const scene = ss.activeScene
    if (!scene) return
    const children = [...scene.world.entities.values()].filter(e => e.parentId === rootId)
    for (const child of children) _destroySubtree(child.id, ss)
    ss.destroyEntity(rootId)
  }


  /**
   * Persist editable project settings (name, description, author,
   * engineTargets, activePlugins) back to the `.nebu` marker file.
   * Also handles plugin activation / deactivation deltas when
   * `activePlugins` is included in the patch.
   */
  async function updateSettings(patch: {
    name?:          string
    description?:   string
    author?:        string
    engineTargets?: EngineTarget[]
    activePlugins?: string[]
  }): Promise<void> {
    const handle = directoryHandle.value
    if (!handle || !meta.value) return

    // Apply plugin activation / deactivation deltas
    if (patch.activePlugins !== undefined) {
      const ctx        = _buildPluginContext()
      const pluginStore = usePluginStore()
      const prev        = new Set(meta.value.activePlugins)
      const next        = new Set(patch.activePlugins)

      if (ctx) {
        for (const id of next) {
          if (!prev.has(id)) await pluginStore.activatePlugin(id, ctx)
        }
        for (const id of prev) {
          if (!next.has(id)) pluginStore.deactivatePlugin(id, ctx)
        }
      } else {
        // ctx not ready yet — queue for when BabylonViewport is mounted
        _pendingPluginIds.value = [...next]
        await activatePendingPlugins()
      }
    }

    meta.value = { ...meta.value, ...patch, lastModified: Date.now() }
    await fileSystemService.writeJson(handle, NEBU_MARKER, meta.value)
  }

  function _findNodeByGuid(nodes: FileBrowserNode[], guid: string): FileBrowserNode | null {
    for (const n of nodes) {
      if (n.meta?.guid === guid) return n
      const found = _findNodeByGuid(n.children, guid)
      if (found) return found
    }
    return null
  }

  // ── Material Assets ───────────────────────────────────────────────

  /**
   * Create a new material asset (.mat + .mat.meta) under `folderRelPath`.
   * The MaterialDef is registered in the materialStore automatically.
   */
  async function createMaterialAsset(name = 'New Material', folderRelPath = 'materials'): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const matStore = useMaterialStore()
    const def      = matStore.createMaterial(name, 'Standard')
    await fileSystemService.ensureDir(handle, folderRelPath)
    const dataPath = `${folderRelPath}/${name}.mat`
    await fileSystemService.writeJson(handle, dataPath, def.serialize())
    const fileMeta: NebuFileMeta = {
      guid:         def.id,
      kind:         'material',
      relPath:      dataPath,
      lastModified: Date.now(),
    }
    await fileSystemService.writeJson(handle, `${dataPath}.meta`, fileMeta)
    await refreshFileTree()
  }

  /** Persist the current serialized form of a material def back to its .mat file. */
  async function saveMaterialAsset(matId: string): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const def  = useMaterialStore().getMaterial(matId)
    if (!def) return
    const node = _findNodeByGuid(fileTree.value, matId)
    if (!node) return
    await fileSystemService.writeJson(handle, node.relPath, def.serialize())
    if (node.meta) node.meta = { ...node.meta, lastModified: Date.now() }
  }

  /** Save a material preview thumbnail (data-URL) to the .mat.meta sidecar. */
  async function saveMaterialPreview(matId: string, thumbnail: string): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    const node = _findNodeByGuid(fileTree.value, matId)
    if (!node?.meta) return
    const updatedMeta: NebuFileMeta = { ...node.meta, thumbnail, lastModified: Date.now() }
    await fileSystemService.writeJson(handle, `${node.meta.relPath}.meta`, updatedMeta)
    node.meta = updatedMeta
  }

  /**
   * Delete a file-browser node (its data file + .meta sidecar).
   * For materials, also removes the def from the materialStore.
   * Always prompts for confirmation.
   */
  async function deleteNode(node: FileBrowserNode): Promise<void> {
    const handle = directoryHandle.value
    if (!handle) return
    if (!confirm(`Delete "${node.name}"? This cannot be undone.`)) return
    try { await fileSystemService.deleteFile(handle, node.relPath) } catch { /* ok */ }
    if (node.meta) {
      try { await fileSystemService.deleteFile(handle, `${node.relPath}.meta`) } catch { /* ok */ }
    }
    if (node.kind === 'material' && node.meta?.guid) {
      useMaterialStore().removeMaterial(node.meta.guid)
    }
    if (node.kind === 'texture' && node.meta?.guid) {
      useTextureStore().unloadTexture(node.meta.guid)
      useAssetStore().removeAsset(node.meta.guid)
    }
    if (node.kind === 'script' && node.meta?.guid) {
      // The watcher will fire onRemoved on the next tick, but we also
      // remove immediately so the Inspector list updates instantly.
      import('@/stores/scriptStore').then(({ useScriptStore }) => {
        useScriptStore().removeScript(node.meta!.guid)
      })
    }
    await refreshFileTree()
  }

  /** Load all .mat asset files from the project into materialStore.
   *  Scans the entire project tree so materials stored in any subfolder are found. */
  async function loadMaterialAssets(handle: FileSystemDirectoryHandle): Promise<void> {
    const matStore = useMaterialStore()
    const allNodes = await _buildTree(handle, '')
    await _walkAndLoadMaterials(allNodes, handle, matStore)
  }

  async function _walkAndLoadMaterials(
    nodes:    FileBrowserNode[],
    handle:   FileSystemDirectoryHandle,
    matStore: ReturnType<typeof useMaterialStore>,
  ): Promise<void> {
    for (const node of nodes) {
      if (node.kind === 'material') {
        try {
          const data = await fileSystemService.readJson<SerializedMaterial>(handle, node.relPath)
          if (!matStore.getMaterial(data.id)) {
            matStore.loadDef(MaterialDef.deserialize(data))
          }
        } catch { /* ignore corrupt file */ }
      }
      if (node.children.length) {
        await _walkAndLoadMaterials(node.children, handle, matStore)
      }
    }
  }

  /**
   * Walk `assets/` recursively and auto-import any file that has no `.meta`
   * sidecar alongside it. This picks up assets added outside the editor.
   */
  async function _scanUntrackedAssets(handle: FileSystemDirectoryHandle): Promise<void> {
    const assetStore = useAssetStore()

    async function walk(dirRelPath: string): Promise<void> {
      let children: FileSystemHandle[]
      try {
        children = await fileSystemService.listDir(handle, dirRelPath)
      } catch {
        return
      }
      const siblingNames = new Set(children.map(h => h.name))
      for (const child of children) {
        const childRel = `${dirRelPath}/${child.name}`
        if (child.kind === 'directory') {
          await walk(childRel)
        } else if (child.kind === 'file' && !child.name.endsWith('.meta')) {
          if (!siblingNames.has(`${child.name}.meta`)) {
            try {
              const file      = await fileSystemService.readAsFile(handle, childRel)
              const relFolder = dirRelPath.replace(/^assets\/?/, '')
              await assetStore.importAsset(file, handle, relFolder)
            } catch { /* skip unreadable files */ }
          }
        }
      }
    }

    try {
      await walk('assets')
    } catch { /* assets/ may not exist yet */ }
  }

  return {
    directoryHandle,
    meta,
    fileTree,
    isDirty,
    isOpen,
    projectName,
    newProject,
    openProject,
    saveProject,
    saveActiveScene,
    saveSceneThumbnail,
    refreshFileTree,
    closeProject,
    createScene,
    createFolder,
    createScript,
    openSceneFromMeta,
    updateSettings,
    activatePendingPlugins,
    createMaterialAsset,
    saveMaterialAsset,
    saveMaterialPreview,
    deleteNode,
    loadMaterialAssets,
    readScriptSource,
    writeScriptSource,
    createPrefabFromEntity,
    createPrefabFromScene,
    instantiatePrefabByGuid,
    applyPrefabToSource,
    saveInstanceAsUniquePrefab,
    revertPrefabInstance,
  }
})
