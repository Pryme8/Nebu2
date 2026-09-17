<!-- AnimationTrackRow — a single property track with keyframes in the timeline -->
<template>
  <div class="flex h-8 border-b border-[var(--color-border)]/40">
    <!-- ── Left: label column ── -->
    <div
      class="shrink-0 flex items-center gap-1 px-2 border-r border-[var(--color-border)] bg-[var(--color-bg-surface)]"
      :style="{ width: LABEL_W + 'px' }"
    >
      <!-- Mute toggle -->
      <button
        class="w-4 h-4 flex items-center justify-center rounded shrink-0 transition-opacity"
        :class="track.muted ? 'opacity-30' : 'opacity-70 hover:opacity-100'"
        :title="track.muted ? 'Unmute track' : 'Mute track'"
        @click.stop="toggleMute"
      >
        <BaseIcon :name="track.muted ? 'warning' : 'check'" :size="8" />
      </button>
      <!-- Property name -->
      <span
        class="flex-1 text-[10px] truncate select-none"
        :class="track.muted ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'"
      >{{ shortName }}</span>
      <!-- Insert keyframe at current frame -->
      <button
        class="w-4 h-4 flex items-center justify-center rounded shrink-0
               text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
        title="Insert keyframe at current frame (samples live value)"
        @click.stop="onInsertKeyframe"
      >
        <BaseIcon name="addKeyframe" :size="10" />
      </button>
    </div>

    <!-- ── Right: keyframe lane ── -->
    <div
      ref="laneEl"
      class="relative flex-1 overflow-hidden cursor-pointer"
      :class="isLaneSelected ? 'bg-[var(--color-accent)]/5' : 'bg-[var(--color-bg-panel)]'"
      @click.self="onLaneClick"
      @dblclick="onAddKeyframe"
    >
      <!-- Zebra frame background guide at current frame -->
      <div
        class="absolute top-0 bottom-0 w-px bg-[var(--color-accent)]/30 pointer-events-none"
        :style="{ left: `${scrubberPct}%` }"
      />

      <AnimationKeyframe
        v-for="kf in track.keyframes"
        :key="kf.frame"
        :frame="kf.frame"
        :scrollOffset="animStore.scrollOffset"
        :zoomFrames="animStore.zoomFrames"
        :selected="animStore.isKeyframeSelected(track.id, kf.frame)"
        @select="(f, add) => onKeyframeSelect(f, add)"
        @move="(dx) => onKeyframeMove(kf.frame, dx)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAnimationStore } from '@/stores/animationStore'
import { useCommandStore }   from '@/stores/commandStore'
import {
  InsertKeyframeCommand,
  MoveKeyframesCommand,
  DeleteKeyframesCommand,
} from '@/core/commands/animation'
import type { AnimationTrackDef } from '@/types/animation'
import BaseIcon          from '@/components/base/BaseIcon.vue'
import AnimationKeyframe from '@/components/editor/AnimationKeyframe.vue'

const LABEL_W = 140

const props = defineProps<{
  track:    AnimationTrackDef
  entityId: string
  clipId:   string
}>()

const animStore   = useAnimationStore()
const commandStore = useCommandStore()
const laneEl = ref<HTMLElement | null>(null)

const shortName = computed(() => {
  // e.g. "position.x" → "position.x", trim leading path
  return props.track.property.split('.').slice(-2).join('.')
})

const isLaneSelected = computed(() => animStore.selectedTrackIds.has(props.track.id))

const scrubberPct = computed(() =>
  ((animStore.currentFrame - animStore.scrollOffset) / animStore.zoomFrames) * 100
)

// ── Mute ─────────────────────────────────────────────────────────────────

function toggleMute(): void {
  props.track.muted = !props.track.muted
}

function onInsertKeyframe(): void {
  // Delegates to animationStore which samples the live Babylon node value
  animStore.insertKeyframeAtCurrentFrame(props.track.id)
}

// ── Delete selected keyframes via keyboard ───────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const selected = [...animStore.selectedKeyframes]
    .filter(k => k.startsWith(props.track.id + ':'))
    .map(k => ({ trackId: props.track.id, frame: Number(k.split(':')[1]) }))
  if (selected.length === 0) return
  e.preventDefault()
  commandStore.execute(new DeleteKeyframesCommand(props.entityId, props.clipId, selected))
  animStore.clearKeyframeSelection()
}

onMounted(()  => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

// ── Keyframe interactions ─────────────────────────────────────────────────

function onKeyframeSelect(frame: number, additive: boolean): void {
  animStore.selectKeyframe(props.track.id, frame, additive)
  animStore.seekTo(frame)
}

function onKeyframeMove(frame: number, pxDelta: number): void {
  if (!laneEl.value) return
  const laneW = laneEl.value.clientWidth
  const pxPerFrame = laneW / animStore.zoomFrames
  const deltaFrames = Math.round(pxDelta / pxPerFrame)
  if (deltaFrames === 0) return

  // Move all selected keyframes by delta, or just this one if not selected
  const isSelected = animStore.isKeyframeSelected(props.track.id, frame)
  const keysToMove: Array<{ trackId: string; frame: number }> = isSelected
    ? [...animStore.selectedKeyframes].flatMap(k => {
        const [tid, f] = k.split(':')
        return tid ? [{ trackId: tid, frame: Number(f) }] : []
      })
    : [{ trackId: props.track.id, frame }]

  commandStore.execute(new MoveKeyframesCommand(
    props.entityId, props.clipId, keysToMove, deltaFrames,
  ))
}

function onLaneClick(e: MouseEvent): void {
  // Seek to clicked frame, clear keyframe selection
  if (!laneEl.value) return
  const rect = laneEl.value.getBoundingClientRect()
  const pct  = (e.clientX - rect.left) / rect.width
  const frame = animStore.scrollOffset + pct * animStore.zoomFrames
  animStore.seekTo(frame)
  animStore.clearKeyframeSelection()
}

function onAddKeyframe(e: MouseEvent): void {
  // Double-click adds a keyframe at the clicked frame position
  if (!laneEl.value) return
  const rect  = laneEl.value.getBoundingClientRect()
  const pct   = (e.clientX - rect.left) / rect.width
  const frame = Math.round(animStore.scrollOffset + pct * animStore.zoomFrames)
  animStore.seekTo(frame)
  commandStore.execute(new InsertKeyframeCommand(
    props.entityId, props.clipId, props.track.id, frame, null,
  ))
}
</script>
