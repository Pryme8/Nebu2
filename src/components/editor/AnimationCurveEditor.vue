<!-- AnimationCurveEditor — simple SVG easing curve preview -->
<template>
  <div class="h-full flex flex-col bg-[var(--color-bg-surface)] overflow-hidden">
    <div class="px-2 py-1 border-b border-[var(--color-border)] flex items-center gap-2">
      <span class="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide select-none">Curve</span>
      <span class="text-[10px] text-[var(--color-text-secondary)] select-none truncate">{{ props.easing?.type ?? 'Linear' }}</span>
    </div>
    <div class="flex-1 min-h-0 p-2">
      <svg
        class="w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <!-- Axes -->
        <line x1="0" y1="100" x2="100" y2="100" stroke="var(--color-border)" stroke-width="0.8" />
        <line x1="0" y1="0"   x2="0"   y2="100" stroke="var(--color-border)" stroke-width="0.8" />
        <!-- Curve path -->
        <polyline
          :points="curvePoints"
          fill="none"
          stroke="var(--color-accent)"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
        <!-- Start / end dots -->
        <circle cx="0"   cy="100" r="2" fill="var(--color-accent)" />
        <circle cx="100" cy="0"   r="2" fill="var(--color-accent)" />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EasingDef } from '@/types/animation'

const props = defineProps<{
  easing?: EasingDef | null
}>()

/**
 * Compute a sampled polyline for the easing curve.
 * Without loading BJS easing functions in the component, we approximate
 * common curves analytically for display.
 */
const curvePoints = computed(() => {
  const STEPS = 50
  const type  = props.easing?.type ?? 'None'
  const mode  = props.easing?.mode ?? 'EaseInOut'

  const points: string[] = []
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    const v = sampleEasing(t, type, mode)
    // SVG coords: x goes 0→100, y goes 100→0 (inverted)
    points.push(`${t * 100},${(1 - v) * 100}`)
  }
  return points.join(' ')
})

function sampleEasing(t: number, type: string, mode: string): number {
  // Apply ease-in / ease-out / ease-in-out based on mode
  const easeIn  = (fn: (x: number) => number) => fn(t)
  const easeOut = (fn: (x: number) => number) => 1 - fn(1 - t)
  const easeInOut = (fn: (x: number) => number) =>
    t < 0.5 ? fn(2 * t) / 2 : 1 - fn(2 * (1 - t)) / 2

  const wrap = mode === 'EaseIn' ? easeIn : mode === 'EaseOut' ? easeOut : easeInOut

  switch (type) {
    case 'Sine':        return wrap(x => 1 - Math.cos(x * Math.PI / 2))
    case 'Quadratic':   return wrap(x => x * x)
    case 'Cubic':       return wrap(x => x * x * x)
    case 'Quartic':     return wrap(x => x * x * x * x)
    case 'Quintic':     return wrap(x => x * x * x * x * x)
    case 'Exponential': return wrap(x => x === 0 ? 0 : Math.pow(2, 10 * (x - 1)))
    case 'Circle':      return wrap(x => 1 - Math.sqrt(1 - x * x))
    case 'Back':        return wrap(x => { const c = 1.70158; return x * x * ((c + 1) * x - c) })
    case 'Bounce': {
      const bounce = (x: number): number => {
        const n1 = 7.5625, d1 = 2.75
        if (x < 1 / d1)        return n1 * x * x
        if (x < 2 / d1)        return n1 * (x -= 1.5 / d1)  * x + 0.75
        if (x < 2.5 / d1)      return n1 * (x -= 2.25 / d1) * x + 0.9375
        return n1 * (x -= 2.625 / d1) * x + 0.984375
      }
      return wrap(bounce)
    }
    case 'Elastic': {
      const elastic = (x: number): number => {
        if (x === 0 || x === 1) return x
        return -Math.pow(2, 10 * (x - 1)) * Math.sin((x - 1.1) * 5 * Math.PI)
      }
      return wrap(elastic)
    }
    default: return t  // Linear
  }
}
</script>
