<template>
  <!-- BabylonViewport — Babylon.js 8 canvas mounted here -->
  <div ref="containerRef" class="w-full h-full relative bg-[#181820]">
    <canvas ref="canvasRef" class="w-full h-full outline-none" />

    <!-- Overlay info (FPS) -->
    <div class="absolute top-2 left-2 flex items-center gap-2 text-[11px] text-[var(--color-text-muted)] pointer-events-none select-none">
      <span>{{ fps }} fps</span>
    </div>

    <!-- Play mode border indicator -->
    <div
      v-if="editorStore.isPlaying"
      class="absolute inset-0 pointer-events-none border-2 border-[var(--color-danger)]"
    />

    <!-- Camera-axis orientation gizmo (bottom-right corner) -->
    <ViewportCameraAxis v-if="sceneRef && editorStore.showCameraAxis && !editorStore.isPlaying" :scene="sceneRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, shallowRef } from 'vue'
import { Engine, WebGPUEngine, Scene, ArcRotateCamera, HemisphericLight, Vector3, Color4 } from '@babylonjs/core'
import type { Observer } from '@babylonjs/core'
import { useSceneStore }         from '@/stores/sceneStore'
import { useLayerStore }         from '@/stores/layerStore'
import { useEditorStore }        from '@/stores/editorStore'
import { useProjectStore }       from '@/stores/projectStore'
import { useEngineCapabilities } from '@/composables/useEngineCapabilities'
import { useEditorGizmos }       from '@/composables/useEditorGizmos'
import { resolveActiveEngine }   from '@/lib/resolveEngine'
import { RenderLayer }           from '@/core/layers/RenderLayer'
import { ViewportWidgets }       from '@/core/scene/ViewportWidgets'
import ViewportCameraAxis from './ViewportCameraAxis.vue'

const canvasRef    = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const fps          = ref(0)

const engineRef  = shallowRef<Engine | WebGPUEngine | null>(null)
const sceneRef   = shallowRef<Scene | null>(null)
const cameraRef  = shallowRef<ArcRotateCamera | null>(null)
const lightRef   = shallowRef<HemisphericLight | null>(null)
const widgetsRef = shallowRef<ViewportWidgets | null>(null)
let   renderLayer: RenderLayer | null = null

// Editor transform gizmos (select/translate/rotate/scale toolbar tools)
useEditorGizmos(sceneRef)

let resizeObs:   ResizeObserver | null = null
let flyObserver: Observer<Scene> | null = null

// Fly-mode state — window-level, no canvas focus or RMB required
const _flyKeys       = new Set<string>()
let   _canvasHovered = false
let _flyKeyDown:   ((e: KeyboardEvent) => void) | null = null
let _flyKeyUp:     ((e: KeyboardEvent) => void) | null = null
let _wheelHandler: ((e: WheelEvent)   => void) | null = null

const editorStore  = useEditorStore()
const sceneStore   = useSceneStore()
const projectStore = useProjectStore()
const { supported } = useEngineCapabilities()

// ── Helpers ───────────────────────────────────────────────────────────────

// ── Watchers ──────────────────────────────────────────────────────────────

// React to grid/axis toggle changes whenever widgets are ready
watch(() => editorStore.showGrid,      v => widgetsRef.value?.setGridVisible(v))
watch(() => editorStore.showWorldAxis, v => widgetsRef.value?.setWorldAxisVisible(v))

// Hide editor viewport widgets during play mode; restore on stop.
watch(() => editorStore.isPlaying, (playing) => {
  if (!widgetsRef.value) return
  widgetsRef.value.setGridVisible(!playing && editorStore.showGrid)
  widgetsRef.value.setWorldAxisVisible(!playing && editorStore.showWorldAxis)
  // Flush all widget entries on every mode transition so the widget map stays
  // in sync with the Babylon scene, regardless of watcher ordering.
  widgetsRef.value.syncWidgets([])
  // On stop: immediately rebuild using the already-restored entity list.
  // (exitPlayMode runs synchronously before isPlaying is set to false, so
  // sceneStore.entityList is already the post-restore list by the time
  // this watcher fires.)
  if (!playing) widgetsRef.value.syncWidgets(sceneStore.entityList)
})

// Sync component widgets whenever entities or components are added/removed
watch(() => sceneStore.entityList, list => widgetsRef.value?.syncWidgets(list))

// ── Viewport settings watchers ─────────────────────────────────────────────

watch(() => editorStore.viewportPrefs.cameraNearClip, v => { if (cameraRef.value) cameraRef.value.minZ = v })
watch(() => editorStore.viewportPrefs.cameraFarClip,  v => { if (cameraRef.value) cameraRef.value.maxZ = v })
watch(() => editorStore.viewportPrefs.lightIntensity, v => { if (lightRef.value) lightRef.value.intensity = v })
watch(
  () => [editorStore.viewportPrefs.lightDirX, editorStore.viewportPrefs.lightDirY, editorStore.viewportPrefs.lightDirZ] as const,
  ([x, y, z]) => { if (lightRef.value) lightRef.value.direction = new Vector3(x, y, z) },
)

onMounted(async () => {
  const canvas      = canvasRef.value!
  const layerStore  = useLayerStore()

  // Resolve which engine to use: project targets ∩ browser capabilities
  const projectTargets = projectStore.meta?.engineTargets ?? ['webgl1', 'webgl2', 'webgpu']
  const target = resolveActiveEngine([...supported.value], projectTargets) ?? 'webgl1'

  // Engine
  let engine: Engine | WebGPUEngine
  if (target === 'webgpu') {
    const gpuEngine = new WebGPUEngine(canvas, {
      antialias: true,
      stencil: true,
    })
    await gpuEngine.initAsync()
    engine = gpuEngine
  } else {
    engine = new Engine(canvas, target === 'webgl2', {
      preserveDrawingBuffer: true,
      stencil:               true,
      antialias:             true,
      disableWebGL2Support:  target === 'webgl1',
    })
  }
  engineRef.value = engine

  // Scene
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.09, 0.09, 0.12, 1)
  sceneRef.value = scene

  // Register with scene store before any entity creation
  sceneStore.setBabylonScene(scene)

  // Activate any plugins that were deferred until Babylon was ready.
  // This is async but we do not await it here — plugins initialise in the
  // background while the viewport continues mounting.  Physics won't be
  // active until the first frame after the await resolves, which is fine.
  void projectStore.activatePendingPlugins()

  // Editor camera — not an ECS entity; flagged so play-mode ignores it.
  const camera = new ArcRotateCamera('__editor_cam', -Math.PI / 2, Math.PI / 3, 12, Vector3.Zero(), scene)
  camera.attachControl(canvas, true)

  // Replace the built-in scroll-zoom with dolly (translate target along the forward axis).
  // This keeps radius constant so orbit behaviour is unchanged; only the pivot moves.
  camera.inputs.removeByType('ArcRotateCameraMouseWheelInput')
  _wheelHandler = (e: WheelEvent): void => {
    if (editorStore.isPlaying) return
    e.preventDefault()
    const cam = cameraRef.value
    if (!cam) return
    // forward = unit vector from camera position toward its orbit target
    const forward = cam.target.subtract(cam.position).normalize()
    // Speed scales with radius so the feel is consistent at any distance
    const delta = -Math.sign(e.deltaY) * cam.radius * 0.1
    cam.target.addInPlace(forward.scaleInPlace(delta))
  }
  canvas.addEventListener('wheel', _wheelHandler, { passive: false })

  camera.minZ = editorStore.viewportPrefs.cameraNearClip
  camera.maxZ = editorStore.viewportPrefs.cameraFarClip
  camera.metadata = { isEditorCamera: true }
  cameraRef.value = camera
  // Register with sceneStore so it is added to scene.activeCameras alongside ECS cameras.
  sceneStore.registerEditorCamera(camera)

  // Editor ambient light — not an ECS entity; flagged so play-mode ignores it.
  const light = new HemisphericLight('__editor_hemi', new Vector3(
    editorStore.viewportPrefs.lightDirX,
    editorStore.viewportPrefs.lightDirY,
    editorStore.viewportPrefs.lightDirZ,
  ), scene)
  light.intensity = editorStore.viewportPrefs.lightIntensity
  light.metadata  = { isEditorLight: true }
  lightRef.value  = light

  // Editor viewport widgets (grid + world axis + light indicators) — not ECS entities
  const widgets = new ViewportWidgets(scene)
  widgets.setGridVisible(editorStore.showGrid)
  widgets.setWorldAxisVisible(editorStore.showWorldAxis)
  widgetsRef.value = widgets

  // Initial widget sync (handles the case where a scene is already loaded)
  widgets.syncWidgets(sceneStore.entityList)

  // Create a default scene in the store if none exists
  if (!sceneStore.activeScene) {
    sceneStore.createScene('Main Scene')
  }

  // FPS counter — read from engine after each tick
  engine.onEndFrameObservable.add(() => {
    fps.value = Math.round(engine.getFps())
  })

  // ── WASD fly mode ───────────────────────────────────────────────────────
  // Mouse hovering the viewport + WASD moves the ArcRotateCamera target.
  // No RMB required. Gates on canvas hover so panel text inputs still work.

  canvas.addEventListener('mouseenter', () => { _canvasHovered = true  })
  canvas.addEventListener('mouseleave', () => { _canvasHovered = false; _flyKeys.clear() })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  // Window-level key tracking so no DOM focus is needed
  _flyKeyDown = (e: KeyboardEvent): void => {
    if (!_canvasHovered) return
    if (editorStore.isPlaying) return   // let Babylon scripts own keyboard in play mode
    _flyKeys.add(e.code)
    // Prevent WASD from switching editor tools while hovering the viewport
    if (['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(e.code)) {
      e.stopImmediatePropagation()
      e.preventDefault()
    }
  }
  _flyKeyUp = (e: KeyboardEvent): void => { _flyKeys.delete(e.code) }

  window.addEventListener('keydown', _flyKeyDown,  { capture: true })
  window.addEventListener('keyup',   _flyKeyUp)

  flyObserver = scene.onBeforeRenderObservable.add(() => {
    if (!_canvasHovered || _flyKeys.size === 0) return
    // Don't move camera when a text input or textarea has focus (user is typing in a panel)
    const tag = (document.activeElement as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    const w = _flyKeys.has('KeyW'), s = _flyKeys.has('KeyS')
    const a = _flyKeys.has('KeyA'), d = _flyKeys.has('KeyD')
    if (!w && !s && !a && !d) return

    const dt    = (engine as Engine).getDeltaTime() / 1000
    const boost = (_flyKeys.has('ShiftLeft') || _flyKeys.has('ShiftRight')) ? 4 : 1
    const speed = camera.radius * editorStore.viewportPrefs.flySpeed * 2 * dt * boost

    // W/S: move along the camera's true 3D forward (target - position)
    const fwd3D = Vector3.Normalize(camera.target.subtract(camera.position))
    if (fwd3D.lengthSquared() < 1e-8) return

    // A/D: strafe using the horizontal right vector (always XZ-plane aligned)
    const right = Vector3.Cross(fwd3D, Vector3.Up()).normalize()

    // Move ArcRotateCamera by shifting its pivot target — position follows automatically
    if (w) camera.target.addInPlace(fwd3D.scale( speed))
    if (s) camera.target.addInPlace(fwd3D.scale(-speed))
    if (a) camera.target.addInPlace(right.scale( speed))
    if (d) camera.target.addInPlace(right.scale(-speed))
  }) as Observer<Scene>

  // Push RenderLayer — this starts the render loop via the LayerStack.
  renderLayer = new RenderLayer(engine as Engine, scene, layerStore.stack)
  layerStore.pushLayer(renderLayer)

  // Responsive resize via ResizeObserver (avoids event spam).
  resizeObs = new ResizeObserver(() => engine.resize())
  resizeObs.observe(containerRef.value!)
})

onUnmounted(() => {
  const layerStore = useLayerStore()

  if (renderLayer) {
    layerStore.popLayer(renderLayer)
    renderLayer = null
  }

  widgetsRef.value?.dispose()
  widgetsRef.value = null

  if (flyObserver && sceneRef.value) {
    sceneRef.value.onBeforeRenderObservable.remove(flyObserver)
    flyObserver = null
  }
  if (_flyKeyDown)  { window.removeEventListener('keydown', _flyKeyDown, { capture: true }); _flyKeyDown   = null }
  if (_flyKeyUp)    { window.removeEventListener('keyup',   _flyKeyUp);                       _flyKeyUp     = null }
  if (_wheelHandler) {
    canvasRef.value?.removeEventListener('wheel', _wheelHandler)
    _wheelHandler = null
  }
  _flyKeys.clear()

  sceneStore.setBabylonScene(null)
  resizeObs?.disconnect()
  sceneRef.value?.dispose()
  engineRef.value?.dispose()
})

// Expose scene for external use (e.g. ECS integration)
defineExpose({ scene: sceneRef, engine: engineRef })
</script>
