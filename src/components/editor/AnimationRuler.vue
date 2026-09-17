<!-- AnimationRuler — frame-number ruler above the keyframe lanes -->
<template>
  <div
    ref="rulerEl"
    class="relative h-6 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] cursor-pointer overflow-hidden select-none shrink-0"
    @mousedown.stop="onRulerClick"
  >
    <!-- Tick marks + labels -->
    <template v-for="tick in ticks" :key="tick.frame">
      <div
        class="absolute top-0 bottom-0 w-px bg-[var(--color-border)]"
        :style="{ left: `${tick.pct}%` }"
      />
      <span
        v-if="tick.label"
        class="absolute top-0.5 text-[9px] text-[var(--color-text-muted)] leading-none"
        :style="{ left: `calc(${tick.pct}% + 2px)` }"
      >{{ tick.label }}</span>
    </template>

    <!-- Scrubber head on the ruler -->
    <div
      class="absolute top-0 bottom-0 w-px bg-[var(--color-accent)] pointer-events-none"
      :style="{ left: `${scrubberPct}%` }"
    >
      <!-- Triangle cap -->
      <div
        class="absolute -top-0 left-1/2 -translate-x-1/2 w-0 h-0"
        style="border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid var(--color-accent);"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAnimationStore } from '@/stores/animationStore'

const animStore = useAnimationStore()

const rulerEl = ref<HTMLElement | null>(null)

// ── Ticks ─────────────────────────────────────────────────────────────────

const NICE_INTERVALS = [1, 2, 5, 10, 15, 30, 60, 90, 120, 240]
const MIN_PX_PER_LABEL = 40

const ticks = computed(() => {
  const el = rulerEl.value
  const containerW = el ? el.clientWidth : 300
  const pxPerFrame = containerW / animStore.zoomFrames
  const rawInterval = MIN_PX_PER_LABEL / pxPerFrame
  const interval = NICE_INTERVALS.find(n => n >= rawInterval) ?? 240

  const frameCount  = animStore.frameCount
  const start = Math.floor(animStore.scrollOffset / interval) * interval
  const end   = animStore.scrollOffset + animStore.zoomFrames + interval

  const result: Array<{ frame: number; pct: number; label: string | null }> = []
  for (let f = start; f <= Math.min(end, frameCount); f += interval) {
    const pct   = ((f - animStore.scrollOffset) / animStore.zoomFrames) * 100
    const label = f % interval === 0 ? String(f) : null
    result.push({ frame: f, pct, label })
  }
  return result
})

const scrubberPct = computed(() =>
  ((animStore.currentFrame - animStore.scrollOffset) / animStore.zoomFrames) * 100
)

// ── Click to seek ─────────────────────────────────────────────────────────

function onRulerClick(e: MouseEvent): void {
  if (!rulerEl.value) return
  const rect = rulerEl.value.getBoundingClientRect()
  const pct  = (e.clientX - rect.left) / rect.width
  const frame = animStore.scrollOffset + pct * animStore.zoomFrames
  animStore.seekTo(frame)

  // Allow drag-seeking
  window.addEventListener('mousemove', onRulerDrag)
  window.addEventListener('mouseup',   onRulerUp)
}

function onRulerDrag(e: MouseEvent): void {
  if (!rulerEl.value) return
  const rect = rulerEl.value.getBoundingClientRect()
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  animStore.seekTo(animStore.scrollOffset + pct * animStore.zoomFrames)
}

function onRulerUp(): void {
  window.removeEventListener('mousemove', onRulerDrag)
  window.removeEventListener('mouseup',   onRulerUp)
}

// ── Resize observer so ticks recompute when container resizes ─────────────

let _ro: ResizeObserver | null = null
const _rev = ref(0)  // bump to force ticks recomputation

onMounted(() => {
  if (!rulerEl.value) return
  _ro = new ResizeObserver(() => { _rev.value++ })
  _ro.observe(rulerEl.value)
})

onUnmounted(() => {
  _ro?.disconnect()
  window.removeEventListener('mousemove', onRulerDrag)
  window.removeEventListener('mouseup',   onRulerUp)
})
</script>
