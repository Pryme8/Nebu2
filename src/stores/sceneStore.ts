import { defineStore }         from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { NebuScene }                from '@/core/scene/NebuScene'
import type { SerializedScene }     from '@/core/scene/NebuScene'
import type { Entity }              from '@/core/ecs/Entity'
import { TransformComponent }       from '@/core/ecs/components/TransformComponent'
import { TransformNode, HemisphericLight, DirectionalLight, SpotLight, PointLight, ShadowGenerator, CascadedShadowGenerator, Color3, Vector3, UniversalCamera, ArcRotateCamera, Camera as BabylonCamera, MeshBuilder, Mesh, AbstractMesh, type Scene as BabylonScene, type Nullable, type Observer } from '@babylonjs/core'
import { LightComponent }           from '@/core/ecs/components/LightComponent'
import { CameraComponent }          from '@/core/ecs/components/CameraComponent'
import { MeshComponent }            from '@/core/ecs/components/MeshComponent'
import { ScriptComponent }          from '@/core/ecs/components/ScriptComponent'
import { AnimationComponent }       from '@/core/ecs/components/AnimationComponent'
import type { Component }           from '@/core/ecs/Component'
import { getComponentFactory } from '@/core/ecs/componentRegistry'
import { ScriptRuntimeSystem }      from '@/core/scripting/ScriptRuntimeSystem'
import { AnimationSystem }          from '@/core/ecs/systems/AnimationSystem'
import { scriptEditorSystem }       from '@/core/scripting/ScriptEditorSystem'
import type { SerializedEntity, SerializedWorld } from '@/core/ecs/World'
import { generateGuid }              from '@/lib/guid'
import { remapPrefabEntities }       from '@/core/serialization/PrefabSerializer'
import { PrefabInstanceComponent }   from '@/core/ecs/components/PrefabInstanceComponent'
import { ModelManager }              from '@/core/assets/ModelManager'

export const useSceneStore = defineStore('scene', () => {

  // shallowRef: the Map reference is tracked, not deep contents.
  // We swap the Map reference on every mutation to trigger reactivity.
  const scenes        = shallowRef(new Map<string, NebuScene>())
  const activeSceneId = ref<string | null>(null)

  /** Babylon.js Scene — provided by BabylonViewport on mount. */
  const babylonScene  = shallowRef<BabylonScene | null>(null)

  /** ModelManager — one instance per Babylon scene; disposed on scene change. */
  const _modelManager = shallowRef<ModelManager | null>(null)

  /** Editor camera — registered by BabylonViewport so it can be managed alongside ECS cameras. */
  const _editorCamera = shallowRef<BabylonCamera | null>(null)

  /**
   * Per-entity camera subscription registry.
   * Stores the unsubscribe functions for each camera’s own onChange watcher
   * (which detects targetEntityId changes) and for the target entity’s
   * TransformComponent onChange watcher (which drives the live look-at).
   * Cleaned up whenever the camera component is removed or the entity destroyed.
   */
  const _cameraWiring = new Map<string, {
    cameraUnsub: () => void
  }>()

  /**
   * Per-entity light transform subscription registry.
   * Directional/Spot/Point lights cannot be parented to TransformNodes in
   * Babylon, so we subscribe to the entity's TransformComponent.onChange and
   * push the world position (and forward direction) to the Babylon light manually.
   * Cleaned up whenever the light component is removed or the entity destroyed.
   */
  const _lightWiring = new Map<string, { transformUnsub: (() => void) | null }>()

  /**
   * Push the entity's world position (and forward direction for Directional/Spot)
   * from its TransformComponent onto the live Babylon light.
   * Hemispheric lights are skipped — Babylon handles them differently.
   */
  function _syncLightTransform(
    entityId: string,
    light:    LightComponent,
    world?:   import('@/core/ecs/World').World,
  ): void {
    if (!light.babylonLight || light.lightType === 'Hemispheric') return
    const w  = world ?? activeScene.value?.world
    const tf = w?.getEntity(entityId)?.getComponent<TransformComponent>('Transform')
    if (!tf?.babylonNode) return
    tf.babylonNode.computeWorldMatrix(true)
    const worldPos = tf.babylonNode.getAbsolutePosition()
    ;(light.babylonLight as DirectionalLight).position.copyFrom(worldPos)
  }

  /**
   * Reactive revision counter.
   * Bumped whenever entities are created/destroyed/renamed so that
   * computed properties that read from the mutable ECS objects re-evaluate.
   */
  const worldRevision = ref(0)
  function bumpRevision(): void { worldRevision.value++ }

  // ── Derived state ────────────────────────────────────────────────

  const activeScene = computed<NebuScene | null>(() => {
    return activeSceneId.value ? (scenes.value.get(activeSceneId.value) ?? null) : null
  })

  /** Flat list of all entities in the active scene — reactive. */
  const entityList = computed<Entity[]>(() => {
    worldRevision.value            // establish reactive dependency
    const scene = activeScene.value
    if (!scene) return []
    return [...scene.world.entities.values()]
  })

  /** Hierarchy structure for the tree UI. */
  const hierarchy = computed(() => {
    const list     = entityList.value
    const children = new Map<string | null, Entity[]>()
    for (const e of list) {
      const arr = children.get(e.parentId) ?? []
      arr.push(e)
      children.set(e.parentId, arr)
    }
    // Sort siblings by sortOrder for stable, user-controllable ordering
    for (const arr of children.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder)
    return { roots: children.get(null) ?? [], children }
  })

  // ── Babylon integration ──────────────────────────────────────────

  function setBabylonScene(scene: BabylonScene | null): void {
    babylonScene.value = scene
    if (scene) {
      // Babylon skips camera.update() entirely when _skipRendering = true, so we drive it
      // manually here. This keeps ECS cameras' view matrices fresh each frame even
      // when they are not the rendered camera.
      scene.onBeforeRenderObservable.add(() => {
        if (!scene.activeCameras) return
        for (const cam of scene.activeCameras) {
          if ((cam as unknown as { _skipRendering: boolean })._skipRendering) {
            ;(cam as unknown as { update(): void }).update()
          }
        }
      })
    }
    // Dispose the old ModelManager and create a fresh one for the new scene.
    _modelManager.value?.disposeAll()
    _modelManager.value = scene ? new ModelManager(scene) : null
    // Wire the material store to the new Babylon scene so it can
    // (re)create Babylon material instances.
    import('@/stores/materialStore').then(({ useMaterialStore }) => {
      useMaterialStore().setBabylonScene(scene)
    })
    // Wire the texture store — disposes/recreates all Babylon Texture instances.
    import('@/stores/textureStore').then(({ useTextureStore }) => {
      useTextureStore().setBabylonScene(scene)
    })
    // Attach / detach the editor script system to the new scene.
    if (scene) {
      scriptEditorSystem.attach(scene)
    } else {
      scriptEditorSystem.detach()
    }
    // Sync settings on all loaded scenes whenever the Babylon scene connects/disconnects
    for (const nebuScene of scenes.value.values()) {
      nebuScene.settings.babylonScene = scene
      if (scene) nebuScene.settings.syncToBabylon()
    }
  }

  /**
   * Register the editor's ArcRotateCamera with the store.
   * It is added to scene.activeCameras with _skipRendering = false so it
   * keeps rendering normally while ECS cameras share the activeCameras list
   * (with _skipRendering = true) so their matrices are updated each frame.
   */
  function registerEditorCamera(cam: BabylonCamera): void {
    _editorCamera.value = cam
    const bScene = babylonScene.value
    if (!bScene) return
    ;(cam as unknown as { _skipRendering: boolean })._skipRendering = false
    bScene.activeCameras ??= []
    if (!bScene.activeCameras.includes(cam)) {
      bScene.activeCameras.push(cam)
    }
  }

  // ── Scene CRUD ───────────────────────────────────────────────────

  function createScene(name = 'New Scene'): NebuScene {
    // Dispose Babylon objects from the previous active scene before switching so
    // its meshes, lights, and transform nodes don't linger in the Babylon scene.
    const prev = activeScene.value
    if (prev) _disposeBabylonForScene(prev)

    const scene = new NebuScene(name)
    const map   = new Map(scenes.value)
    map.set(scene.guid, scene)
    scenes.value        = map
    activeSceneId.value = scene.guid

    // Wire Babylon settings (a brand-new scene has no entities yet)
    const bScene = babylonScene.value
    if (bScene) {
      scene.settings.babylonScene = bScene
      scene.settings.syncToBabylon()
    }

    bumpRevision()

    // Migrate plugin systems (e.g. HavokPhysicsSystem) from the old world to
    // the new one so they are active when play mode starts.
    if (prev) {
      import('@/stores/pluginStore').then(({ usePluginStore }) => {
        usePluginStore().notifyWorldChanged(prev.world, scene.world)
      })
    }

    return scene
  }

  function setActiveScene(guid: string): void {
    if (!scenes.value.has(guid)) return
    const prev   = activeScene.value
    const bScene = babylonScene.value

    // Dispose Babylon objects for the scene being deactivated.
    if (prev && prev.guid !== guid) _disposeBabylonForScene(prev)

    activeSceneId.value = guid

    // Re-wire Babylon objects for the scene being activated, but only when we
    // are actually switching from something.  When prev is null the scene was
    // just wired by loadSceneData and does not need a second pass.
    const next = scenes.value.get(guid)!
    if (prev && prev.guid !== guid && bScene) {
      _wireBabylonForScene(next, bScene)
      import('@/stores/scriptStore').then(({ useScriptStore }) => {
        useScriptStore().wireSceneEntities(next.world.entities.values(), bScene)
      })
      // Migrate plugin systems from the deactivated world to the activated one.
      const prevWorld = prev.world
      import('@/stores/pluginStore').then(({ usePluginStore }) => {
        usePluginStore().notifyWorldChanged(prevWorld, next.world)
      })
    }

    bumpRevision()
  }

  /**
   * Four-pass Babylon wiring for a NebuScene: transforms, then lights (so
   * shadow generators exist), then meshes (which register as shadow casters),
   * then cameras, then parent-child links.  Called by loadSceneData (freshly
   * deserialised scene) and setActiveScene (switching back to a cached scene).
   */
  function _wireBabylonForScene(nebuScene: NebuScene, bScene: BabylonScene): void {
    nebuScene.settings.babylonScene = bScene
    nebuScene.settings.syncToBabylon()

    // Pass 1: TransformNodes + lights (shadow generators must exist before meshes)
    for (const entity of nebuScene.world.entities.values()) {
      const transform = entity.getComponent<TransformComponent>('Transform')
      if (transform) {
        const node = new TransformNode(entity.id, bScene)
        node.name             = entity.name
        transform.babylonNode = node
        transform.syncToBabylon()
      }
      const light = entity.getComponent<LightComponent>('Light')
      if (light) _createBabylonLight(entity.id, light, bScene, nebuScene.world)
    }

    // Pass 2: meshes (can now register with shadow generators from pass 1)
    for (const entity of nebuScene.world.entities.values()) {
      const mesh = entity.getComponent<MeshComponent>('Mesh')
      if (mesh) _createBabylonMesh(entity.id, mesh, bScene, nebuScene.world)
    }

    // Pass 3: cameras (target-entity lookups now always succeed)
    for (const entity of nebuScene.world.entities.values()) {
      const camera = entity.getComponent<CameraComponent>('Camera')
      if (camera) _createBabylonCamera(entity.id, camera, bScene, nebuScene.world)
    }

    // Pass 4: parent-child (every TransformNode now exists)
    for (const entity of nebuScene.world.entities.values()) {
      if (!entity.parentId) continue
      const tfNode = entity.getComponent<TransformComponent>('Transform')?.babylonNode
      if (!tfNode) continue
      const parentTf = nebuScene.world.getEntity(entity.parentId)
        ?.getComponent<TransformComponent>('Transform')
      tfNode.parent = parentTf?.babylonNode ?? null
    }

    // Pass 5: animations (node & scene refs must exist)
    for (const entity of nebuScene.world.entities.values()) {
      const anim = entity.getComponent<AnimationComponent>('Animation')
      if (anim) {
        const node = entity.getComponent<TransformComponent>('Transform')?.babylonNode
        if (node) {
          anim._node = node
          anim.onCreate(bScene, nebuScene.world)
        }
      }
    }
  }

  /**
   * Dispose all Babylon objects owned by a NebuScene's entities and clean up
   * camera wiring subscriptions.  Does NOT remove the scene from the map —
   * callers are responsible for that.  Safe to call when babylonScene is null.
   */
  function _disposeBabylonForScene(nebuScene: NebuScene): void {
    for (const entity of nebuScene.world.entities.values()) {
      // Camera — deactivate runtime behaviors first, then dispose the Babylon camera
      const camComp = entity.getComponent<CameraComponent>('Camera')
      if (camComp) {
        camComp.onDispose()
        camComp.babylonCamera?.dispose()
        camComp.babylonCamera = null
        const w = _cameraWiring.get(entity.id)
        if (w) { w.cameraUnsub(); _cameraWiring.delete(entity.id) }
      }
      // Light + shadow generator
      const lightComp = entity.getComponent<LightComponent>('Light')
      if (lightComp) {
        lightComp.babylonShadowGenerator?.dispose()
        lightComp.babylonShadowGenerator = null
        lightComp.babylonLight?.dispose()
        lightComp.babylonLight      = null
        lightComp.onRebuildNeeded   = null
        const lw = _lightWiring.get(entity.id)
        if (lw) { lw.transformUnsub?.(); _lightWiring.delete(entity.id) }
      }
      // Mesh (procedural + model)
      const meshComp = entity.getComponent<MeshComponent>('Mesh')
      if (meshComp) {
        meshComp.babylonMesh?.dispose()
        meshComp.babylonMesh     = null
        meshComp.babylonModelMesh?.dispose()
        meshComp.babylonModelMesh = null
        meshComp.onRebuildNeeded = null
      }
      // Animation groups
      const animComp = entity.getComponent<AnimationComponent>('Animation')
      if (animComp) animComp.onDispose()

      // TransformNode — dispose last so cameras/meshes can still reference it as parent
      const transform = entity.getComponent<TransformComponent>('Transform')
      if (transform) {
        transform.babylonNode?.dispose()
        transform.babylonNode = null
      }
    }
  }

  function loadSceneData(data: SerializedScene): NebuScene {
    // Dispose and unregister the currently active scene before loading the new one
    // so its Babylon objects (meshes, lights, cameras, transform nodes) don't linger.
    const prev = activeScene.value
    if (prev) {
      _disposeBabylonForScene(prev)
      const prevMap = new Map(scenes.value)
      prevMap.delete(prev.guid)
      scenes.value        = prevMap
      activeSceneId.value = null
    }

    const scene  = NebuScene.deserialize(data)
    const bScene = babylonScene.value

    if (bScene) _wireBabylonForScene(scene, bScene)

    // Register + activate AFTER wiring so Vue computed watchers fire only once,
    // with fully-initialised entities (babylonNode etc. already set).
    const map = new Map(scenes.value)
    map.set(scene.guid, scene)
    scenes.value = map
    bumpRevision()

    // Wire any already-compiled script entries onto the freshly-deserialized
    // ScriptComponents.  _wireComponents only runs when a script compiles, so if
    // scripts were compiled before this scene was loaded (e.g. switching scenes)
    // the components would stay stuck at _entry=null ("Loading…") forever.
    import('@/stores/scriptStore').then(({ useScriptStore }) => {
      useScriptStore().wireSceneEntities(scene.world.entities.values(), bScene)
    })

    // Migrate plugin systems (e.g. HavokPhysicsSystem) from the old world to
    // the new one. Safe to call even when prev.world has already been GC'd from
    // the scenes map — World.removeSystem is a no-op if the system isn't found.
    if (prev) {
      import('@/stores/pluginStore').then(({ usePluginStore }) => {
        usePluginStore().notifyWorldChanged(prev.world, scene.world)
      })
    }

    return scene
  }

  // ── Entity CRUD ──────────────────────────────────────────────────

  function createEntity(name = 'Empty Entity', parentId: string | null = null): Entity {
    const scene = activeScene.value
    if (!scene) throw new Error('No active scene — open or create a scene first.')

    const entity    = scene.world.createEntity(name)
    entity.parentId = parentId

    // Assign sortOrder at end of existing siblings so new entities appear at bottom
    let maxOrder = -100
    for (const e of scene.world.entities.values()) {
      if (e.parentId === parentId && e.id !== entity.id && e.sortOrder > maxOrder)
        maxOrder = e.sortOrder
    }
    entity.sortOrder = maxOrder >= 0 ? maxOrder + 100 : 0

    // Wire up a Babylon TransformNode if a scene is available
    const bScene = babylonScene.value
    if (bScene) {
      const transform = entity.getComponent<TransformComponent>('Transform')
      if (transform) {
        const node       = new TransformNode(entity.id, bScene)
        node.name        = entity.name
        transform.babylonNode = node
        // Establish the Babylon parent link if this entity has a parent.
        _syncBabylonParent(entity.id)
      }
    }

    bumpRevision()
    return entity
  }

  function destroyEntity(id: string): void {
    const scene = activeScene.value
    if (!scene) return
    const entity = scene.world.getEntity(id)
    if (entity) {
        entity.getComponent<TransformComponent>('Transform')?.babylonNode?.dispose()
      const lightComp2 = entity.getComponent<LightComponent>('Light')
      if (lightComp2) {
        lightComp2.babylonShadowGenerator?.dispose()
        lightComp2.babylonShadowGenerator = null
        lightComp2.babylonLight?.dispose()
        lightComp2.babylonLight     = null
        lightComp2.onRebuildNeeded  = null
        const lw = _lightWiring.get(id)
        if (lw) { lw.transformUnsub?.(); _lightWiring.delete(id) }
      }
      const camComp = entity.getComponent<CameraComponent>('Camera')
      if (camComp) {
        camComp.babylonCamera?.dispose()
        const w = _cameraWiring.get(id)
        if (w) { w.cameraUnsub(); _cameraWiring.delete(id) }
      }
      const meshComp = entity.getComponent<MeshComponent>('Mesh')
      if (meshComp) {
        meshComp.babylonMesh?.dispose()
        meshComp.babylonMesh    = null
        meshComp.babylonModelMesh?.dispose()
        meshComp.babylonModelMesh = null
        meshComp.onRebuildNeeded = null
        if (meshComp.source === 'model' && meshComp.modelGuid) {
          _modelManager.value?.release(meshComp.modelGuid)
        }
      }
      // Notify all components that they are being removed.
      for (const comp of entity.components) comp.onRemove()
    }
    scene.world.destroyEntity(id)
    bumpRevision()
  }

  /**
   * Add a component to an entity and wire up any Babylon objects it needs.
   * Safe to call with any component type — unknown types are added without
   * Babylon wiring and can be given it later.
   */
  function addComponentToEntity(entityId: string, component: Component): void {
    const scene = activeScene.value
    if (!scene) return
    const entity = scene.world.getEntity(entityId)
    if (!entity) return

    entity.addComponent(component)

    const bScene = babylonScene.value
    if (bScene) {
      if (component.type === 'Light') {
        _createBabylonLight(entityId, component as LightComponent, bScene)
      } else if (component.type === 'Camera') {
        _createBabylonCamera(entityId, component as CameraComponent, bScene)
      } else if (component.type === 'Mesh') {
        _createBabylonMesh(entityId, component as MeshComponent, bScene)
      } else if (component.type === 'Animation') {
        const animComp = component as AnimationComponent
        const tf = entity.getComponent<TransformComponent>('Transform')
        if (tf?.babylonNode) {
          animComp._node = tf.babylonNode
          animComp.onCreate(bScene, scene.world)
        }
      } else if (component.type.startsWith('Script:')) {
        // Wire the compiled class entry (if already compiled) and activate editor instance.
        const sc = component as ScriptComponent
        import('@/stores/scriptStore').then(({ useScriptStore }) => {
          const entry = useScriptStore().getEntry(sc.scriptGuid)
          if (!entry) return
          sc._entry = entry
          // Populate defaults for any key not yet in propValues
          for (const def of (entry.cls.exposedProps ?? [])) {
            if (!(def.key in sc.propValues)) sc.propValues[def.key] = def.default ?? null
          }
          sc.notifyChanged()
          const scene  = activeScene.value
          const bScene = babylonScene.value
          if (!scene || !bScene) return
          const entity = scene.world.getEntity(entityId)
          if (entity) scriptEditorSystem.activateComponent(sc, entry, entity, scene.world, bScene)
        })
      }
    }

    bumpRevision()
  }

  /** Remove a component from an entity, disposing any Babylon objects it owns. */
  function removeComponentFromEntity(entityId: string, componentType: string): void {
    const scene = activeScene.value
    if (!scene) return
    const entity = scene.world.getEntity(entityId)
    if (!entity) return

    if (componentType === 'Light') {
      const lc = entity.getComponent<LightComponent>('Light')
      if (lc) {
        lc.babylonShadowGenerator?.dispose()
        lc.babylonShadowGenerator = null
        lc.babylonLight?.dispose()
        lc.babylonLight     = null
        lc.onRebuildNeeded  = null
      }
      const lw = _lightWiring.get(entityId)
      if (lw) { lw.transformUnsub?.(); _lightWiring.delete(entityId) }
    }
    if (componentType === 'Camera') {
      const camComp = entity.getComponent<CameraComponent>('Camera')
      if (camComp) {
        camComp.babylonCamera?.dispose()
        const w = _cameraWiring.get(entityId)
        if (w) { w.cameraUnsub(); _cameraWiring.delete(entityId) }
      }
    }
    if (componentType === 'Mesh') {
      const meshComp = entity.getComponent<MeshComponent>('Mesh')
      if (meshComp) {
        meshComp.babylonMesh?.dispose()
        meshComp.babylonMesh    = null
        meshComp.babylonModelMesh?.dispose()
        meshComp.babylonModelMesh = null
        meshComp.onRebuildNeeded = null
        if (meshComp.source === 'model' && meshComp.modelGuid) {
          _modelManager.value?.release(meshComp.modelGuid)
        }
      }
    }
    if (componentType === 'Animation') {
      const animComp = entity.getComponent<AnimationComponent>('Animation')
      if (animComp) animComp.onDispose()
    }
    if (componentType.startsWith('Script:')) {
      const sc = entity.getComponent<ScriptComponent>(componentType)
      if (sc) {
        scriptEditorSystem.destroyInstancesForScript(sc.scriptGuid)
        sc._instance = null
      }
    }

    // Allow the component to clean up any cross-entity side-effects.
    entity.getComponent(componentType)?.onRemove()

    entity.removeComponent(componentType)
    bumpRevision()
  }
  // ── Entity restore (for undo/redo) ────────────────────────────

  /**
   * Recreate a previously-serialized entity with its original id and all
   * components, then wire up any Babylon objects it needs.
   * Used exclusively by undo/redo commands — prefer createEntity() elsewhere.
   */
  function restoreEntity(snapshot: SerializedEntity): Entity {
    const scene = activeScene.value
    if (!scene) throw new Error('No active scene — cannot restore entity.')

    // createEntity always adds the 4 default components; we pass the id so the
    // entity is stored under its original GUID (important for hierarchy links).
    const entity    = scene.world.createEntity(snapshot.name, snapshot.id)
    entity.parentId  = snapshot.parentId
    entity.active    = snapshot.active
    entity.tags      = [...snapshot.tags]
    entity.sortOrder = snapshot.sortOrder ?? 0

    // Re-apply all serialised components (overwrites the defaults set above).
    for (const sc of snapshot.components) {
      const factory = getComponentFactory(sc.type)
      if (factory) entity.addComponent(factory(sc.data))
    }

    // Wire Babylon objects.
    const bScene = babylonScene.value
    if (bScene) {
      const transform = entity.getComponent<TransformComponent>('Transform')
      if (transform) {
        const node = new TransformNode(entity.id, bScene)
        node.name             = entity.name
        transform.babylonNode = node
        transform.syncToBabylon()
        // Establish the Babylon parent link now that the node exists.
        _syncBabylonParent(entity.id)
      }
      const light = entity.getComponent<LightComponent>('Light')
      if (light) _createBabylonLight(entity.id, light, bScene)
      const camera = entity.getComponent<CameraComponent>('Camera')
      if (camera) _createBabylonCamera(entity.id, camera, bScene)
      const mesh = entity.getComponent<MeshComponent>('Mesh')
      if (mesh) _createBabylonMesh(entity.id, mesh, bScene, activeScene.value?.world)
    }

    bumpRevision()
    return entity
  }
  // ── Babylon helpers ───────────────────────────────────────

  /**
   * Immediately apply the camera’s targetEntityId look-at to its Babylon camera.
   * Uses getAbsolutePosition() which forces a world matrix update.
   * Called from the target entity’s TransformComponent.onChange subscription.
   */
  function _createBabylonCamera(
    entityId: string,
    cam:      CameraComponent,
    bScene:   BabylonScene,
    world?:   import('@/core/ecs/World').World,
  ): void {
    // Clean up any existing wiring before recreating.
    const existing = _cameraWiring.get(entityId)
    if (existing) { existing.cameraUnsub(); _cameraWiring.delete(entityId) }

    // Dispose any existing Babylon camera for this component.
    // Note: Camera.dispose() automatically removes from bScene.activeCameras.
    cam.babylonCamera?.dispose()
    cam.babylonCamera = null

    const w = world ?? activeScene.value?.world
    const transformNode = w?.getEntity(entityId)?.getComponent<TransformComponent>('Transform')?.babylonNode ?? null

    if (cam.cameraType === 'UniversalCamera') {
      // Local position is (0,0,0) — the parent TransformNode carries world position.
      const uc = new UniversalCamera(entityId, Vector3.Zero(), bScene)
      uc.fov    = cam.fov
      uc.minZ   = cam.minZ
      uc.maxZ   = cam.maxZ
      uc.speed  = cam.speed
      uc.metadata = { isRuntimeCamera: true }
      uc.parent = transformNode
      cam.babylonCamera = uc
    } else {
      const arc = new ArcRotateCamera(
        entityId,
        cam.alpha,
        cam.beta,
        cam.radius,
        new Vector3(cam.target.x, cam.target.y, cam.target.z),
        bScene,
      )
      arc.fov  = cam.fov
      arc.minZ = cam.minZ
      arc.maxZ = cam.maxZ
      arc.metadata = { isRuntimeCamera: true }
      arc.parent = transformNode
      cam.babylonCamera = arc
    }

    // Add to activeCameras with _skipRendering = true so Babylon keeps this camera's
    // matrices updated each frame (via the onBeforeRenderObservable in setBabylonScene)
    // without issuing any extra draw calls.
    const ecsCam = cam.babylonCamera!
    ;(ecsCam as unknown as { _skipRendering: boolean })._skipRendering = true
    bScene.activeCameras ??= []
    if (!bScene.activeCameras.includes(ecsCam)) {
      bScene.activeCameras.push(ecsCam)
    }

    // Set up static store callbacks.
    cam.onMainCameraSet   = () => _enforceMainCamera(entityId)
    cam.onCameraTypeChanged = () => {
      const bS = babylonScene.value
      if (bS) _createBabylonCamera(entityId, cam, bS)
    }

    // Register wiring entry — only needs the onChange unsub for
    // isMainCamera / cameraType changes. Target look-at is owned by the component.
    const wiring = { cameraUnsub: (() => {}) as () => void }
    _cameraWiring.set(entityId, wiring)
    wiring.cameraUnsub = cam.onChange(() => { /* isMainCamera / cameraType handled via callbacks */ })

    // Hand off to the component to set up its own target-look-at wiring.
    if (w && bScene) cam.onCreate(bScene, w)
  }

  /** Un-flag isMainCamera on every camera component except the one given.  */
  function _enforceMainCamera(entityId: string): void {
    const scene = activeScene.value
    if (!scene) return
    for (const entity of scene.world.entities.values()) {
      if (entity.id === entityId) continue
      const c = entity.getComponent<CameraComponent>('Camera')
      if (c && c.isMainCamera) {
        c.isMainCamera = false
        c.notifyChanged()
      }
    }
    bumpRevision()
  }

  /**
   * Return the camera component that should be active at runtime.
   * Prefers the one with `isMainCamera = true`; falls back to the first found.
   * Returns null when no camera components exist in the active scene.
   */
  function getPlayCamera(): CameraComponent | null {
    worldRevision.value    // establish reactive dependency
    const scene = activeScene.value
    if (!scene) return null
    let first: CameraComponent | null = null
    for (const entity of scene.world.entities.values()) {
      if (!entity.active) continue
      const cam = entity.getComponent<CameraComponent>('Camera')
      if (!cam) continue
      if (!first) first = cam
      if (cam.isMainCamera) return cam
    }
    return first
  }

  /** True when the scene has at least one active camera component. */
  const hasCameraForPlay = computed(() => getPlayCamera() !== null)

  function _createBabylonLight(
    entityId: string,
    light:    LightComponent,
    bScene:   BabylonScene,
    world?:   import('@/core/ecs/World').World,
  ): void {
    // Clean up any existing transform subscription for this light.
    const existingLightWiring = _lightWiring.get(entityId)
    existingLightWiring?.transformUnsub?.()

    light.babylonShadowGenerator?.dispose()
    light.babylonShadowGenerator = null
    light.babylonLight?.dispose()
    light.babylonLight   = null
    light.onRebuildNeeded = () => _rebuildBabylonLight(entityId, light, bScene)
    _rebuildBabylonLight(entityId, light, bScene, world)

    // Subscribe to TransformComponent changes so the Babylon light position
    // stays in sync whenever the entity is moved (e.g. via a gizmo).
    // Use the provided world (during load) or fall back to activeScene (at runtime).
    const w  = world ?? activeScene.value?.world
    const tf = w?.getEntity(entityId)?.getComponent<TransformComponent>('Transform')
    const wiring = { transformUnsub: null as (() => void) | null }
    _lightWiring.set(entityId, wiring)
    if (tf && light.lightType !== 'Hemispheric') {
      wiring.transformUnsub = tf.onChange(() => _syncLightTransform(entityId, light))
    }
  }

  /**
   * Dispose any existing Babylon light + shadow generator, then create fresh
   * ones based on the current LightComponent data.  Called on initial wiring
   * and on every syncToBabylon() (inspector write).
   */
  function _rebuildBabylonLight(
    entityId: string,
    light:    LightComponent,
    bScene:   BabylonScene,
    world?:   import('@/core/ecs/World').World,
  ): void {
    light.babylonShadowGenerator?.dispose()
    light.babylonShadowGenerator = null
    light.babylonLight?.dispose()
    light.babylonLight = null

    switch (light.lightType) {
      case 'Hemispheric': {
        const l = new HemisphericLight(
          entityId,
          new Vector3(light.direction.x, light.direction.y, light.direction.z),
          bScene,
        )
        l.intensity   = light.intensity
        l.diffuse     = new Color3(light.diffuse.r,     light.diffuse.g,     light.diffuse.b)
        l.specular    = new Color3(light.specular.r,    light.specular.g,    light.specular.b)
        l.groundColor = new Color3(light.groundColor.r, light.groundColor.g, light.groundColor.b)
        light.babylonLight = l
        break
      }
      case 'Directional': {
        const l = new DirectionalLight(
          entityId,
          new Vector3(light.direction.x, light.direction.y, light.direction.z),
          bScene,
        )
        l.intensity = light.intensity
        l.diffuse   = new Color3(light.diffuse.r,  light.diffuse.g,  light.diffuse.b)
        l.specular  = new Color3(light.specular.r, light.specular.g, light.specular.b)
        light.babylonLight = l
        break
      }
      case 'Spot': {
        const l = new SpotLight(
          entityId,
          new Vector3(light.position.x,  light.position.y,  light.position.z),
          new Vector3(light.direction.x, light.direction.y, light.direction.z),
          light.angle,
          light.exponent,
          bScene,
        )
        l.intensity = light.intensity
        l.diffuse   = new Color3(light.diffuse.r,  light.diffuse.g,  light.diffuse.b)
        l.specular  = new Color3(light.specular.r, light.specular.g, light.specular.b)
        light.babylonLight = l
        break
      }
      case 'Point': {
        const l = new PointLight(
          entityId,
          new Vector3(light.position.x, light.position.y, light.position.z),
          bScene,
        )
        l.intensity = light.intensity
        l.diffuse   = new Color3(light.diffuse.r,  light.diffuse.g,  light.diffuse.b)
        l.specular  = new Color3(light.specular.r, light.specular.g, light.specular.b)
        light.babylonLight = l
        break
      }
    }

    // ── Shadow generator ──────────────────────────────────────────
    if (light.castShadows && light.lightType !== 'Hemispheric' && light.babylonLight) {
      let sg: ShadowGenerator
      // Use the static IsSupported getter Babylon exposes for exactly this guard.
      // The CSM constructor calls `return` early (not `throw`) when unsupported, which
      // causes a ReferenceError in derived-class constructors — calling the static first
      // prevents ever reaching `new CascadedShadowGenerator()` on unsupported engines.
      const csmSupported = light.lightType === 'Directional'
        && light.useCascadedShadows
        && CascadedShadowGenerator.IsSupported
      if (csmSupported) {
        const csg = new CascadedShadowGenerator(
          light.shadowMapSize,
          light.babylonLight as DirectionalLight,
        )
        csg.numCascades = Math.max(2, Math.min(4, light.numCascades)) as 2 | 3 | 4
        sg = csg
      } else {
        // SpotLight, PointLight, and DirectionalLight (without CSM) all
        // implement IShadowLight; TypeScript can't infer this via a union
        // type import, so we cast through any here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sg = new ShadowGenerator(light.shadowMapSize, light.babylonLight as any)
      }
      light.babylonShadowGenerator = sg

      // ── Apply shared ShadowGenerator settings ──────────────────
      sg.bias               = light.shadowBias
      sg.normalBias         = light.shadowNormalBias
      sg.darkness           = light.shadowDarkness
      sg.transparencyShadow = light.shadowTransparency
      sg.filter             = light.shadowFilter
      // ESM-specific depth scale (filters 1, 3, 4, 5)
      if ([1, 3, 4, 5].includes(light.shadowFilter)) {
        sg.depthScale = light.shadowDepthScale
      }
      // Blur-specific (filters 3, 5)
      if ([3, 5].includes(light.shadowFilter)) {
        sg.useKernelBlur = true
        sg.blurKernel    = light.shadowBlurKernel
        sg.blurScale     = light.shadowBlurScale
      }
      // PCSS-specific (filter 7)
      if (light.shadowFilter === 7) {
        sg.contactHardeningLightSizeUVRatio = light.shadowContactHardeningLightSize
      }
      // CSM-specific extras
      if (sg instanceof CascadedShadowGenerator) {
        sg.lambda                 = light.csmLambda
        sg.cascadeBlendPercentage = light.csmCascadeBlendPercentage
        sg.depthClamp             = light.csmDepthClamp
        sg.autoCalcDepthBounds    = light.csmAutoCalcDepthBounds
      }

      // Register all existing shadow-casting meshes with the new generator.
      _registerCastersWithGenerator(sg, world)
    }

    // Sync world position from the entity's TransformComponent.
    // Babylon lights (Directional/Spot/Point) cannot be parented to TransformNodes,
    // so we push position explicitly each time the light is rebuilt.
    _syncLightTransform(entityId, light, world)
  }

  // ── Shadow helpers ─────────────────────────────────────────────

  /**
   * Apply receiveShadows + castShadows flags to ALL Babylon meshes owned by
   * a MeshComponent (primitive `babylonMesh` AND model `babylonModelMesh`).
   * Registers with every active ShadowGenerator in the world.
   */
  function _applyShadows(
    mesh:   MeshComponent,
    world?: import('@/core/ecs/World').World,
  ): void {
    const wld = world ?? activeScene.value?.world
    // Collect all Babylon meshes owned by this component
    const targets: AbstractMesh[] = []
    if (mesh.babylonMesh) targets.push(mesh.babylonMesh)
    if (mesh.babylonModelMesh) {
      targets.push(mesh.babylonModelMesh, ...mesh.babylonModelMesh.getChildMeshes(false))
    }
    if (targets.length === 0) return

    for (const child of targets) {
      child.receiveShadows = mesh.receiveShadows
    }
    if (mesh.castShadows && wld) {
      for (const e of wld.entities.values()) {
        const lc = e.getComponent<LightComponent>('Light')
        if (lc?.babylonShadowGenerator) {
          for (const child of targets) {
            lc.babylonShadowGenerator.addShadowCaster(
              child as import('@babylonjs/core').Mesh, true,
            )
          }
        }
      }
    }
  }

  /**
   * Register all shadow-casting meshes with a newly created ShadowGenerator.
   */
  function _registerCastersWithGenerator(
    sg:     ShadowGenerator,
    world?: import('@/core/ecs/World').World,
  ): void {
    const wld = world ?? activeScene.value?.world
    if (!wld) return
    for (const e of wld.entities.values()) {
      const mc = e.getComponent<MeshComponent>('Mesh')
      if (!mc?.castShadows) continue
      const targets: AbstractMesh[] = []
      if (mc.babylonMesh) targets.push(mc.babylonMesh)
      if (mc.babylonModelMesh) {
        targets.push(mc.babylonModelMesh, ...mc.babylonModelMesh.getChildMeshes(false))
      }
      for (const child of targets) {
        sg.addShadowCaster(child as import('@babylonjs/core').Mesh, true)
      }
    }
  }

  // ── Mesh helpers ───────────────────────────────────────────────

  /**
   * Wire a MeshComponent to the Babylon scene: install the rebuild callback
   * and perform the initial geometry build.
   */
  function _createBabylonMesh(
    entityId: string,
    mesh:     MeshComponent,
    bScene:   BabylonScene,
    world?:   import('@/core/ecs/World').World,
  ): void {
    // Dispose any pre-existing Babylon mesh (e.g. after undo restore).
    mesh.babylonMesh?.dispose()
    mesh.babylonMesh    = null
    mesh.babylonModelMesh?.dispose()
    mesh.babylonModelMesh = null
    // onRebuildNeeded runs while the scene is active — activeScene.value is always valid then.
    mesh.onRebuildNeeded = () => _rebuildMesh(entityId, mesh, bScene)
    _rebuildMesh(entityId, mesh, bScene, world)
  }

  /**
   * Dispose the existing Babylon mesh for `mesh` and create a fresh one
   * using MeshBuilder based on the current meshType + options.
   * The parent TransformNode (if any) and material are applied after creation.
   */
  function _rebuildMesh(
    entityId: string,
    mesh:     MeshComponent,
    bScene:   BabylonScene,
    world?:   import('@/core/ecs/World').World,
  ): void {
    mesh.babylonMesh?.dispose()
    mesh.babylonMesh = null
    mesh.babylonModelMesh?.dispose()
    mesh.babylonModelMesh = null

    const w      = world ?? activeScene.value?.world
    const tfNode = w?.getEntity(entityId)
      ?.getComponent<TransformComponent>('Transform')
      ?.babylonNode ?? null

    // ── Model source — load via ModelManager ───────────────────────────────
    if (mesh.source === 'model') {
      if (!mesh.modelGuid) return
      const mgr = _modelManager.value
      if (!mgr) return

      // Resolve file → blob URL → acquire from ModelManager.
      // If the model is already cached in the ModelManager, skip the file
      // system read and blob URL creation entirely — they're unnecessary when
      // acquire() would return a cache hit anyway.
      Promise.all([
        import('@/stores/assetStore'),
        import('@/stores/projectStore'),
        import('@/stores/materialStore'),
        import('@/lib/fs/FileSystemService'),
      ]).then(async ([{ useAssetStore }, { useProjectStore }, { useMaterialStore }, { fileSystemService }]) => {
        const assetStore  = useAssetStore()
        const entry       = assetStore.getAsset(mesh.modelGuid!)
        const matStore    = useMaterialStore()
        if (!entry) return

        const ext = '.' + entry.relativePath.split('.').pop()!.toLowerCase()

        // Build a mapping: original material name → extracted MaterialDef GUID
        // so cloned meshes can be assigned the project's materials.
        const matNameToGuid = new Map<string, string>()
        if (entry.meta.modelInfo?.extractedMaterials) {
          for (const em of entry.meta.modelInfo.extractedMaterials) {
            matNameToGuid.set(em.name, em.guid)
          }
        }

        /** Apply project materials to a mesh and all its child meshes.
         *  Disposes the temporary cloned materials that instantiateModelsToScene created. */
        function _applyExtractedMaterials(root: import('@babylonjs/core').AbstractMesh | import('@babylonjs/core').TransformNode): void {
          const prefix = `${entityId}_`
          const allMeshes = root.getChildMeshes(false)
          if ('material' in root && root.material !== undefined) {
            allMeshes.unshift(root as import('@babylonjs/core').AbstractMesh)
          }
          for (const child of allMeshes) {
            // 1. Per-entity material override takes priority
            if (mesh.materialId) {
              const bMat = matStore.getBabylonMaterial(mesh.materialId)
              if (bMat) {
                const old = child.material; child.material = bMat; old?.dispose(); continue
              }
            }
            // 2. Extracted material by original name.
            //    cloneMaterials=true prefixes names via the nameFunction,
            //    so strip the entityId prefix to recover the original mat name.
            const rawName = child.material?.name ?? ''
            const origName = rawName.startsWith(prefix) ? rawName.slice(prefix.length) : rawName
            const guid = matNameToGuid.get(origName)
            if (guid) {
              const bMat = matStore.getBabylonMaterial(guid)
              if (bMat) { const old = child.material; child.material = bMat; old?.dispose() }
            }
          }
        }

        try {
          // Fast path: if the model is already cached, skip disk I/O entirely.
          let modelEntry = mgr.getEntry(mesh.modelGuid!)
          if (!modelEntry) {
            const dirHandle = useProjectStore().directoryHandle
            if (!dirHandle) return
            const file    = await fileSystemService.readAsFile(dirHandle, `assets/${entry.relativePath}`)
            const blobUrl = URL.createObjectURL(file)
            try {
              modelEntry = await mgr.acquire(mesh.modelGuid!, blobUrl, ext)
            } finally {
              URL.revokeObjectURL(blobUrl)
            }
          } else {
            modelEntry.refCount++
          }

          // ── Decomposed submesh — clone a single named mesh ──────────
          if (mesh.submeshName) {
            const target = modelEntry.container.meshes.find(
              m => m.name === mesh.submeshName,
            ) as import('@babylonjs/core').Mesh | undefined
            if (target && typeof target.clone === 'function') {
              const clone = target.clone(`${entityId}_${mesh.submeshName}`, null)
              if (clone) {
                // Reset local transform — the entity's TransformNode provides it
                clone.position.set(0, 0, 0)
                clone.rotation.set(0, 0, 0)
                clone.scaling.set(1, 1, 1)
                clone.parent           = tfNode
                mesh.babylonModelMesh  = clone
                _applyExtractedMaterials(clone)
              }
            }
          } else {
            // ── Full model ────────────────────────────────────────────
            switch (mesh.instanceMode) {
            case 'base': {
              // instantiateModelsToScene with cloneMaterials=true gives each
              // clone its own material copies.  doNotInstantiate=true creates
              // real Mesh clones (not InstancedMesh) so .material is writable.
              // We then replace the cloned temp materials with our project ones.
              const result = modelEntry.container.instantiateModelsToScene(
                n => `${entityId}_${n}`,
                true,   // clone materials — each clone gets its own copy
                { doNotInstantiate: true },
              )
              const rootNode = result.rootNodes[0]
              if (rootNode) {
                rootNode.parent       = tfNode
                mesh.babylonModelMesh = rootNode as import('@babylonjs/core').AbstractMesh
                _applyExtractedMaterials(rootNode as import('@babylonjs/core').AbstractMesh)
              }
              break
            }
            case 'instance': {
              const base = modelEntry.baseMesh
              if (base instanceof Mesh) {
                const inst = base.createInstance(`${entityId}_inst`)
                inst.parent           = tfNode
                mesh.babylonModelMesh = inst
              } else {
                // Only a full Mesh can be instanced; fall back to the base mesh.
                console.warn('[sceneStore] instance mode needs a Mesh, got', base.getClassName())
                mesh.babylonModelMesh = base
              }
              break
            }
            case 'thinInstance': {
              // thinInstance requires a world matrix; build from tfNode or identity.
              const { Matrix: BjsMatrix } = await import('@babylonjs/core')
              const mat = tfNode
                ? tfNode.getWorldMatrix()
                : BjsMatrix.Identity()
              const base = modelEntry.baseMesh
              if (base instanceof Mesh) {
                base.thinInstanceAdd(mat)
              } else {
                console.warn('[sceneStore] thinInstance mode needs a Mesh, got', base.getClassName())
              }
              // For editor selection, keep a reference to the base mesh.
              mesh.babylonModelMesh = base
              break
            }
          }
          } // end else (full model)

          // Apply shadow flags to all descendant meshes
          _applyShadows(mesh, w)

          console.log('[sceneStore] Model loaded for entity', entityId,
            '| babylonModelMesh:', mesh.babylonModelMesh?.name ?? '(null)',
            '| submesh:', mesh.submeshName ?? '(full model)')

          // Notify any Collider component on this entity that the mesh is now
          // available.  The HavokPhysicsSystem version-key mechanism will detect
          // the change on the next frame and build the physics body — this is
          // the timing guarantee that physics is held until the model is ready.
          const colliderComp = w?.getEntity(entityId)?.getComponent('Collider')
          if (colliderComp) {
            console.log('[sceneStore] Notifying Collider on', entityId, 'that model mesh is ready')
            colliderComp.notifyChanged()
          }
        } catch (err) {
          console.error('[sceneStore] Failed to load model for entity', entityId, err)
        }
      }).catch(err => console.error('[sceneStore] Model import error for entity', entityId, err))
      return
    }

    let newMesh: import('@babylonjs/core').Mesh | null = null
    const name = entityId  // use entity ID as the Babylon mesh name

    switch (mesh.meshType) {
      case 'Box':
        newMesh = MeshBuilder.CreateBox(name, {
          width:           mesh.boxOptions.width,
          height:          mesh.boxOptions.height,
          depth:           mesh.boxOptions.depth,
          sideOrientation: mesh.boxOptions.sideOrientation,
        }, bScene)
        break
      case 'Sphere':
        newMesh = MeshBuilder.CreateSphere(name, {
          diameter:        mesh.sphereOptions.diameter,
          segments:        mesh.sphereOptions.segments,
          sideOrientation: mesh.sphereOptions.sideOrientation,
        }, bScene)
        break
      case 'Cylinder':
        newMesh = MeshBuilder.CreateCylinder(name, {
          height:          mesh.cylinderOptions.height,
          diameterTop:     mesh.cylinderOptions.diameterTop,
          diameterBottom:  mesh.cylinderOptions.diameterBottom,
          tessellation:    mesh.cylinderOptions.tessellation,
          sideOrientation: mesh.cylinderOptions.sideOrientation,
        }, bScene)
        break
      case 'Capsule':
        newMesh = MeshBuilder.CreateCapsule(name, {
          height:       mesh.capsuleOptions.height,
          radius:       mesh.capsuleOptions.radius,
          tessellation: mesh.capsuleOptions.tessellation,
          subdivisions: mesh.capsuleOptions.subdivisions,
        }, bScene)
        break
      case 'Torus':
        newMesh = MeshBuilder.CreateTorus(name, {
          diameter:        mesh.torusOptions.diameter,
          thickness:       mesh.torusOptions.thickness,
          tessellation:    mesh.torusOptions.tessellation,
          sideOrientation: mesh.torusOptions.sideOrientation,
        }, bScene)
        break
      case 'TorusKnot':
        newMesh = MeshBuilder.CreateTorusKnot(name, {
          radius:         mesh.torusKnotOptions.radius,
          tube:           mesh.torusKnotOptions.tube,
          radialSegments: mesh.torusKnotOptions.radialSegments,
          tubularSegments:mesh.torusKnotOptions.tubularSegments,
          p:              mesh.torusKnotOptions.p,
          q:              mesh.torusKnotOptions.q,
        }, bScene)
        break
      case 'Ground':
        newMesh = MeshBuilder.CreateGround(name, {
          width:        mesh.groundOptions.width,
          height:       mesh.groundOptions.height,
          subdivisions: mesh.groundOptions.subdivisions,
        }, bScene)
        break
      case 'Plane':
        newMesh = MeshBuilder.CreatePlane(name, {
          width:           mesh.planeOptions.width,
          height:          mesh.planeOptions.height,
          sideOrientation: mesh.planeOptions.sideOrientation,
        }, bScene)
        break
      case 'Disc':
        newMesh = MeshBuilder.CreateDisc(name, {
          radius:          mesh.discOptions.radius,
          tessellation:    mesh.discOptions.tessellation,
          sideOrientation: mesh.discOptions.sideOrientation,
        }, bScene)
        break
      case 'IcoSphere':
        newMesh = MeshBuilder.CreateIcoSphere(name, {
          radius:       mesh.icoSphereOptions.radius,
          subdivisions: mesh.icoSphereOptions.subdivisions,
          flat:         mesh.icoSphereOptions.flat,
        }, bScene)
        break
      case 'Polyhedron':
        newMesh = MeshBuilder.CreatePolyhedron(name, {
          type: mesh.polyhedronOptions.type,
          size: mesh.polyhedronOptions.size,
        }, bScene)
        break
      case 'TiledPlane':
        newMesh = MeshBuilder.CreateTiledPlane(name, {
          tileWidth:       mesh.tiledPlaneOptions.tileWidth,
          tileHeight:      mesh.tiledPlaneOptions.tileHeight,
          width:           mesh.tiledPlaneOptions.width,
          height:          mesh.tiledPlaneOptions.height,
          sideOrientation: mesh.tiledPlaneOptions.sideOrientation,
        }, bScene)
        break
      case 'TiledBox':
        newMesh = MeshBuilder.CreateTiledBox(name, {
          width:      mesh.tiledBoxOptions.width,
          height:     mesh.tiledBoxOptions.height,
          depth:      mesh.tiledBoxOptions.depth,
          tileWidth:  mesh.tiledBoxOptions.tileWidth,
          tileHeight: mesh.tiledBoxOptions.tileHeight,
        }, bScene)
        break
      case 'TiledGround':
        newMesh = MeshBuilder.CreateTiledGround(name, {
          xmin:         mesh.tiledGroundOptions.xmin,
          zmin:         mesh.tiledGroundOptions.zmin,
          xmax:         mesh.tiledGroundOptions.xmax,
          zmax:         mesh.tiledGroundOptions.zmax,
          subdivisions: mesh.tiledGroundOptions.subdivisions,
          precision:    mesh.tiledGroundOptions.precision,
        }, bScene)
        break
    }

    if (!newMesh) return
    newMesh.parent          = tfNode
    mesh.babylonMesh        = newMesh

    // Apply receiveShadows + castShadows and register with all generators.
    _applyShadows(mesh, w)

    // Apply material from materialStore if one is assigned.
    if (mesh.materialId) {
      import('@/stores/materialStore').then(({ useMaterialStore }) => {
        const bMat = useMaterialStore().getBabylonMaterial(mesh.materialId!)
        if (bMat && mesh.babylonMesh) mesh.babylonMesh.material = bMat
      })
    }

    // For model meshes: apply material override to all child meshes.
    if (mesh.materialId && mesh.babylonModelMesh) {
      import('@/stores/materialStore').then(({ useMaterialStore }) => {
        const bMat = useMaterialStore().getBabylonMaterial(mesh.materialId!)
        if (!bMat || !mesh.babylonModelMesh) return
        const children = mesh.babylonModelMesh.getChildMeshes(false)
        if ('material' in mesh.babylonModelMesh) {
          children.unshift(mesh.babylonModelMesh as import('@babylonjs/core').AbstractMesh)
        }
        for (const child of children) {
          child.material = bMat
        }
      })
    }
  }

  function renameEntity(id: string, name: string): void {
    const scene  = activeScene.value
    if (!scene) return
    const entity = scene.world.getEntity(id)
    if (!entity) return
    entity.name = name
    const transform = entity.getComponent<TransformComponent>('Transform')
    if (transform?.babylonNode) transform.babylonNode.name = name
    bumpRevision()
  }

  function setEntityActive(id: string, active: boolean): void {
    const scene  = activeScene.value
    if (!scene) return
    const entity = scene.world.getEntity(id)
    if (!entity) return
    entity.active = active
    bumpRevision()
  }

  /** Returns true if `potentialAncestorId` is an ancestor of `entityId`. */
  function isAncestorOf(entityId: string, potentialAncestorId: string): boolean {
    const scene = activeScene.value
    if (!scene) return false
    let current = scene.world.getEntity(entityId)
    while (current && current.parentId !== null) {
      if (current.parentId === potentialAncestorId) return true
      current = scene.world.getEntity(current.parentId)
    }
    return false
  }

  /**
   * Sync a Babylon TransformNode's parent to match the entity's current parentId.
   * Called whenever entity.parentId changes so the Babylon scene hierarchy
   * stays in lockstep with the ECS hierarchy.
   *
   * @param preserveWorld - When true (editor drag/reparent), uses setParent() so the
   *   entity keeps its current world-space position and local coords are recomputed.
   *   When false (scene load / undo-restore), uses direct parent assignment so the
   *   already-localised serialised transform data is kept as-is.
   */
  function _syncBabylonParent(entityId: string, preserveWorld = false): void {
    const scene = activeScene.value
    if (!scene) return
    const entity = scene.world.getEntity(entityId)
    if (!entity) return
    const transform = entity.getComponent<TransformComponent>('Transform')
    const tfNode    = transform?.babylonNode
    if (!tfNode) return

    const newParent = entity.parentId === null
      ? null
      : (scene.world.getEntity(entity.parentId)
          ?.getComponent<TransformComponent>('Transform')?.babylonNode ?? null)

    if (preserveWorld) {
      // setParent() re-expresses the current world transform in the new parent's
      // local space so the entity stays visually in place.
      tfNode.setParent(newParent)
      // setParent may have set rotationQuaternion during matrix decomposition;
      // convert back to Euler so the rest of the codebase stays consistent.
      if (tfNode.rotationQuaternion) {
        const euler = tfNode.rotationQuaternion.toEulerAngles()
        tfNode.rotation.copyFrom(euler)
        tfNode.rotationQuaternion = null
      }
      // Bring the ECS data in sync with the new local coordinates so the
      // inspector shows correct values immediately.
      // The TransformComponent proxy reads directly from babylonNode, so no
      // explicit copy is needed — just notify Vue to re-render.
      if (transform) {
        transform.notifyChanged()
      }
    } else {
      // Direct assignment keeps existing local coords intact (correct for
      // serialised data that was already stored in local space).
      tfNode.parent = newParent
    }
  }

  function reparentEntity(id: string, newParentId: string | null): void {
    const scene = activeScene.value
    if (!scene) return
    const entity = scene.world.getEntity(id)
    if (!entity) return
    // Prevent self-parenting or cycle
    if (newParentId === id) return
    if (newParentId && isAncestorOf(newParentId, id)) return
    entity.parentId = newParentId
    _syncBabylonParent(id, true)
    bumpRevision()
  }

  function cloneEntity(sourceId: string, newParentId: string | null = null, name?: string): Entity {
    const scene = activeScene.value
    if (!scene) throw new Error('No active scene.')
    const source = scene.world.getEntity(sourceId)
    if (!source) throw new Error(`Entity ${sourceId} not found.`)

    // Serialize every persistent component from the source
    const components = [...source.components]
      .filter(c => c.persistent)
      .map(c => ({ type: c.type, data: c.serialize() }))

    // Build a snapshot with a fresh GUID so restoreEntity creates a new entity
    const snapshot: SerializedEntity = {
      id:        generateGuid(),
      name:      name ?? `${source.name} (Copy)`,
      parentId:  newParentId ?? source.parentId,
      sortOrder: source.sortOrder,
      tags:      [...source.tags],
      active:    source.active,
      components,
    }

    // restoreEntity deserializes all components and wires all Babylon objects
    return restoreEntity(snapshot)
  }

  /**
   * Reorder an entity relative to another entity (insert before or after it).
   * Also reparents the entity to the relative entity’s parent if they differ.
   * Renumbers all sibling sortOrders (multiples of 100) after placement.
   */
  function reorderEntity(entityId: string, relativeId: string, insertBefore: boolean): void {
    const scene = activeScene.value
    if (!scene) return
    const entity   = scene.world.getEntity(entityId)
    const relative = scene.world.getEntity(relativeId)
    if (!entity || !relative) return

    entity.parentId = relative.parentId  // reparent to same level if needed
    _syncBabylonParent(entityId, true)

    // Build an ordered siblings list excluding the entity being moved
    const siblings = [...scene.world.entities.values()]
      .filter(e => e.parentId === relative.parentId && e.id !== entityId)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    const relIdx    = siblings.findIndex(e => e.id === relativeId)
    const insertIdx = relIdx >= 0 ? (insertBefore ? relIdx : relIdx + 1) : siblings.length
    siblings.splice(insertIdx, 0, entity)
    siblings.forEach((e, i) => { e.sortOrder = i * 100 })
    bumpRevision()
  }

  /** Restore parentId + sortOrder for a set of entities (used by undo). */
  function restoreEntityParentsAndSortOrders(
    snapshot: { id: string; parentId: string | null; sortOrder: number }[]
  ): void {
    const scene = activeScene.value
    if (!scene) return
    for (const { id, parentId, sortOrder } of snapshot) {
      const e = scene.world.getEntity(id)
      if (e) { e.parentId = parentId; e.sortOrder = sortOrder }
    }
    // Re-sync all Babylon parents after restoring the full snapshot so ordering
    // of parent/child doesn't matter (every entity exists before we re-parent).
    for (const { id } of snapshot) _syncBabylonParent(id, true)
    bumpRevision()
  }

  /**
   * Instantiate a prefab entity list into the active scene under `parentId`.
   *
   * `entities` should be the raw array from a `SerializedPrefab` — this
   * function remaps all GUIDs to fresh ones so every instantiation is
   * independent.  Uses three-pass Babylon wiring (same as loadSceneData) so
   * cameras that look at other entities in the prefab are always resolved.
   *
   * Returns the newly created root entities (those whose parentId matches the
   * injected `parentId`), which the caller can select in the editor.
   */
  function instantiatePrefab(
    entities:   SerializedEntity[],
    parentId:   string | null,
    prefabGuid  = '',
    prefabName  = '',
  ): Entity[] {
    const scene = activeScene.value
    if (!scene) return []
    const world  = scene.world
    const bScene = babylonScene.value

    // Remap all entity GUIDs to fresh ones and re-root to parentId.
    const remapped = remapPrefabEntities(entities, parentId)

    // Determine sortOrder for the incoming root entities (appended after siblings).
    let nextSortOrder = 0
    for (const e of world.entities.values()) {
      if (e.parentId === parentId && e.sortOrder >= nextSortOrder) nextSortOrder = e.sortOrder + 100
    }

    const created: Entity[] = []

    // Pass 1: create entity records + wire Transform / Light / Mesh Babylon objects.
    for (const se of remapped) {
      const entity    = world.createEntity(se.name, se.id)
      entity.parentId  = se.parentId
      entity.active    = se.active
      entity.tags      = [...se.tags]
      entity.sortOrder = se.parentId === parentId ? (nextSortOrder += 100, nextSortOrder - 100) : (se.sortOrder ?? 0)

      for (const sc of se.components) {
        const factory = getComponentFactory(sc.type)
        if (factory) entity.addComponent(factory(sc.data))
      }

      // Stamp a PrefabInstance marker on every root entity of this instantiation.
      if (prefabGuid && se.parentId === parentId) {
        entity.addComponent(new PrefabInstanceComponent(prefabGuid, prefabName))
      }

      if (bScene) {
        const transform = entity.getComponent<TransformComponent>('Transform')
        if (transform) {
          const node = new TransformNode(entity.id, bScene)
          node.name             = entity.name
          transform.babylonNode = node
          transform.syncToBabylon()
        }
        const light = entity.getComponent<LightComponent>('Light')
        if (light) _createBabylonLight(entity.id, light, bScene)
        const mesh = entity.getComponent<MeshComponent>('Mesh')
        if (mesh) _createBabylonMesh(entity.id, mesh, bScene, world)
      }

      created.push(entity)
    }

    // Pass 2: wire cameras (need all TransformNodes to exist first).
    if (bScene) {
      for (const entity of created) {
        const camera = entity.getComponent<CameraComponent>('Camera')
        if (camera) _createBabylonCamera(entity.id, camera, bScene, world)
      }
    }

    // Pass 3: wire Babylon parent-child links.
    if (bScene) {
      for (const entity of created) {
        const tfNode = entity.getComponent<TransformComponent>('Transform')?.babylonNode
        if (!tfNode) continue
        if (!entity.parentId) { tfNode.parent = null; continue }
        // Parent may be a pre-existing scene entity or another entity from this prefab.
        const parentTf = world.getEntity(entity.parentId)?.getComponent<TransformComponent>('Transform')
        tfNode.parent = parentTf?.babylonNode ?? null
      }
    }

    bumpRevision()
    return created
  }

  // ── Play mode ────────────────────────────────────────────────────

  /** Snapshot of the world taken at play-start, used to restore on stop. */
  let _playSnapshot:  SerializedWorld | null = null
  let _playObserver:  Nullable<Observer<BabylonScene>> = null
  let _playRuntimeSystem: ScriptRuntimeSystem | null = null

  /**
   * Enter play mode:
   * - Snapshot the current world so it can be restored on stop.
   * - Switch editor camera to non-rendering.
   * - Promote the runtime play camera to rendered.
   * - Optionally attach input controls to the play camera.
   * - Call world.onStart() to kick off ECS systems.
   */
  function enterPlayMode(): void {
    const scene  = activeScene.value
    const bScene = babylonScene.value
    if (!scene || !bScene) return

    const playCam = getPlayCamera()
    if (!playCam?.babylonCamera) return

    // Snapshot the world before any runtime changes occur.
    _playSnapshot = scene.world.serialize()

    // Stop the editor camera from issuing draw calls.
    if (_editorCamera.value) {
      ;(_editorCamera.value as unknown as { _skipRendering: boolean })._skipRendering = true
      _editorCamera.value.detachControl()
    }

    // Promote the play camera to the sole render camera.
    ;(playCam.babylonCamera as unknown as { _skipRendering: boolean })._skipRendering = false
    if (playCam.attachControls) {
      playCam.babylonCamera.attachControl(bScene.getEngine().getRenderingCanvas()!, true)
    }

    // ── Runtime camera target observable now handled by CameraComponent ──
    // Activate camera runtime behaviors
    playCam.onCreate(bScene, scene.world)

    // Register built-in ECS systems before any onStart() call.
    scene.world.addSystem(new AnimationSystem())

    // Register the script runtime system before any onStart() call so scripts
    // participate in the same phase as all other systems.
    const scriptRuntime = new ScriptRuntimeSystem(bScene)
    _playRuntimeSystem = scriptRuntime
    scene.world.addSystem(scriptRuntime)

    // Start ECS — calls onStart() on every registered system.
    scene.world.onStart()

    // Tick world.onUpdate(dt) every frame via the Babylon render loop.
    let _lastTime = performance.now()
    _playObserver = bScene.onBeforeRenderObservable.add(() => {
      const now = performance.now()
      const dt  = (now - _lastTime) * 0.001
      _lastTime = now
      scene.world.onUpdate(dt)
    })
  }

  /**
   * Exit play mode:
   * - Stop the per-frame world-update tick so no more onUpdate calls fire.
   * - Call world.onShutdown() FIRST so scripts' onDestroy can still access live
   *   Babylon objects (meshes, transforms, scene) — they haven't been disposed yet.
   * - Dispose ECS-owned Babylon objects AFTER scripts have finished cleaning up.
   * - Rebuild the world from the pre-play snapshot.
   * - Restore the editor camera.
   */
  function exitPlayMode(): void {
    const scene  = activeScene.value
    const bScene = babylonScene.value
    if (!scene || !bScene || !_playSnapshot) return

    // ── Step 1: stop per-frame world ticking ──────────────────────────────
    // Remove BEFORE onShutdown so onUpdate doesn't fire during teardown.
    if (_playObserver) {
      bScene.onBeforeRenderObservable.remove(_playObserver)
      _playObserver = null
    }

    // ── Step 2: clean up camera + light wiring subscriptions ──────────────
    for (const wiring of _cameraWiring.values()) {
      wiring.cameraUnsub()
    }
    _cameraWiring.clear()
    for (const lw of _lightWiring.values()) lw.transformUnsub?.()
    _lightWiring.clear()

    // ── Step 3: shut down ECS systems ────────────────────────────────────
    // Snapshot entities BEFORE onShutdown — onShutdown calls entities.clear(),
    // so we need the list captured now to iterate for Babylon disposal below.
    // Scripts' onDestroy still fires with all Babylon objects alive because
    // the Babylon disposal only happens in Step 4, after onShutdown returns.
    const playEntities = [...scene.world.entities.values()]
    scene.world.onShutdown()

    // Remove the play-mode runtime system so it doesn't accumulate on re-entry.
    if (_playRuntimeSystem) {
      scene.world.removeSystem(_playRuntimeSystem)
      _playRuntimeSystem = null
    }

    // ── Step 4: dispose ECS-owned Babylon objects ─────────────────────────
    // Scripts have already finished their onDestroy; tear down Babylon-side objects.
    for (const entity of playEntities) {
      // Camera (dispose() auto-removes from activeCameras)
      const camComp = entity.getComponent<CameraComponent>('Camera')
      if (camComp) {
        // Deactivate camera runtime behaviors
        camComp.onDispose()
        camComp.babylonCamera?.dispose()
        camComp.babylonCamera = null
      }
      // Light + shadow generator
      const lightComp = entity.getComponent<LightComponent>('Light')
      if (lightComp) {
        lightComp.babylonShadowGenerator?.dispose()
        lightComp.babylonShadowGenerator = null
        lightComp.babylonLight?.dispose()
        lightComp.babylonLight      = null
        lightComp.onRebuildNeeded   = null
      }
      // Mesh (procedural + model)
      const meshComp = entity.getComponent<MeshComponent>('Mesh')
      if (meshComp) {
        meshComp.babylonMesh?.dispose()
        meshComp.babylonMesh    = null
        meshComp.babylonModelMesh?.dispose()
        meshComp.babylonModelMesh = null
        meshComp.onRebuildNeeded = null
      }
      // TransformNode (dispose last — cameras/meshes may reference it as parent)
      const tfComp = entity.getComponent<TransformComponent>('Transform')
      if (tfComp) {
        tfComp.babylonNode?.dispose()
        tfComp.babylonNode = null
      }
    }

    // ── Step 4: rebuild world from snapshot ──
    const snapshot = _playSnapshot
    _playSnapshot  = null
    _restoreWorldFromSnapshot(snapshot.entities)

    // ── Step 5: re-engage the editor camera ──
    if (_editorCamera.value) {
      ;(_editorCamera.value as unknown as { _skipRendering: boolean })._skipRendering = false
      _editorCamera.value.attachControl(bScene.getEngine().getRenderingCanvas()!, true)
    }
  }

  /**
   * Rebuild the active scene's world in-place from a serialized entity array.
   * Two-pass to ensure cameras can find target-entity TransformNodes.
   * Called exclusively by exitPlayMode.
   */
  function _restoreWorldFromSnapshot(snapshotEntities: SerializedEntity[]): void {
    const bScene = babylonScene.value
    const scene  = activeScene.value
    if (!bScene || !scene) return
    const world = scene.world

    // Pass 1: create entities and wire Transform / Light / Mesh Babylon objects.
    for (const se of snapshotEntities) {
      const entity    = world.createEntity(se.name, se.id)
      entity.parentId  = se.parentId
      entity.active    = se.active
      entity.tags      = [...se.tags]
      entity.sortOrder = se.sortOrder ?? 0

      for (const sc of se.components) {
        const factory = getComponentFactory(sc.type)
        if (factory) entity.addComponent(factory(sc.data))
      }

      const transform = entity.getComponent<TransformComponent>('Transform')
      if (transform) {
        const node = new TransformNode(entity.id, bScene)
        node.name             = entity.name
        transform.babylonNode = node
        transform.syncToBabylon()
      }
      const light = entity.getComponent<LightComponent>('Light')
      if (light) _createBabylonLight(entity.id, light, bScene)
      const mesh = entity.getComponent<MeshComponent>('Mesh')
      if (mesh) _createBabylonMesh(entity.id, mesh, bScene, world)
    }

    // Pass 2: wire cameras now that all TransformNodes exist.
    for (const se of snapshotEntities) {
      const entity = world.getEntity(se.id)
      if (!entity) continue
      const camera = entity.getComponent<CameraComponent>('Camera')
      if (camera) _createBabylonCamera(entity.id, camera, bScene, world)
    }

    // Pass 3: establish Babylon parent-child links now that every TransformNode
    // exists. Use direct parent assignment (not setParent) because positions are
    // already stored in local space.
    for (const se of snapshotEntities) {
      if (!se.parentId) continue
      const entity = world.getEntity(se.id)
      if (!entity) continue
      const tfNode = entity.getComponent<TransformComponent>('Transform')?.babylonNode
      if (!tfNode) continue
      const parentTf = world.getEntity(se.parentId)
        ?.getComponent<TransformComponent>('Transform')
      tfNode.parent = parentTf?.babylonNode ?? null
    }

    bumpRevision()

    // Re-wire already-compiled script entries — freshly deserialized components
    // have _entry=null until wired, which shows "Loading…" in the inspector.
    import('@/stores/scriptStore').then(({ useScriptStore }) => {
      useScriptStore().wireSceneEntities(scene.world.entities.values(), bScene)
    })
  }

  return {
    scenes,
    activeSceneId,
    activeScene,
    entityList,
    hierarchy,
    babylonScene,
    setBabylonScene,
    editorCamera: _editorCamera,
    registerEditorCamera,
    createScene,
    setActiveScene,
    loadSceneData,
    createEntity,
    destroyEntity,
    renameEntity,
    setEntityActive,
    reparentEntity,
    cloneEntity,
    addComponentToEntity,
    removeComponentFromEntity,
    restoreEntity,
    bumpRevision,
    getPlayCamera,
    hasCameraForPlay,
    enterPlayMode,
    exitPlayMode,
    reorderEntity,
    restoreEntityParentsAndSortOrders,
    instantiatePrefab,
  }
})
