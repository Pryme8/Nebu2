<template>
  <!-- Hierarchy Panel — displays scene entity tree -->
  <div class="flex flex-col h-full" @click="showDropdown = false">
    <!-- Toolbar -->
    <div class="flex items-center h-7 px-2 gap-1 border-b border-[var(--color-border)] panel-elevated shrink-0">
      <!-- Add entity dropdown trigger -->
      <div class="relative">
        <BaseButton variant="ghost" size="xs" title="Add Entity" @click.stop="showDropdown = !showDropdown">
          <BaseIcon name="add" :size="12" />
        </BaseButton>
        <!-- Dropdown menu -->
        <div
          v-if="showDropdown"
          class="absolute top-full left-0 mt-0.5 z-50 min-w-[140px] rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-lg py-0.5"
          @click.stop
        >
          <button
            v-for="item in entityTypes"
            :key="item.key"
            class="w-full text-left px-3 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]"
            @click="addEntity(item.key)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <BaseInput
        v-model="search"
        placeholder="Search…"
        class="flex-1"
        style="height:20px; font-size:11px"
      />
    </div>

    <!-- Tree -->
    <div class="flex-1 overflow-y-auto py-1">

      <!-- Scene root row -->
      <template v-if="sceneStore.activeScene">
        <div
          :class="[
            'flex items-center h-6 gap-1.5 cursor-pointer select-none group text-xs px-2',
            editorStore.selectedSceneGuid === sceneStore.activeScene.guid
              ? 'bg-[var(--color-accent)]/20 text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]',
            (dropOnRoot || dropPrefabOnRoot || dropModelOnRoot) && 'outline outline-1 outline-[var(--color-accent)] bg-[var(--color-accent)]/10',
          ]"
          draggable="true"
          @click="editorStore.selectScene(sceneStore.activeScene!.guid)"
          @dragstart="onSceneRootDragStart"
          @dragend="onSceneRootDragEnd"
          @dragover="onSceneDragOver"
          @dragleave="onSceneDragLeave"
          @drop="onSceneDrop"
        >
          <span
            class="shrink-0 w-3 h-3 flex items-center justify-center"
            @click.stop="sceneExpanded = !sceneExpanded"
          >
            <BaseIcon :name="sceneExpanded ? 'chevronDown' : 'chevronRight'" :size="10" />
          </span>
          <BaseIcon name="scene" :size="11" class="shrink-0 text-[var(--color-accent)]" />
          <span class="flex-1 font-medium truncate">{{ sceneStore.activeScene.name }}</span>
        </div>

        <!-- Entity tree (indented one level under scene root) -->
        <template v-if="sceneExpanded">
          <HierarchyNode
            v-for="entity in roots"
            :key="entity.id"
            :entity="entity"
            :children="childMap"
            :depth="1"
          />
          <div
            v-if="roots.length === 0"
            class="py-2 text-xs text-[var(--color-text-muted)] text-center"
            style="padding-left: 28px"
          >
            No entities. Click + to add one.
          </div>
          <!-- Drop zone: drag here to un-parent (make root-level) -->
          <div
            class="h-4 mx-2 rounded transition-colors"
            :class="(dropOnRoot || dropModelOnRoot) ? 'bg-[var(--color-accent)]/20 outline outline-1 outline-[var(--color-accent)]' : 'bg-transparent'"
            @dragover="onSceneDragOver"
            @dragleave="onSceneDragLeave"
            @drop="onSceneDrop"
          />
        </template>
      </template>

      <!-- No scene loaded -->
      <div v-else class="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
        No scene loaded.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSceneStore }  from '@/stores/sceneStore'
import { useEditorStore } from '@/stores/editorStore'
import { useCommandStore } from '@/stores/commandStore'
import { useProjectStore } from '@/stores/projectStore'
import { CreateEntityCommand, ReparentEntityCommand, CopyEntityCommand } from '@/core/commands/entity'
import { LightComponent } from '@/core/ecs/components/LightComponent'
import { MeshComponent } from '@/core/ecs/components/MeshComponent'
import { useAssetStore } from '@/stores/assetStore'
import { hierarchyDragState } from '@/composables/useHierarchyDrag'
import type { Entity }    from '@/core/ecs/Entity'
import type { ModelAssetInfo } from '@/types/asset'
import BaseButton    from '@/components/base/BaseButton.vue'
import BaseIcon      from '@/components/base/BaseIcon.vue'
import BaseInput     from '@/components/base/BaseInput.vue'
import HierarchyNode from './HierarchyNode.vue'

const sceneStore    = useSceneStore()
const editorStore   = useEditorStore()
const commandStore  = useCommandStore()
const projectStore  = useProjectStore()
const assetStore    = useAssetStore()
const search        = ref('')
const showDropdown  = ref(false)
const sceneExpanded = ref(true)
const dropOnRoot    = ref(false)

const { draggingId, dragIsCopy, dropTargetId } = hierarchyDragState

// Whether a prefab is hovering over the scene root drop zone.
const dropPrefabOnRoot = ref(false)
// Whether a model is hovering over the scene root drop zone.
const dropModelOnRoot = ref(false)

interface EntityTypeOption { key: string; label: string }
const entityTypes: EntityTypeOption[] = [
  { key: 'empty', label: 'Empty Entity' },
  { key: 'light', label: 'Light (Hemispheric)' },
]

const roots    = computed(() => sceneStore.hierarchy.roots.filter(filterFn))
const childMap = computed(() => sceneStore.hierarchy.children)

function filterFn(e: Entity): boolean {
  return !search.value || e.name.toLowerCase().includes(search.value.toLowerCase())
}

function addEntity(type: string): void {
  showDropdown.value = false
  if (!sceneStore.activeScene) return
  if (type === 'empty') {
    commandStore.execute(new CreateEntityCommand('Empty Entity', editorStore.primaryId))
  } else if (type === 'light') {
    commandStore.execute(new CreateEntityCommand(
      'Hemispheric Light', editorStore.primaryId,
      [() => new LightComponent()],
    ))
  }
}

// ── Drop-to-root (onto scene row or the catch-all strip) ─────────

// ── Scene root row — draggable (create scene prefab) ──────────────
function onSceneRootDragStart(e: DragEvent): void {
  const scene = sceneStore.activeScene
  if (!scene || !e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData('application/nebu-scene', scene.guid)
  e.stopPropagation()
}

function onSceneRootDragEnd(e: DragEvent): void {
  // Nothing specific to clean up.
  e.stopPropagation()
}

function onSceneDragOver(e: DragEvent): void {
  // Accept hierarchy entity reparents
  if (draggingId.value) {
    e.preventDefault()
    e.stopPropagation()
    dropOnRoot.value   = true
    dropTargetId.value = null
    dragIsCopy.value   = e.altKey
    if (e.dataTransfer) e.dataTransfer.dropEffect = dragIsCopy.value ? 'copy' : 'move'
    return
  }
  // Accept prefab drops from the file browser
  if (e.dataTransfer?.types.includes('application/nebu-prefab')) {
    e.preventDefault()
    e.stopPropagation()
    dropPrefabOnRoot.value = true
  }
  // Accept model drops from the file browser
  if (e.dataTransfer?.types.includes('application/nebu-model')) {
    e.preventDefault()
    e.stopPropagation()
    dropModelOnRoot.value = true
  }
}

function onSceneDragLeave(e: DragEvent): void {
  // Only clear when the pointer truly leaves — not when entering a child element
  const related = e.relatedTarget as Node | null
  if (related && (e.currentTarget as HTMLElement).contains(related)) return
  dropOnRoot.value       = false
  dropPrefabOnRoot.value = false
  dropModelOnRoot.value  = false
}

function onSceneDrop(e: DragEvent): void {
  e.preventDefault()
  e.stopPropagation()

  // ── Model drop → create decomposed entity tree (or single entity fallback) ──
  const modelGuid = e.dataTransfer?.getData('application/nebu-model')
  if (modelGuid) {
    dropOnRoot.value      = false
    dropModelOnRoot.value = false
    const asset = assetStore.getAsset(modelGuid)
    const name  = asset?.name ?? 'Model'
    const info  = asset?.meta.modelInfo

    if (info?.extracted && info.meshHierarchy?.length) {
      _createModelTree(name, modelGuid, info, null)
    } else {
      commandStore.execute(new CreateEntityCommand(name, null, [
        () => {
          const mesh = new MeshComponent()
          mesh.source     = 'model'
          mesh.modelGuid  = modelGuid
          return mesh
        },
      ]))
    }
    return
  }

  // ── Prefab drop → instantiate at scene root ──────────────────
  const prefabGuid = e.dataTransfer?.getData('application/nebu-prefab')
  if (prefabGuid) {
    dropOnRoot.value       = false
    dropPrefabOnRoot.value = false
    projectStore.instantiatePrefabByGuid(prefabGuid, null)
    return
  }

  // ── Entity reparent / copy ──────────────────────────────────
  const sourceId = draggingId.value
  const isCopy   = dragIsCopy.value
  dropOnRoot.value       = false
  dropPrefabOnRoot.value = false
  dropModelOnRoot.value  = false
  draggingId.value   = null
  dragIsCopy.value   = false
  dropTargetId.value = null
  if (!sourceId) return
  const entity = sceneStore.activeScene?.world.getEntity(sourceId)
  if (!entity) return
  if (isCopy) {
    commandStore.execute(new CopyEntityCommand(sourceId, null))
  } else {
    // Already at root — nothing to do
    if (entity.parentId === null) return
    commandStore.execute(new ReparentEntityCommand(sourceId, entity.parentId, null))
  }
}

/**
 * Create a decomposed entity tree from a fully-extracted model manifest.
 * Root entity acts as a group; each mesh in the hierarchy gets its own
 * child entity with a MeshComponent bound to that specific submesh.
 */
function _createModelTree(
  name:      string,
  modelGuid: string,
  info:      ModelAssetInfo,
  parentId:  string | null,
): void {
  // Root group entity (no mesh, just transform)
  const root = sceneStore.createEntity(name, parentId)

  // material name → extracted GUID
  const matNameToGuid = new Map<string, string>()
  for (const em of info.extractedMaterials ?? []) {
    matNameToGuid.set(em.name, em.guid)
  }

  // mesh name → entity ID (for parent resolution in nested hierarchies)
  const meshToEntity = new Map<string, string>()

  for (const node of info.meshHierarchy ?? []) {
    const nodeParentId = node.parentName
      ? meshToEntity.get(node.parentName) ?? root.id
      : root.id

    const entity = sceneStore.createEntity(node.name, nodeParentId)
    meshToEntity.set(node.name, entity.id)

    // Apply transform from the manifest
    const tf = entity.getComponent('Transform') as
      | import('@/core/ecs/components/TransformComponent').TransformComponent
      | undefined
    if (tf && node.position) {
      tf.position = { ...node.position }
      tf.rotation = { ...node.rotation! }
      tf.scale    = { ...node.scale! }
      tf.syncToBabylon()
    }

    const meshComp      = new MeshComponent()
    meshComp.source     = 'model'
    meshComp.modelGuid  = modelGuid
    meshComp.submeshName = node.name

    if (node.materialName) {
      const matGuid = matNameToGuid.get(node.materialName)
      if (matGuid) meshComp.materialId = matGuid
    }

    sceneStore.addComponentToEntity(entity.id, meshComp)
  }
}
</script>
