<template>
  <div class="flex flex-col items-center gap-1.5 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-overlay)]">
    <div class="flex items-center gap-2 w-full">
      <canvas
        ref="canvasRef"
        width="128"
        height="128"
        class="rounded border border-[var(--color-border)] shrink-0 block"
        style="width: 128px; height: 128px;"
      />
      <div class="flex flex-col gap-1 flex-1 min-w-0">
        <span class="text-xs font-medium text-[var(--color-text-primary)] truncate">{{ material.name }}</span>
        <span class="text-[10px] text-[var(--color-text-muted)]">{{ material.matType }} Material</span>
        <span v-if="capturing" class="text-[10px] text-[var(--color-accent)] italic">Capturing preview…</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  MeshBuilder, Vector3, Color3, Color4,
  StandardMaterial, PBRMaterial, Texture,
} from '@babylonjs/core'
import type { Mesh as BabylonMesh } from '@babylonjs/core'
import type { MaterialDef } from '@/core/materials/MaterialDef'
import { useAssetStore } from '@/stores/assetStore'
import { useProjectStore } from '@/stores/projectStore'
import { fileSystemService } from '@/lib/fs/FileSystemService'

const props = defineProps<{ material: MaterialDef }>()
const emit  = defineEmits<{ preview: [dataUrl: string] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const capturing = ref(false)

let engine:          Engine | null        = null
let scene:           Scene  | null        = null
let captureTimer:    ReturnType<typeof setTimeout> | null = null
let unsub:           (() => void)  | null = null

// ── Scene boot ────────────────────────────────────────────────────

async function boot(canvas: HTMLCanvasElement): Promise<void> {
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  scene  = new Scene(engine)
  scene.clearColor = new Color4(0.11, 0.11, 0.13, 1)

  // Camera
  const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 3, Vector3.Zero(), scene)
  camera.lowerRadiusLimit = camera.upperRadiusLimit = 3

  // Lights
  const hemi    = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemi.intensity = 0.8
  const dir      = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene)
  dir.intensity  = 0.65

  // Preview sphere
  const sphere  = MeshBuilder.CreateSphere('sphere', { diameter: 1.8, segments: 48 }, scene)
  await _applyToMesh(sphere, scene)

  engine.runRenderLoop(() => scene?.render())

  scheduleCapture()
}

// ── Material application ──────────────────────────────────────────

/** Cache of blob URLs created for preview textures. Cleaned up on dispose. */
const _previewBlobUrls = new Map<string, string>()

/**
 * Resolve a texture GUID into a Babylon Texture in the preview scene.
 * Reads the file from the project directory to create an independent texture.
 */
async function _resolveTexture(guid: string | null, sc: Scene): Promise<Texture | null> {
  if (!guid) return null

  // Try to create a blob URL from the project file on disk
  const assetStore  = useAssetStore()
  const entry       = assetStore.assetList.find(e => e.meta.guid === guid)
  if (!entry) return null

  // Reuse an already-created blob URL for this GUID
  let url = _previewBlobUrls.get(guid)
  if (!url) {
    const dirHandle = useProjectStore().directoryHandle
    if (!dirHandle) return null
    try {
      const file = await fileSystemService.readAsFile(dirHandle, `assets/${entry.relativePath}`)
      url = URL.createObjectURL(file)
      _previewBlobUrls.set(guid, url)
    } catch { return null }
  }

  return new Texture(url, sc, false, true, Texture.BILINEAR_SAMPLINGMODE)
}

async function _applyToMesh(mesh: BabylonMesh, sc: Scene): Promise<void> {
  mesh.material?.dispose()

  const def = props.material

  switch (def.matType) {
    case 'Standard':
    case 'Custom': {
      const p = def.matType === 'Standard' ? def.standardProps : def.customProps
      const m = new StandardMaterial('preview_mat', sc)
      m.diffuseColor  = new Color3(p.diffuseColor.r,  p.diffuseColor.g,  p.diffuseColor.b)
      m.specularColor = new Color3(p.specularColor.r, p.specularColor.g, p.specularColor.b)
      m.emissiveColor = new Color3(p.emissiveColor.r, p.emissiveColor.g, p.emissiveColor.b)
      m.ambientColor  = new Color3(p.ambientColor.r,  p.ambientColor.g,  p.ambientColor.b)
      m.specularPower = p.specularPower
      m.alpha         = p.alpha
      // Texture channels
      m.diffuseTexture    = await _resolveTexture(p.diffuseTextureId,    sc)
      m.ambientTexture    = await _resolveTexture(p.ambientTextureId,    sc)
      m.opacityTexture    = await _resolveTexture(p.opacityTextureId,    sc)
      m.emissiveTexture   = await _resolveTexture(p.emissiveTextureId,   sc)
      m.specularTexture   = await _resolveTexture(p.specularTextureId,   sc)
      m.bumpTexture       = await _resolveTexture(p.bumpTextureId,       sc)
      m.reflectionTexture = await _resolveTexture(p.reflectionTextureId, sc)
      m.lightmapTexture   = await _resolveTexture(p.lightmapTextureId,   sc)
      mesh.material   = m
      break
    }
    case 'PBR':
    case 'PBRCustom': {
      const p = def.matType === 'PBR' ? def.pbrProps : def.pbrCustomProps
      const m = new PBRMaterial('preview_mat', sc)
      m.albedoColor       = new Color3(p.albedoColor.r,       p.albedoColor.g,       p.albedoColor.b)
      m.reflectivityColor = new Color3(p.reflectivityColor.r, p.reflectivityColor.g, p.reflectivityColor.b)
      m.emissiveColor     = new Color3(p.emissiveColor.r,     p.emissiveColor.g,     p.emissiveColor.b)
      m.metallic          = p.metallic
      m.roughness         = p.roughness
      m.alpha             = p.alpha
      // Texture channels
      m.albedoTexture       = await _resolveTexture(p.albedoTextureId,       sc)
      m.bumpTexture         = await _resolveTexture(p.bumpTextureId,         sc)
      m.metallicTexture     = await _resolveTexture(p.metallicTextureId,     sc)
      m.emissiveTexture     = await _resolveTexture(p.emissiveTextureId,     sc)
      m.ambientTexture      = await _resolveTexture(p.ambientTextureId,      sc)
      m.opacityTexture      = await _resolveTexture(p.opacityTextureId,      sc)
      m.reflectionTexture   = await _resolveTexture(p.reflectionTextureId,   sc)
      m.lightmapTexture     = await _resolveTexture(p.lightmapTextureId,     sc)
      m.reflectivityTexture = await _resolveTexture(p.reflectivityTextureId, sc)
      m.microSurfaceTexture = await _resolveTexture(p.microSurfaceTextureId, sc)
      mesh.material       = m
      break
    }
    default: {
      const m = new StandardMaterial('preview_mat', sc)
      m.diffuseColor = new Color3(0.6, 0.6, 0.6)
      mesh.material  = m
    }
  }
}

// ── Rebuild + capture ─────────────────────────────────────────────

async function rebuild(): Promise<void> {
  const sc = scene
  if (!sc) return
  const mesh = sc.getMeshByName('sphere') as BabylonMesh | null
  if (!mesh) return
  await _applyToMesh(mesh, sc)
  scheduleCapture()
}

function scheduleCapture(): void {
  if (captureTimer !== null) clearTimeout(captureTimer)
  capturing.value = true
  captureTimer = setTimeout(() => {
    captureTimer = null
    const canvas = canvasRef.value
    if (!canvas || !scene) { capturing.value = false; return }
    // Force two frames so textures have time to upload to GPU
    scene.render()
    scene.render()
    const dataUrl = canvas.toDataURL('image/webp', 0.9)
    capturing.value = false
    emit('preview', dataUrl)
  }, 250)
}

// ── Lifecycle ─────────────────────────────────────────────────────

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  boot(canvas)
  unsub = props.material.onChange(() => rebuild())
})

onUnmounted(() => {
  if (captureTimer !== null) { clearTimeout(captureTimer); captureTimer = null }
  unsub?.()
  unsub = null
  engine?.stopRenderLoop()
  scene?.dispose()
  engine?.dispose()
  engine = null
  scene  = null
  // Revoke all created blob URLs
  for (const url of _previewBlobUrls.values()) URL.revokeObjectURL(url)
  _previewBlobUrls.clear()
})

watch(() => props.material, (newMat) => {
  unsub?.()
  unsub = newMat.onChange(() => rebuild())
  rebuild()
})
</script>
