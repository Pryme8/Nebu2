<template>
  <div>
    <!-- Row ─────────────────────────────────────────────────────── -->
    <div
      :style="{ paddingLeft: `${depth * 14 + 6}px` }"
      :class="[
        'flex items-center h-6 gap-1.5 cursor-pointer select-none group text-xs rounded mx-1',
        isActive
          ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]',
        node.missing ? 'opacity-60' : '',
        isFolderDropTarget ? 'outline outline-1 outline-[var(--color-accent)] bg-[var(--color-accent)]/10' : '',
      ]"
      :draggable="node.kind === 'material' || node.kind === 'texture' || node.kind === 'script' || node.kind === 'prefab' || node.kind === 'model'"
      @click="handleClick"
      @dblclick="handleDblClick"
      @contextmenu.prevent="showMenu = !showMenu"
      @dragstart="onDragStart"
      @dragover="onFolderDragOver"
      @dragleave="onFolderDragLeave"
      @drop.prevent="onFolderDrop"
    >
      <!-- Expand arrow (directories only) -->
      <span class="shrink-0 w-3 h-3 flex items-center justify-center">
        <BaseIcon
          v-if="node.kind === 'directory'"
          :name="open ? 'chevronDown' : 'chevronRight'"
          :size="9"
        />
      </span>

      <!-- Kind icon -->
      <BaseIcon :name="rowIcon" :size="12" class="shrink-0" :class="iconColor" />

      <!-- Name -->
      <span class="flex-1 truncate">{{ node.name }}</span>

      <!-- Missing badge -->
      <span
        v-if="node.missing"
        class="shrink-0 text-[9px] font-bold px-1 rounded bg-[var(--color-danger)]/20 text-[var(--color-danger)]"
        title="Source file not found at recorded path"
      >MISSING</span>

      <!-- Texture thumbnail preview (small inline image) -->
      <img
        v-else-if="node.kind === 'texture' && node.meta?.thumbnail"
        :src="node.meta.thumbnail"
        class="shrink-0 w-5 h-5 rounded object-cover border border-[var(--color-border)]"
        draggable="false"
        title="Texture preview"
      />
      <!-- Checkerboard when texture has no thumbnail yet -->
      <div
        v-else-if="node.kind === 'texture'"
        class="shrink-0 w-5 h-5 rounded border border-[var(--color-border)]"
        style="background: repeating-conic-gradient(#888 0% 25%, #444 0% 50%) 0 0 / 6px 6px;"
        title="Texture (no preview)"
      />

      <!-- Thumbnail dot when scene/material has a preview -->
      <span
        v-else-if="(node.kind === 'scene' || node.kind === 'material') && node.meta?.thumbnail"
        class="shrink-0 w-2 h-2 rounded-full bg-[var(--color-accent)]/60"
        title="Has preview thumbnail"
      />

      <!-- Context-menu trigger (only on hover) -->
      <button
        class="shrink-0 ml-auto opacity-0 group-hover:opacity-100 px-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        @click.stop="showMenu = !showMenu"
        title="More…"
      >
        <BaseIcon name="placeholder" :size="9" />
      </button>
    </div>

    <!-- Context menu ─────────────────────────────────────────────── -->
    <div
      v-if="showMenu"
      v-click-outside="() => showMenu = false"
      class="ml-6 mb-1 flex flex-col gap-px border border-[var(--color-border)] rounded bg-[var(--color-bg-surface)] shadow-lg z-50 relative"
    >
      <template v-if="node.kind === 'directory'">
        <button class="context-item" @click.stop="startCreate('scene')">
          <BaseIcon name="scene" :size="11" />  New Scene
        </button>
        <button class="context-item" @click.stop="startCreate('folder')">
          <BaseIcon name="folder" :size="11" />  New Folder
        </button>
        <button class="context-item" @click.stop="startCreate('material')">
          <BaseIcon name="material" :size="11" />  New Material
        </button>        <button class="context-item" @click.stop="startCreate('script')">
          <BaseIcon name="script" :size="11" />  New Script
        </button>      </template>
      <template v-if="node.kind === 'scene'">
        <button class="context-item" @click.stop="openScene">
          <BaseIcon name="openFolder" :size="11" />  Open Scene
        </button>
        <button class="context-item danger" @click.stop="deleteNode">
          <BaseIcon name="trash" :size="11" />  Delete
        </button>
      </template>      <template v-if="node.kind === 'prefab'">
        <button class="context-item" @click.stop="instantiatePrefab">
          <BaseIcon name="prefab" :size="11" />  Instantiate in Scene
        </button>
        <button class="context-item danger" @click.stop="deleteNode">
          <BaseIcon name="trash" :size="11" />  Delete
        </button>
      </template>      <template v-if="node.kind === 'material'">
        <button class="context-item" @click.stop="selectMaterial">
          <BaseIcon name="material" :size="11" />  Select
        </button>
        <button class="context-item danger" @click.stop="deleteNode">
          <BaseIcon name="trash" :size="11" />  Delete
        </button>
      </template>      <template v-if="node.kind === 'texture'">
        <button class="context-item danger" @click.stop="deleteNode">
          <BaseIcon name="trash" :size="11" />  Delete
        </button>
      </template>      <template v-if="node.kind === 'model'">
        <button class="context-item danger" @click.stop="deleteNode">
          <BaseIcon name="trash" :size="11" />  Delete
        </button>
      </template>      <template v-if="node.kind === 'asset' || node.kind === 'unknown'">
        <button class="context-item danger" @click.stop="deleteNode">
          <BaseIcon name="trash" :size="11" />  Delete
        </button>
      </template>      <template v-if="node.kind === 'script'">
        <button class="context-item" @click.stop="editScript">
          <BaseIcon name="script" :size="11" />  Edit
        </button>
        <button class="context-item danger" @click.stop="deleteNode">
          <BaseIcon name="trash" :size="11" />  Delete
        </button>
      </template>
    </div>

    <!-- Inline create form ───────────────────────────────────────── -->
    <div
      v-if="creating"
      :style="{ paddingLeft: `${(depth + 1) * 14 + 6}px` }"
      class="flex items-center gap-1 mx-1 mb-1"
    >
      <BaseIcon :name="creating === 'scene' ? 'scene' : creating === 'material' ? 'material' : creating === 'script' ? 'script' : 'folder'" :size="11" class="shrink-0 text-[var(--color-text-muted)]" />
      <input
        ref="inputRef"
        v-model="newName"
        class="flex-1 text-xs bg-[var(--color-bg-overlay)] border border-[var(--color-accent)] rounded px-1.5 h-5 outline-none text-[var(--color-text-primary)]"
        :placeholder="creating === 'scene' ? 'Scene name…' : creating === 'material' ? 'Material name…' : creating === 'script' ? 'Script class name…' : 'Folder name…'"
        @keydown.enter.prevent="confirmCreate"
        @keydown.esc.prevent="creating = null"
        @blur="creating = null"
      />
    </div>

    <!-- Children ─────────────────────────────────────────────────── -->
    <template v-if="open && node.kind === 'directory'">
      <FileBrowserItem
        v-for="child in node.children"
        :key="child.relPath"
        :node="child"
        :depth="depth + 1"
      />
      <!-- Empty folder hint -->
      <div
        v-if="node.children.length === 0"
        :style="{ paddingLeft: `${(depth + 1) * 14 + 22}px` }"
        class="text-[10px] italic text-[var(--color-text-muted)] h-5 flex items-center mx-1"
      >Empty</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { FileBrowserNode } from '@/stores/projectStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSceneStore }   from '@/stores/sceneStore'
import { useEditorStore }  from '@/stores/editorStore'
import { useAssetStore }   from '@/stores/assetStore'
import { useTextureStore } from '@/stores/textureStore'
import BaseIcon from '@/components/base/BaseIcon.vue'
import FileBrowserItem from './FileBrowserItem.vue'

defineOptions({ name: 'FileBrowserItem' })

const props = defineProps<{
  node:  FileBrowserNode
  depth: number
}>()

const projectStore = useProjectStore()
const sceneStore   = useSceneStore()
const editorStore  = useEditorStore()
const assetStore   = useAssetStore()
const textureStore = useTextureStore()

// ── Expand ────────────────────────────────────────────────────
const open = ref(props.node.kind === 'directory')

// ── Active scene highlight ──────────────────────────────────
const isActive = computed(() =>
  (props.node.kind === 'scene' &&
   props.node.meta?.guid != null &&
   sceneStore.activeSceneId === props.node.meta.guid) ||
  (props.node.kind === 'material' &&
   props.node.meta?.guid != null &&
   editorStore.selectedMaterialId === props.node.meta.guid) ||
  (props.node.kind === 'texture' &&
   props.node.meta?.guid != null &&
   editorStore.selectedTextureGuid === props.node.meta.guid) ||
  (props.node.kind === 'model' &&
   props.node.meta?.guid != null &&
   editorStore.selectedModelGuid === props.node.meta.guid),
)

// ── Icons ─────────────────────────────────────────────────────
const rowIcon = computed((): string => {
  const kind = props.node.kind
  if (kind === 'directory') return open.value ? 'folderOpen' : 'folder'
  if (kind === 'scene')     return 'scene'
  if (kind === 'prefab')    return 'prefab'
  if (kind === 'material')  return 'material'
  if (kind === 'texture')   return 'texture'
  if (kind === 'script')    return 'script'
  if (kind === 'model')     return 'model'
  if (kind === 'asset') {
    const ext = props.node.relPath.split('.').pop()?.toLowerCase() ?? ''
    if (['glb', 'gltf', 'obj', 'fbx', 'babylon'].includes(ext)) return 'mesh'
  }
  return 'file'
})

const iconColor = computed((): string => {
  if (props.node.missing)             return 'text-[var(--color-danger)]'
  if (props.node.kind === 'scene')    return isActive.value ? '' : 'text-[var(--color-accent)]/70'
  if (props.node.kind === 'prefab')   return 'text-[var(--color-accent)]/80'
  if (props.node.kind === 'material') return isActive.value ? '' : 'text-[var(--color-accent)]/50'
  if (props.node.kind === 'texture')  return 'text-[var(--color-text-secondary)]'
  if (props.node.kind === 'script')   return 'text-[var(--color-accent)]/60'
  if (props.node.kind === 'model')    return 'text-[var(--color-accent)]/75'
  return 'text-[var(--color-text-muted)]'
})

// ── Context menu ──────────────────────────────────────────────────
const showMenu = ref(false)

function handleClick(): void {
  showMenu.value = false
  if (props.node.kind === 'directory') {
    open.value = !open.value
  } else if (props.node.kind === 'scene' && !props.node.missing) {
    openScene()
  } else if (props.node.kind === 'material' && !props.node.missing) {
    selectMaterial()
  } else if (props.node.kind === 'texture') {
    selectTexture()
  } else if (props.node.kind === 'model') {
    selectModel()
  }
}

function handleDblClick(): void {
  if (props.node.kind === 'script' && !props.node.missing) {
    editorStore.selectScript(props.node.relPath)
  } else if (props.node.kind === 'prefab' && !props.node.missing) {
    instantiatePrefab()
  }
}

function editScript(): void {
  showMenu.value = false
  editorStore.selectScript(props.node.relPath)
}

function openScene(): void {
  showMenu.value = false
  if (props.node.meta) {
    projectStore.openSceneFromMeta(props.node.meta)
  }
}

function instantiatePrefab(): void {
  showMenu.value = false
  if (props.node.meta?.guid) {
    projectStore.instantiatePrefabByGuid(props.node.meta.guid, null)
  }
}

function selectMaterial(): void {
  showMenu.value = false
  if (props.node.meta?.guid) {
    editorStore.selectMaterial(props.node.meta.guid)
  }
}

function selectTexture(): void {
  showMenu.value = false
  if (props.node.meta?.guid) {
    editorStore.selectTexture(props.node.meta.guid)
  }
}

function selectModel(): void {
  showMenu.value = false
  if (props.node.meta?.guid) {
    editorStore.selectModel(props.node.meta.guid)
  }
}

async function deleteNode(): Promise<void> {
  showMenu.value = false
  await projectStore.deleteNode(props.node)
}

// ── Folder drop (OS image/model files → import, OR entity/scene drag → create prefab) ───
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'ktx', 'ktx2'])
const MODEL_EXTS = new Set(['glb', 'gltf', 'obj', 'fbx', 'babylon', 'stl', 'dae'])
const isFolderDropTarget = ref(false)

function _isImageDrag(e: DragEvent): boolean {
  if (props.node.kind !== 'directory') return false
  if (!projectStore.directoryHandle)   return false
  // Only activate for external OS files, not nebu-internal drags
  if (e.dataTransfer?.types.some(t => t.startsWith('application/nebu-'))) return false
  for (const item of Array.from(e.dataTransfer?.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = (item as DataTransferItem & { getAsFile?(): File | null }).getAsFile?.()
    const ext  = file?.name.split('.').pop()?.toLowerCase() ?? ''
    if (IMAGE_EXTS.has(ext) || item.type.startsWith('image/')) return true
  }
  return false
}

function _isModelDrag(e: DragEvent): boolean {
  if (props.node.kind !== 'directory') return false
  if (!projectStore.directoryHandle)   return false
  if (e.dataTransfer?.types.some(t => t.startsWith('application/nebu-'))) return false
  for (const item of Array.from(e.dataTransfer?.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = (item as DataTransferItem & { getAsFile?(): File | null }).getAsFile?.()
    const ext  = file?.name.split('.').pop()?.toLowerCase() ?? ''
    if (MODEL_EXTS.has(ext)) return true
  }
  return false
}

function _isPrefabCreateDrag(e: DragEvent): boolean {
  if (props.node.kind !== 'directory') return false
  if (!projectStore.directoryHandle)   return false
  const types = e.dataTransfer?.types ?? []
  return types.includes('application/nebu-entity') || types.includes('application/nebu-scene')
}

function onFolderDragOver(e: DragEvent): void {
  if (_isImageDrag(e) || _isModelDrag(e) || _isPrefabCreateDrag(e)) {
    e.preventDefault()
    e.stopPropagation()
    isFolderDropTarget.value = true
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
}

function onFolderDragLeave(e: DragEvent): void {
  // Only clear when the pointer truly leaves this row element
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
    isFolderDropTarget.value = false
  }
}

async function onFolderDrop(e: DragEvent): Promise<void> {
  isFolderDropTarget.value = false
  if (props.node.kind !== 'directory') return
  const dirHandle = projectStore.directoryHandle
  if (!dirHandle) return

  // ── Entity drag → create prefab from entity subtree ─────────────
  const entityId = e.dataTransfer?.getData('application/nebu-entity')
  if (entityId) {
    e.stopPropagation()  // prevent the panel-level drop handler from also firing
    await projectStore.createPrefabFromEntity(entityId, props.node.relPath)
    return
  }

  // ── Scene drag → create prefab from the entire scene ────────────
  if (e.dataTransfer?.types.includes('application/nebu-scene')) {
    e.stopPropagation()  // prevent the panel-level drop handler from also firing
    await projectStore.createPrefabFromScene(props.node.relPath)
    return
  }

  e.stopPropagation()  // prevent the panel-level drop handler firing too

  // ── Model files → import into this folder ────────────────────────────
  const relFolder = props.node.relPath.replace(/^assets\/?/, '')
  const allFiles  = Array.from(e.dataTransfer?.files ?? [])

  const models = allFiles.filter(f => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    return MODEL_EXTS.has(ext)
  })
  if (models.length > 0) {
    open.value = true
    for (const file of models) {
      await assetStore.importAsset(file, dirHandle, relFolder)
    }
    await projectStore.refreshFileTree()
    return
  }

  const files = allFiles.filter(f => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    return IMAGE_EXTS.has(ext) || f.type.startsWith('image/')
  })
  if (files.length === 0) return

  // Determine the folder relative to the `assets/` root.
  // props.node.relPath is e.g. "assets/textures" — strip the leading "assets/".
  open.value = true
  for (const file of files) {
    const entry = await assetStore.importAsset(file, dirHandle, relFolder)
    await textureStore.loadFromFile(entry.meta.guid, file)
  }
  await projectStore.refreshFileTree()
}

// ── Drag (material and texture assets) ─────────────────────────────────
function onDragStart(e: DragEvent): void {
  if (props.node.kind === 'material' && props.node.meta?.guid) {
    e.dataTransfer?.setData('application/nebu-material', props.node.meta.guid)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
  } else if (props.node.kind === 'texture' && props.node.meta?.guid) {
    e.dataTransfer?.setData('application/nebu-texture', props.node.meta.guid)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
  } else if (props.node.kind === 'script' && props.node.meta?.guid) {
    e.dataTransfer?.setData('application/nebu-script', props.node.meta.guid)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
  } else if (props.node.kind === 'prefab' && props.node.meta?.guid) {
    e.dataTransfer?.setData('application/nebu-prefab', props.node.meta.guid)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
  } else if (props.node.kind === 'model' && props.node.meta?.guid) {
    e.dataTransfer?.setData('application/nebu-model', props.node.meta.guid)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
  } else {
    e.preventDefault()
  }
}

// ── Inline create ─────────────────────────────────────────────────
const creating  = ref<'scene' | 'folder' | 'material' | 'script' | null>(null)
const newName   = ref('')
const inputRef  = ref<HTMLInputElement | null>(null)

function startCreate(kind: 'scene' | 'folder' | 'material' | 'script'): void {
  showMenu.value = false
  open.value     = true      // expand folder so the input is visible
  creating.value = kind
  newName.value  = ''
  nextTick(() => inputRef.value?.focus())
}

async function confirmCreate(): Promise<void> {
  const name = newName.value.trim()
  if (!name) { creating.value = null; return }

  if (creating.value === 'scene') {
    await projectStore.createScene(name, props.node.relPath)
  } else if (creating.value === 'material') {
    await projectStore.createMaterialAsset(name, props.node.relPath)
  } else if (creating.value === 'script') {
    await projectStore.createScript(name, props.node.relPath)
    // Open the new script in the editor immediately
    const safeName = name.trim().replace(/\s+(.)/g, (_, c: string) => c.toUpperCase()) || 'NewScript'
    editorStore.selectScript(`${props.node.relPath}/${safeName}.ts`)
  } else {
    await projectStore.createFolder(props.node.relPath, name)
  }
  creating.value = null
}

// ── v-click-outside (tiny inline directive) ───────────────────────
const vClickOutside = {
  mounted(el: HTMLElement, binding: { value: () => void }) {
    (el as HTMLElement & { _co: (e: MouseEvent) => void })._co = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) binding.value()
    }
    document.addEventListener('mousedown', (el as HTMLElement & { _co: (e: MouseEvent) => void })._co)
  },
  unmounted(el: HTMLElement) {
    document.removeEventListener('mousedown', (el as HTMLElement & { _co: (e: MouseEvent) => void })._co)
  },
}
</script>

<style scoped>
.context-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  background: transparent;
  border: none;
  width: 100%;
}
.context-item:hover {
  background: var(--color-bg-overlay);
  color: var(--color-text-primary);
}
.context-item.danger {
  color: var(--color-danger);
  opacity: 0.8;
}
.context-item.danger:hover {
  background: var(--color-danger-subtle, color-mix(in srgb, var(--color-danger) 10%, transparent));
  color: var(--color-danger);
  opacity: 1;
}
</style>
