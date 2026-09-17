<template>
  <!-- Recursive entity tree node -->
  <div>
    <!-- drop-before indicator -->
    <div v-if="dropZone === 'before'" class="h-0.5 bg-[var(--color-accent)] mx-2 rounded-full" />
    <div
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      :class="[
        'flex items-center h-6 gap-1 cursor-pointer select-none group text-xs',
        isSelected
          ? 'bg-[var(--color-accent)]/20 text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]',
        dropZone === 'into' && 'outline outline-1 outline-[var(--color-accent)] bg-[var(--color-accent)]/10',
        isDraggingSelf && 'opacity-40',
      ]"
      draggable="true"
      @click="select"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- expand arrow -->
      <span
        class="shrink-0 w-3 h-3 flex items-center justify-center"
        @click.stop="expanded = !expanded"
      >
        <BaseIcon
          v-if="hasChildren"
          :name="expanded ? 'chevronDown' : 'chevronRight'"
          :size="10"
        />
      </span>

      <!-- label -->
      <span v-if="!editing" class="flex-1 truncate flex items-baseline gap-1" @dblclick.stop="startEdit">
        {{ entity.name }}
        <span
          v-if="isPrefabRoot"
          class="shrink-0 text-[9px] text-[var(--color-accent)]/70 font-normal pointer-events-none"
        >prefab</span>
      </span>
      <input
        v-else
        ref="inputRef"
        v-model="editName"
        class="flex-1 h-5 px-1 text-xs bg-[var(--color-bg-base)] border border-[var(--color-accent)] rounded outline-none"
        @blur="commitEdit"
        @keydown.enter="commitEdit"
        @keydown.esc="cancelEdit"
        @click.stop
      />
      <!-- copy mode badge (shown while hovering with Alt held during a drag) -->
      <span
        v-if="dropZone === 'into' && dragIsCopy"
        class="shrink-0 text-[9px] font-bold px-1 rounded bg-[var(--color-accent)] text-white leading-4 pointer-events-none"
      >+copy</span>

      <!-- visibility toggle (shown on hover) -->
      <BaseButton
        variant="ghost" size="xs"
        class="opacity-0 group-hover:opacity-100 shrink-0"
        @click.stop="toggleActive"
        :title="entity.active ? 'Hide' : 'Show'"
      >
        <BaseIcon :name="entity.active ? 'eye' : 'eyeOff'" :size="11" />
      </BaseButton>

      <!-- delete -->
      <BaseButton
        variant="ghost" size="xs"
        class="opacity-0 group-hover:opacity-100 shrink-0 hover:!text-[var(--color-danger)]"
        @click.stop="deleteEntity"
        title="Delete"
      >
        <BaseIcon name="trash" :size="11" />
      </BaseButton>
    </div>

    <!-- drop-after indicator -->
    <div v-if="dropZone === 'after'" class="h-0.5 bg-[var(--color-accent)] mx-2 rounded-full" />

    <!-- children (recursive) -->
    <template v-if="expanded && hasChildren">
      <HierarchyNode
        v-for="child in childEntities"
        :key="child.id"
        :entity="child"
        :children="children"
        :depth="depth + 1"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useEditorStore }       from '@/stores/editorStore'
import { useSceneStore }        from '@/stores/sceneStore'
import { useCommandStore }      from '@/stores/commandStore'
import { useProjectStore }      from '@/stores/projectStore'
import { hierarchyDragState }   from '@/composables/useHierarchyDrag'
import {
  DestroyEntityCommand,
  RenameEntityCommand,
  SetEntityActiveCommand,
  ReparentEntityCommand,
  ReorderEntityCommand,
  CopyEntityCommand,
} from '@/core/commands/entity'
import type { Entity }          from '@/core/ecs/Entity'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon   from '@/components/base/BaseIcon.vue'

const props = defineProps<{
  entity:   Entity
  children: Map<string | null, Entity[]>
  depth:    number
}>()

const { draggingId, dragIsCopy, dropTargetId } = hierarchyDragState

const editorStore  = useEditorStore()
const sceneStore   = useSceneStore()
const commandStore = useCommandStore()
const projectStore = useProjectStore()
const expanded     = ref(true)
const editing      = ref(false)
const editName     = ref('')
const inputRef     = ref<HTMLInputElement | null>(null)

const isSelected     = computed(() => editorStore.selectedIds.has(props.entity.id))
const childEntities  = computed(() => props.children.get(props.entity.id) ?? [])
const hasChildren    = computed(() => childEntities.value.length > 0)
const isDraggingSelf = computed(() => draggingId.value === props.entity.id)
const isPrefabRoot   = computed(() => {
  sceneStore.entityList  // track worldRevision
  return props.entity.hasComponent('PrefabInstance')
})
const dropZone       = ref<'before' | 'into' | 'after' | null>(null)

function select(e: MouseEvent): void { editorStore.select(props.entity.id, e.ctrlKey || e.metaKey) }

function toggleActive(): void {
  commandStore.execute(new SetEntityActiveCommand(
    props.entity.id,
    props.entity.active,
    !props.entity.active,
  ))
}

function deleteEntity(): void {
  if (editorStore.selectedIds.has(props.entity.id)) editorStore.deselect(props.entity.id)
  commandStore.execute(new DestroyEntityCommand(props.entity.id, props.entity.name))
}

async function startEdit(): Promise<void> {
  editName.value = props.entity.name
  editing.value  = true
  await nextTick()
  inputRef.value?.select()
}
function commitEdit(): void {
  const trimmed = editName.value.trim()
  if (trimmed && trimmed !== props.entity.name) {
    commandStore.execute(new RenameEntityCommand(props.entity.id, props.entity.name, trimmed))
  }
  editing.value = false
}
function cancelEdit(): void { editing.value = false }

// ── Drag & Drop ──────────────────────────────────────────────────

/** Returns true if `ancestorId` is an ancestor of `entityId` in the children map. */
function isDescendantOf(entityId: string, ancestorId: string): boolean {
  const kids = props.children.get(ancestorId) ?? []
  for (const k of kids) {
    if (k.id === entityId) return true
    if (isDescendantOf(entityId, k.id)) return true
  }
  return false
}

function onDragStart(e: DragEvent): void {
  draggingId.value = props.entity.id
  dragIsCopy.value = e.altKey
  if (e.dataTransfer) {
    // 'all' lets the file browser request a 'copy' drop (save prefab)
    // while hierarchy-to-hierarchy rearranges still use 'move'/'copy' via dropEffect
    e.dataTransfer.effectAllowed = 'all'
    e.dataTransfer.setData('text/plain', props.entity.id)
    e.dataTransfer.setData('application/nebu-entity', props.entity.id)
  }
}

function onDragEnd(): void {
  draggingId.value   = null
  dragIsCopy.value   = false
  dropTargetId.value = null
  dropZone.value     = null
}

function onDragOver(e: DragEvent): void {
  // Accept prefab drops from the file browser (always as 'into' this node)
  if (e.dataTransfer?.types.includes('application/nebu-prefab')) {
    e.preventDefault()
    dropZone.value     = 'into'
    dropTargetId.value = props.entity.id
    return
  }
  if (!draggingId.value) return
  if (draggingId.value === props.entity.id) return
  if (isDescendantOf(props.entity.id, draggingId.value)) return
  e.preventDefault()
  dragIsCopy.value = e.altKey
  if (e.dataTransfer) e.dataTransfer.dropEffect = dragIsCopy.value ? 'copy' : 'move'

  // Determine drop zone: top third = before, bottom third = after, middle = into
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const relY = (e.clientY - rect.top) / rect.height
  dropZone.value     = relY < 0.33 ? 'before' : relY > 0.67 ? 'after' : 'into'
  dropTargetId.value = dropZone.value === 'into' ? props.entity.id : null
}

function onDragLeave(): void {
  dropZone.value     = null
  dropTargetId.value = null
}

function onDrop(e: DragEvent): void {
  e.preventDefault()

  // ── Prefab drop → instantiate as child of this entity ─────────────
  const prefabGuid = e.dataTransfer?.getData('application/nebu-prefab')
  if (prefabGuid) {
    dropZone.value     = null
    dropTargetId.value = null
    projectStore.instantiatePrefabByGuid(prefabGuid, props.entity.id)
    return
  }

  const sourceId = draggingId.value
  const zone     = dropZone.value
  const isCopy   = dragIsCopy.value
  draggingId.value   = null
  dragIsCopy.value   = false
  dropTargetId.value = null
  dropZone.value     = null

  if (!sourceId || sourceId === props.entity.id) return
  if (isDescendantOf(props.entity.id, sourceId)) return

  const sourceEntity = sceneStore.activeScene?.world.getEntity(sourceId)

  if (zone === 'before' || zone === 'after') {
    if (isCopy) {
      commandStore.execute(new CopyEntityCommand(sourceId, props.entity.parentId ?? null))
    } else {
      commandStore.execute(new ReorderEntityCommand(sourceId, props.entity.id, zone === 'before'))
    }
    return
  }

  // 'into' zone (or null fall-through)
  if (isCopy) {
    commandStore.execute(new CopyEntityCommand(sourceId, props.entity.id))
  } else {
    const oldParentId = sourceEntity?.parentId ?? null
    commandStore.execute(new ReparentEntityCommand(sourceId, oldParentId, props.entity.id))
  }
}
</script>
