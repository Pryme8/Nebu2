<template>
  <!--
    PanelWindow — A single floating/dockable panel.
    Handles: drag from header, 8-dir resize, minimize, maximize, close, snap preview.
    Positioned absolutely inside PanelManager's relative #editor-root.
  -->
  <div
    v-if="panel && panel.state !== 'minimized'"
    ref="elRef"
    :style="panelStyle"
    :class="[
      'absolute flex flex-col rounded border border-[var(--color-border)] overflow-hidden shadow-2xl',
      'panel-surface',
      isDragging ? 'ring-1 ring-[var(--color-accent)]/40' : '',
      isResizing ? 'select-none' : '',
    ]"
    @mousedown="store.bringToFront(panel.id)"
  >
      <!-- Header / drag strip -->
      <div
        class="flex items-center h-8 px-2 gap-1 border-b border-[var(--color-border)] panel-elevated cursor-grab active:cursor-grabbing select-none shrink-0"
        @mousedown="onDragMouseDown"
      >
        <!-- Icon placeholder -->
        <BaseIcon v-if="panel.icon" :name="panel.icon" :size="13" class="text-[var(--color-text-muted)]" />
        <span class="flex-1 text-xs font-medium truncate text-[var(--color-text-secondary)]">{{ panel.title }}</span>

        <!-- Window controls -->
        <BaseButton variant="ghost" size="xs" @click.stop="toggleMaximize" title="Maximize">
          <BaseIcon :name="panel.state === 'maximized' ? 'restore' : 'maximize'" :size="11" />
        </BaseButton>
        <BaseButton
          v-if="panel.closable !== false"
          variant="ghost" size="xs"
          class="hover:!text-[var(--color-danger)]"
          @click.stop="store.removePanel(panel.id)"
          title="Close"
        >
          <BaseIcon name="close" :size="11" />
        </BaseButton>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto min-h-0 relative">
        <!-- Gate overlay: requires project -->
        <div
          v-if="panel.requiresProject && !projectStore.isOpen"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--color-bg-surface)]/80 backdrop-blur-sm"
        >
          <BaseIcon name="openFolder" :size="22" class="text-[var(--color-text-muted)]" />
          <span class="text-xs text-[var(--color-text-muted)] text-center px-3">Open or create a project first.</span>
        </div>
        <!-- Gate overlay: requires scene -->
        <div
          v-else-if="panel.requiresScene && !sceneStore.activeScene"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--color-bg-surface)]/80 backdrop-blur-sm"
        >
          <BaseIcon name="scene" :size="22" class="text-[var(--color-text-muted)]" />
          <span class="text-xs text-[var(--color-text-muted)] text-center px-3">Open a scene from the File Browser.</span>
        </div>
        <component :is="resolvedComponent" v-if="resolvedComponent" />
        <div v-else class="p-3 text-xs text-[var(--color-text-muted)]">
          No component registered for "{{ panel.component }}"
        </div>
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
import type { PanelId } from '@/types/panel'
import BaseButton           from '@/components/base/BaseButton.vue'
import BaseIcon             from '@/components/base/BaseIcon.vue'
import PanelResizeHandles   from './PanelResizeHandles.vue'

// ── props ────────────────────────────────────────────────────────
const props = defineProps<{
  panelId:     PanelId
  registry:    Record<string, unknown>   // component registry
}>()

const store    = usePanelStore()
const panel    = computed(() => store.panels.get(props.panelId))
const elRef    = shallowRef<HTMLElement | null>(null)
const projectStore = useProjectStore()
const sceneStore   = useSceneStore()

// ── style  (normalized rect × viewport px) ───────────────────────
const panelStyle = computed(() => {
  const p  = panel.value
  if (!p) return {}
  if (p.state === 'maximized') {
    return { left: '0', top: '0', width: '100%', height: '100%', zIndex: p.zIndex }
  }
  const vp = store.viewport
  return {
    left:   `${p.rect.x      * vp.width}px`,
    top:    `${p.rect.y      * vp.height}px`,
    width:  `${p.rect.width  * vp.width}px`,
    height: `${p.rect.height * vp.height}px`,
    zIndex: p.zIndex,
  }
})

// ── component registry ───────────────────────────────────────────
const resolvedComponent = computed(() =>
  panel.value ? (props.registry[panel.value.component] ?? null) : null
)

// ── drag ─────────────────────────────────────────────────────────
const { isDragging, onMouseDown: onDragMouseDown } = useDraggable(props.panelId, elRef)

// ── resize ───────────────────────────────────────────────────────
const { isResizing, onHandleMouseDown } = useResizable(props.panelId)

// ── window controls ──────────────────────────────────────────────
function toggleMaximize() {
  if (!panel.value) return
  store.setPanelState(
    props.panelId,
    panel.value.state === 'maximized' ? 'floating' : 'maximized'
  )
}
</script>
