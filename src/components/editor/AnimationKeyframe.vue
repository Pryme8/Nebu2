<!-- AnimationKeyframe — draggable diamond keyframe widget positioned inside a track lane -->
<template>
  <div
    class="absolute top-1/2 -translate-y-1/2 w-3 h-3 cursor-pointer transition-colors"
    :style="{ left: `calc(${posPercent}% - 6px)` }"
    :title="`Frame ${frame}`"
    @mousedown.stop="onMouseDown"
  >
    <!-- Diamond (rotated square) -->
    <div
      class="w-3 h-3 rotate-45 border transition-colors"
      :class="selected
        ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
        : 'bg-[var(--color-bg-panel)] border-[var(--color-accent)]/70 hover:bg-[var(--color-accent)]/40'"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted } from 'vue'

const props = defineProps<{
  frame:        number
  scrollOffset: number  // first visible frame
  zoomFrames:   number  // how many frames fit in 100%
  selected:     boolean
}>()

const emit = defineEmits<{
  select: [frame: number, additive: boolean]
  move:   [deltaFrames: number]
}>()

/** Position of keyframe as a percentage of the lane width. */
const posPercent = computed(() =>
  ((props.frame - props.scrollOffset) / props.zoomFrames) * 100
)

// ── Drag handling ──────────────────────────────────────────────────────────

let _dragStartX  = 0
let _dragging = false

function onMouseDown(e: MouseEvent): void {
  e.preventDefault()
  emit('select', props.frame, e.ctrlKey || e.metaKey || e.shiftKey)

  _dragStartX = e.clientX
  _dragging   = false

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup',   onMouseUp)
}

function onMouseMove(e: MouseEvent): void {
  const pxDelta = e.clientX - _dragStartX
  if (Math.abs(pxDelta) > 3) _dragging = true
  if (!_dragging) return

  // We don't know the lane pixel width here — emit a "frames moved" event
  // and let the parent (AnimationTrackRow) resolve px → frames.
  emit('move', pxDelta)
}

function onMouseUp(): void {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup',   onMouseUp)
  _dragging = false
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup',   onMouseUp)
})
</script>
