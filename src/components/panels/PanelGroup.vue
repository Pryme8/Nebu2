<template>
  <!--
    PanelGroup — A tabbed container holding multiple panels.
    Tabs can be reordered via drag; individual tabs can be torn off into floating panels.
    Positioned absolutely inside PanelManager's relative #editor-root.
  -->
  <div
    v-if="group"
    ref="elRef"
    :style="groupStyle"
    :class="[
      'absolute flex flex-col rounded border border-[var(--color-border)] overflow-hidden shadow-2xl panel-surface',
      isDragging  ? 'ring-1 ring-[var(--color-accent)]/40' : '',
      isResizing  ? 'select-none' : '',
    ]"
    @mousedown="store.bringToFront(group.id)"
  >
      <!-- Tab bar -->
      <div
        class="flex items-end h-8 border-b border-[var(--color-border)] panel-elevated shrink-0 select-none overflow-x-auto gap-px px-1"
        @mousedown="onDragMouseDown"
      >
        <button
          v-for="tabId in group.tabOrder"
          :key="tabId"
          :class="[
            'flex items-center gap-1 h-7 px-2.5 text-xs rounded-t border border-transparent -mb-px shrink-0',
            'transition-colors cursor-pointer',
            tabId === group.activeTabId
              ? 'bg-[var(--color-bg-surface)] border-[var(--color-border)] border-b-[var(--color-bg-surface)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)]',
          ]"
          @mousedown.stop
          @click="store.setActiveTab(group.id, tabId)"
          @dblclick.stop="tearOff(tabId)"
          :title="tabLabels.get(tabId)"
        >
          <span class="truncate max-w-[120px]">{{ tabLabels.get(tabId) ?? tabId }}</span>
          <span
            class="ml-1 opacity-0 group-hover:opacity-100 hover:!opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
            @click.stop="detachOrClose(tabId)"
          >
            <BaseIcon name="close" :size="9" />
          </span>
        </button>
      </div>

      <!-- Active panel content -->
      <div class="flex-1 overflow-auto min-h-0 relative">
        <template v-for="tabId in group.tabOrder" :key="tabId">
          <div v-show="tabId === group.activeTabId" class="w-full h-full relative">
            <!-- Gate: requires project -->
            <div
              v-if="getPanel(tabId)?.requiresProject && !projectStore.isOpen"
              class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--color-bg-surface)]/80 backdrop-blur-sm"
            >
              <BaseIcon name="openFolder" :size="22" class="text-[var(--color-text-muted)]" />
              <span class="text-xs text-[var(--color-text-muted)] text-center px-3">Open or create a project first.</span>
            </div>
            <!-- Gate: requires scene -->
            <div
              v-else-if="getPanel(tabId)?.requiresScene && !sceneStore.activeScene"
              class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--color-bg-surface)]/80 backdrop-blur-sm"
            >
              <BaseIcon name="scene" :size="22" class="text-[var(--color-text-muted)]" />
              <span class="text-xs text-[var(--color-text-muted)] text-center px-3">Open a scene from the File Browser.</span>
            </div>
            <component
              :is="resolveComponent(tabId)"
              v-if="resolveComponent(tabId)"
            />
            <div v-else class="p-3 text-xs text-[var(--color-text-muted)]">
              No component for "{{ getPanel(tabId)?.component }}"
            </div>
          </div>
        </template>
      </div>

      <!-- Resize handles -->
      <PanelResizeHandles @resize="onHandleMouseDown" />
    </div>
</template>

<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { usePanelStore }   from '@/stores/panelStore'
import { useDraggable }    from '@/composables/useDraggable'
import { useResizable }    from '@/composables/useResizable'
import { useProjectStore } from '@/stores/projectStore'
import { useSceneStore }   from '@/stores/sceneStore'
import type { PanelId }    from '@/types/panel'
import BaseIcon            from '@/components/base/BaseIcon.vue'
import PanelResizeHandles  from './PanelResizeHandles.vue'

const props = defineProps<{
  groupId:  PanelId
  registry: Record<string, unknown>
}>()

const store         = usePanelStore()
const projectStore  = useProjectStore()
const sceneStore    = useSceneStore()
const group         = computed(() => store.groups.get(props.groupId))
const elRef         = shallowRef<HTMLElement | null>(null)

const groupStyle = computed(() => {
  const g  = group.value
  if (!g) return {}
  const vp = store.viewport
  return {
    left:   `${g.rect.x      * vp.width}px`,
    top:    `${g.rect.y      * vp.height}px`,
    width:  `${g.rect.width  * vp.width}px`,
    height: `${g.rect.height * vp.height}px`,
    zIndex: g.zIndex,
  }
})

const tabLabels = computed(() => {
  const map = new Map<PanelId, string>()
  group.value?.tabOrder.forEach(id => {
    map.set(id, store.panels.get(id)?.title ?? id)
  })
  return map
})

function getPanel(id: PanelId) { return store.panels.get(id) }
function resolveComponent(id: PanelId) {
  const key = store.panels.get(id)?.component
  return key ? (props.registry[key] ?? null) : null
}

// Tear off tab into floating panel (double-click tab)
function tearOff(tabId: PanelId) {
  const panel = store.panels.get(tabId)
  if (!panel) return
  // position near original group
  panel.rect.x = (group.value?.rect.x ?? 0) + 40
  panel.rect.y = (group.value?.rect.y ?? 0) + 40
  store.detachFromGroup(tabId)
}

function detachOrClose(tabId: PanelId) {
  const panel = store.panels.get(tabId)
  if (!panel) return
  if (panel.closable === false) tearOff(tabId)
  else store.removePanel(tabId)
}

// Drag from header
const { isDragging, onMouseDown: onDragMouseDown } = useDraggable(props.groupId, elRef)

// Resize
const { isResizing, onHandleMouseDown } = useResizable(props.groupId)
</script>
