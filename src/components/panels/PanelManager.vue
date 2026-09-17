<template>
  <!--
    PanelManager — Root orchestrator.
    Panels are absolute-positioned within this relative container.
    The slot renders the underlay (BabylonViewport) at z-index 0.
  -->
  <div ref="rootRef" class="relative w-full h-full overflow-hidden" id="editor-root">
    <!-- Underlay slot (3D viewport etc.) — sits behind all panels -->
    <slot />

    <!-- Floating panels (not in a group) -->
    <PanelWindow
      v-for="panel in store.floatingPanels"
      :key="panel.id"
      :panelId="panel.id"
      :registry="registry"
    />

    <!-- Tab groups -->
    <PanelGroupView
      v-for="group in store.allGroups"
      :key="group.id"
      :groupId="group.id"
      :registry="registry"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from 'vue'
import PanelWindow    from './PanelWindow.vue'
import PanelGroupView from './PanelGroup.vue'
import { usePanelStore } from '@/stores/panelStore'

defineProps<{ registry: Record<string, unknown> }>()

const store   = usePanelStore()
const rootRef = shallowRef<HTMLElement | null>(null)
let resizeObs: ResizeObserver | null = null

function syncViewport() {
  const el = rootRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  store.setViewport(r.left, r.top, r.width, r.height)
}

onMounted(() => {
  syncViewport()
  resizeObs = new ResizeObserver(syncViewport)
  resizeObs.observe(rootRef.value!)
})
onUnmounted(() => resizeObs?.disconnect())
</script>
