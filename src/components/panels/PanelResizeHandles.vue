<template>
  <!-- 8 resize handles rendered as thin transparent strips around the panel -->
  <template v-for="edge in edges" :key="edge">
    <div
      :class="classList(edge)"
      @mousedown.stop.prevent="emit('resize', $event, edge)"
    />
  </template>
</template>

<script setup lang="ts">
import type { ResizeEdge } from '@/composables/useResizable'

const emit = defineEmits<{ resize: [e: MouseEvent, edge: ResizeEdge] }>()

const edges: ResizeEdge[] = ['n','s','e','w','ne','nw','se','sw']

// Static Tailwind class strings — dynamic template literals are invisible to
// Tailwind's scanner and produce zero-sized handles (the original bug).
const CLASS_MAP: Record<ResizeEdge, string> = {
  n:  'absolute z-50 select-none top-0    left-2.5 right-2.5 h-2   cursor-ns-resize',
  s:  'absolute z-50 select-none bottom-0 left-2.5 right-2.5 h-2   cursor-ns-resize',
  e:  'absolute z-50 select-none top-2.5  bottom-2.5 right-0 w-2   cursor-ew-resize',
  w:  'absolute z-50 select-none top-2.5  bottom-2.5 left-0  w-2   cursor-ew-resize',
  ne: 'absolute z-50 select-none top-0    right-0  w-2.5 h-2.5 cursor-nesw-resize',
  nw: 'absolute z-50 select-none top-0    left-0   w-2.5 h-2.5 cursor-nwse-resize',
  se: 'absolute z-50 select-none bottom-0 right-0  w-2.5 h-2.5 cursor-nwse-resize',
  sw: 'absolute z-50 select-none bottom-0 left-0   w-2.5 h-2.5 cursor-nesw-resize',
}

function classList(edge: ResizeEdge) {
  return CLASS_MAP[edge]
}
</script>
