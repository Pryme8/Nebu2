<!-- AnimationTimeline — scrollable keyframe lanes with ruler and vertical scrubber -->
<template>
  <div class="flex flex-col h-full overflow-hidden bg-[var(--color-bg-panel)]">
    <!-- Ruler row (full width) -->
    <div class="flex shrink-0">
      <!-- Corner: label column spacer -->
      <div
        class="shrink-0 border-r border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]"
        :style="{ width: LABEL_W + 'px' }"
      />
      <!-- Ruler -->
      <div class="flex-1 min-w-0">
        <AnimationRuler />
      </div>
    </div>

    <!-- Track area (scrollable vertically) -->
    <div
      ref="trackAreaEl"
      class="flex flex-1 overflow-y-auto overflow-x-hidden min-h-0"
      @wheel.prevent="onWheel"
    >
      <!-- Track rows -->
      <div class="flex flex-col flex-1 min-w-0 min-h-0">
        <template v-if="activeClip && activeClip.tracks.length > 0">
          <AnimationTrackRow
            v-for="track in activeClip.tracks"
            :key="track.id"
            :track="track"
            :entityId="animStore.activeEntityId ?? ''"
            :clipId="activeClip.id"
          />
        </template>
        <!-- Empty state -->
        <div
          v-else
          class="flex-1 flex items-center justify-center text-[11px] text-[var(--color-text-muted)] italic select-none"
        >
          No tracks — add a property track from the toolbar
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAnimationStore } from '@/stores/animationStore'
import AnimationRuler    from '@/components/editor/AnimationRuler.vue'
import AnimationTrackRow from '@/components/editor/AnimationTrackRow.vue'

const LABEL_W = 140

const animStore  = useAnimationStore()
const activeClip = computed(() => animStore.activeClip)

const trackAreaEl = ref<HTMLElement | null>(null)

// ── Wheel: zoom (Ctrl) or horizontal scroll ─────────────────────────────

function onWheel(e: WheelEvent): void {
  if (e.ctrlKey || e.metaKey) {
    // Zoom: shrink/grow zoomFrames
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    animStore.setZoom(Math.round(animStore.zoomFrames * factor))
  } else {
    // Horizontal scroll: shift scrollOffset by frames
    const pxPerFrame = (trackAreaEl.value?.clientWidth ?? 400) / animStore.zoomFrames
    const delta = e.deltaY / pxPerFrame
    animStore.setScrollOffset(animStore.scrollOffset + delta)
  }
}
</script>
