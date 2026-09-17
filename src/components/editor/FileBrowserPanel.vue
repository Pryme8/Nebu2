<template>
  <div
    class="flex flex-col h-full relative"
    @dragover.prevent="onPanelDragOver"
    @dragleave="onPanelDragLeave"
    @drop.prevent="onPanelDrop"
  >
    <!-- Drop overlay for plain image import -->
    <div
      v-if="isDraggingImages"
      class="absolute inset-0 z-50 flex items-center justify-center pointer-events-none
             border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/10 rounded"
    >
      <span class="text-xs text-[var(--color-accent)] font-medium">Drop image to import as Texture Asset</span>
    </div>

    <!-- Drop overlay for model files -->
    <div
      v-if="isDraggingModels"
      class="absolute inset-0 z-50 flex items-center justify-center pointer-events-none
             border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/10 rounded"
    >
      <span class="text-xs text-[var(--color-accent)] font-medium">Drop model to import (.glb / .gltf / .fbx / …)</span>
    </div>

    <!-- Drop overlay for entity/scene → prefab -->
    <div
      v-if="isDraggingEntities"
      class="absolute inset-0 z-50 flex items-center justify-center pointer-events-none
             border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/10 rounded"
    >
      <span class="text-xs text-[var(--color-accent)] font-medium">Drop on a folder to save as Prefab</span>
    </div>

    <!-- ── Header toolbar ─────────────────────────────────────── -->
    <div class="flex items-center h-7 px-2 gap-1 border-b border-[var(--color-border)] panel-elevated shrink-0 select-none">
      <BaseIcon name="folder" :size="12" class="text-[var(--color-text-muted)] shrink-0" />
      <span class="flex-1 text-xs font-medium truncate text-[var(--color-text-secondary)]">
        {{ projectStore.projectName ?? 'Files' }}
      </span>

      <!-- New scene in root scenes/ folder -->
      <BaseButton
        variant="ghost" size="xs"
        title="New Scene"
        @click="startCreate('scene')"
      >
        <BaseIcon name="scene" :size="12" />
        <BaseIcon name="add" :size="9" class="-ml-0.5 -mt-1" />
      </BaseButton>

      <!-- New folder at root -->
      <BaseButton
        variant="ghost" size="xs"
        title="New Folder"
        @click="startCreate('folder')"
      >
        <BaseIcon name="folder" :size="12" />
        <BaseIcon name="add" :size="9" class="-ml-0.5 -mt-1" />
      </BaseButton>

      <!-- New material at root -->
      <BaseButton
        variant="ghost" size="xs"
        title="New Material"
        @click="startCreate('material')"
      >
        <BaseIcon name="material" :size="12" />
        <BaseIcon name="add" :size="9" class="-ml-0.5 -mt-1" />
      </BaseButton>

      <!-- New script at root -->
      <BaseButton
        v-if="projectStore.isOpen"
        variant="ghost" size="xs"
        title="New Script"
        @click="startCreate('script')"
      >
        <BaseIcon name="script" :size="12" />
        <BaseIcon name="add" :size="9" class="-ml-0.5 -mt-1" />
      </BaseButton>

      <!-- Import texture -->
      <BaseButton
        v-if="projectStore.isOpen"
        variant="ghost" size="xs"
        title="Import Texture"
        @click="triggerTextureImport"
      >
        <BaseIcon name="texture" :size="12" />
        <BaseIcon name="add" :size="9" class="-ml-0.5 -mt-1" />
      </BaseButton>
      <input ref="textureInputRef" type="file" class="hidden" multiple accept="image/*" @change="onTextureFileSelected" />

      <!-- Import model -->
      <BaseButton
        v-if="projectStore.isOpen"
        variant="ghost" size="xs"
        title="Import Model (.glb, .gltf, .fbx, .obj …)"
        @click="triggerModelImport"
      >
        <BaseIcon name="model" :size="12" />
        <BaseIcon name="add" :size="9" class="-ml-0.5 -mt-1" />
      </BaseButton>
      <input ref="modelInputRef" type="file" class="hidden" multiple accept=".glb,.gltf,.obj,.fbx,.babylon,.stl,.dae" @change="onModelFileSelected" />

      <!-- Refresh -->
      <BaseButton
        variant="ghost" size="xs"
        title="Refresh"
        @click="projectStore.refreshFileTree()"
      >
        <BaseIcon name="rotate" :size="12" />
      </BaseButton>
    </div>

    <!-- ── Inline root create form ───────────────────────────── -->
    <div v-if="creating" class="flex items-center gap-1.5 px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-bg-overlay)]">
      <BaseIcon :name="creating === 'scene' ? 'scene' : creating === 'material' ? 'material' : creating === 'script' ? 'script' : 'folder'" :size="11" class="shrink-0 text-[var(--color-text-muted)]" />
      <input
        ref="inputRef"
        v-model="newName"
        class="flex-1 text-xs bg-[var(--color-bg-surface)] border border-[var(--color-accent)] rounded px-1.5 h-5 outline-none text-[var(--color-text-primary)]"
        :placeholder="creating === 'scene' ? 'Scene name…' : creating === 'material' ? 'Material name…' : creating === 'script' ? 'Script class name…' : 'Folder name…'"
        @keydown.enter.prevent="confirmCreate"
        @keydown.esc.prevent="creating = null"
        @blur="() => { if (!newName.trim()) creating = null }"
      />
      <BaseButton variant="ghost" size="xs" @click="creating = null">
        <BaseIcon name="close" :size="10" />
      </BaseButton>
    </div>

    <!-- ── File tree ─────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto py-1">
      <div
        v-if="projectStore.fileTree.length === 0"
        class="px-4 py-4 text-center text-xs text-[var(--color-text-muted)]"
      >
        No files yet. Create a scene or folder to get started.
      </div>

      <FileBrowserItem
        v-for="node in projectStore.fileTree"
        :key="node.relPath"
        :node="node"
        :depth="0"
      />
    </div>

    <!-- ── Status bar ─────────────────────────────────────────── -->
    <div class="flex items-center h-5 px-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)] select-none shrink-0">
      <template v-if="sceneStore.activeScene">
        Scene: <span class="ml-1 text-[var(--color-accent)]">{{ sceneStore.activeScene.name }}</span>
      </template>
      <template v-else>No scene open</template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useProjectStore } from '@/stores/projectStore'
import { useSceneStore }   from '@/stores/sceneStore'
import { useAssetStore }   from '@/stores/assetStore'
import { useTextureStore } from '@/stores/textureStore'
import BaseButton          from '@/components/base/BaseButton.vue'
import BaseIcon            from '@/components/base/BaseIcon.vue'
import FileBrowserItem     from './FileBrowserItem.vue'

const projectStore = useProjectStore()
const sceneStore   = useSceneStore()
const assetStore   = useAssetStore()
const textureStore = useTextureStore()

const creating  = ref<'scene' | 'folder' | 'material' | 'script' | null>(null)
const newName   = ref('')
const inputRef  = ref<HTMLInputElement | null>(null)
const textureInputRef = ref<HTMLInputElement | null>(null)
const modelInputRef   = ref<HTMLInputElement | null>(null)
const isDraggingImages   = ref(false)
const isDraggingModels   = ref(false)
const isDraggingEntities = ref(false)

function startCreate(kind: 'scene' | 'folder' | 'material' | 'script'): void {
  creating.value = kind
  newName.value  = ''
  nextTick(() => inputRef.value?.focus())
}

async function confirmCreate(): Promise<void> {
  const name = newName.value.trim()
  if (!name) { creating.value = null; return }

  if (creating.value === 'scene') {
    await projectStore.createScene(name, 'scenes')
  } else if (creating.value === 'material') {
    await projectStore.createMaterialAsset(name, 'materials')
  } else if (creating.value === 'script') {
    await projectStore.createScript(name, 'scripts')
  } else {
    await projectStore.createFolder('', name)
  }
  creating.value = null
}

// ── Texture import ───────────────────────────────────────────
function triggerTextureImport(): void {
  textureInputRef.value?.click()
}

async function _importTextureFiles(files: FileList | File[]): Promise<void> {
  const dirHandle = projectStore.directoryHandle
  if (!dirHandle) return
  for (const file of Array.from(files)) {
    const entry = await assetStore.importAsset(file, dirHandle, 'textures')
    await textureStore.loadFromFile(entry.meta.guid, file)
  }
  await projectStore.refreshFileTree()
}

async function onTextureFileSelected(event: Event): Promise<void> {
  const files = (event.target as HTMLInputElement).files
  if (files) await _importTextureFiles(files)
  if (textureInputRef.value) textureInputRef.value.value = ''
}

// ── Model import ────────────────────────────────────────────
const MODEL_EXTS = new Set(['glb', 'gltf', 'obj', 'fbx', 'babylon', 'stl', 'dae'])

function triggerModelImport(): void {
  modelInputRef.value?.click()
}

async function _importModelFiles(files: FileList | File[]): Promise<void> {
  const dirHandle = projectStore.directoryHandle
  if (!dirHandle) return
  for (const file of Array.from(files)) {
    await assetStore.importAsset(file, dirHandle, 'models')
  }
  await projectStore.refreshFileTree()
}

async function onModelFileSelected(event: Event): Promise<void> {
  const files = (event.target as HTMLInputElement).files
  if (files) await _importModelFiles(files)
  if (modelInputRef.value) modelInputRef.value.value = ''
}

// ── Panel-level drag-drop for image and model files ──────────────────────

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'ktx', 'ktx2'])

function _hasImageFiles(e: DragEvent): boolean {
  if (!projectStore.isOpen) return false
  for (const item of Array.from(e.dataTransfer?.items ?? [])) {
    if (item.kind === 'file') {
      const name = (item as DataTransferItem & { getAsFile?(): File | null }).getAsFile?.()?.name ?? ''
      const ext  = name.split('.').pop()?.toLowerCase() ?? ''
      if (IMAGE_EXTS.has(ext)) return true
      // Accept image mime types
      if (item.type.startsWith('image/')) return true
    }
  }
  return false
}

function _hasModelFiles(e: DragEvent): boolean {
  if (!projectStore.isOpen) return false
  for (const item of Array.from(e.dataTransfer?.items ?? [])) {
    if (item.kind === 'file') {
      const name = (item as DataTransferItem & { getAsFile?(): File | null }).getAsFile?.()?.name ?? ''
      const ext  = name.split('.').pop()?.toLowerCase() ?? ''
      if (MODEL_EXTS.has(ext)) return true
    }
  }
  return false
}

function onPanelDragOver(e: DragEvent): void {
  // Only activate overlay if the drag contains external files
  // (not nebu-internal dragging of browser nodes)
  const isNebuDrag = e.dataTransfer?.types.some(t => t.startsWith('application/nebu-'))
  if (!isNebuDrag) {
    if (_hasModelFiles(e)) { isDraggingModels.value = true; return }
    if (_hasImageFiles(e)) { isDraggingImages.value = true; return }
  }
  // Entity / scene drags from the hierarchy → show prefab creation hint
  if (
    e.dataTransfer?.types.includes('application/nebu-entity') ||
    e.dataTransfer?.types.includes('application/nebu-scene')
  ) {
    isDraggingEntities.value = true
  }
}

function onPanelDragLeave(e: DragEvent): void {
  // Only clear when leaving the whole panel (relatedTarget is outside)
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
    isDraggingImages.value   = false
    isDraggingModels.value   = false
    isDraggingEntities.value = false
  }
}

async function onPanelDrop(e: DragEvent): Promise<void> {
  isDraggingImages.value   = false
  isDraggingModels.value   = false
  isDraggingEntities.value = false
  if (!projectStore.isOpen) return

  const files = e.dataTransfer?.files
  if (files) {
    // ── Model files → import as model asset ───────────────────────
    const models = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return MODEL_EXTS.has(ext)
    })
    if (models.length > 0) { await _importModelFiles(models); return }

    // ── Image files → import as texture ───────────────────────────
    const images = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return IMAGE_EXTS.has(ext) || f.type.startsWith('image/')
    })
    if (images.length > 0) { await _importTextureFiles(images); return }
  }

  // ── Entity drag → create prefab in prefabs/ ────────────────────────
  // (Only reached if the drop was NOT on a specific folder item.)
  const entityId = e.dataTransfer?.getData('application/nebu-entity')
  if (entityId) {
    await projectStore.createPrefabFromEntity(entityId, 'prefabs')
    return
  }

  // ── Scene drag → create prefab from whole scene in prefabs/ ───────
  if (e.dataTransfer?.types.includes('application/nebu-scene')) {
    await projectStore.createPrefabFromScene('prefabs')
  }
}
</script>
