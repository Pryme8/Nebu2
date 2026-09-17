<!-- AnimationPanel — main NLE panel: toolbar + timeline + optional curve editor -->
<template>
  <div class="flex flex-col h-full bg-[var(--color-bg-panel)] overflow-hidden">

    <!-- ── Empty / no-clip state ── -->
    <div
      v-if="!animStore.activeClip"
      class="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-text-muted)] px-4"
    >
      <BaseIcon name="animation" :size="28" class="opacity-25" />
      <p class="text-xs text-center select-none">
        Select an entity with an <strong class="text-[var(--color-text-secondary)]">Animation</strong>
        component and click <em>Edit</em> on a clip to open the timeline.
      </p>
    </div>

    <!-- ── Active editing state ── -->
    <template v-else>
      <AnimationToolbar />

      <!-- Timeline + optional curve splitter -->
      <div class="flex flex-1 min-h-0">
        <AnimationTimeline class="flex-1 min-w-0" />

        <!-- Curve editor side panel -->
        <div
          v-if="showCurveEditor"
          class="w-36 shrink-0 border-l border-[var(--color-border)]"
        >
          <AnimationCurveEditor :easing="selectedTrackEasing" />
        </div>
      </div>

      <!-- ── Keyframe value editor footer ── -->
      <div
        v-if="selectedKf"
        class="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-bg-surface)]"
      >
        <BaseIcon name="keyframe" :size="10" class="text-[var(--color-accent)] shrink-0" />
        <span class="text-[10px] text-[var(--color-text-muted)] shrink-0 select-none w-20 truncate">
          {{ selectedKfTrack?.property }}
        </span>
        <span class="text-[10px] text-[var(--color-text-muted)] shrink-0 select-none">f{{ selectedKf.frame }}</span>
        <div class="flex items-center gap-1 flex-1 min-w-0">
          <!-- Float -->
          <template v-if="selectedKfTrack?.valueType === 'Float'">
            <BaseNumericInput
              :modelValue="(selectedKf.value as number)"
              :step="0.01"
              class="flex-1"
              @update:modelValue="v => setKfValue(v ?? 0)"
            />
          </template>
          <!-- Vector2 -->
          <template v-else-if="selectedKfTrack?.valueType === 'Vector2'">
            <BaseNumericInput :modelValue="(selectedKf.value as number[])[0]" label="X" :step="0.01" class="flex-1" @update:modelValue="v => setKfComponent(0, v ?? 0)" />
            <BaseNumericInput :modelValue="(selectedKf.value as number[])[1]" label="Y" :step="0.01" class="flex-1" @update:modelValue="v => setKfComponent(1, v ?? 0)" />
          </template>
          <!-- Vector3 / Color3 -->
          <template v-else-if="selectedKfTrack?.valueType === 'Vector3' || selectedKfTrack?.valueType === 'Color3'">
            <BaseNumericInput :modelValue="(selectedKf.value as number[])[0]" :label="selectedKfTrack.valueType === 'Color3' ? 'R' : 'X'" :step="0.01" class="flex-1" @update:modelValue="v => setKfComponent(0, v ?? 0)" />
            <BaseNumericInput :modelValue="(selectedKf.value as number[])[1]" :label="selectedKfTrack.valueType === 'Color3' ? 'G' : 'Y'" :step="0.01" class="flex-1" @update:modelValue="v => setKfComponent(1, v ?? 0)" />
            <BaseNumericInput :modelValue="(selectedKf.value as number[])[2]" :label="selectedKfTrack.valueType === 'Color3' ? 'B' : 'Z'" :step="0.01" class="flex-1" @update:modelValue="v => setKfComponent(2, v ?? 0)" />
          </template>
          <!-- Quaternion / Color4 -->
          <template v-else-if="selectedKfTrack?.valueType === 'Quaternion' || selectedKfTrack?.valueType === 'Color4'">
            <BaseNumericInput :modelValue="(selectedKf.value as number[])[0]" :label="selectedKfTrack.valueType === 'Color4' ? 'R' : 'X'" :step="0.01" class="flex-1" @update:modelValue="v => setKfComponent(0, v ?? 0)" />
            <BaseNumericInput :modelValue="(selectedKf.value as number[])[1]" :label="selectedKfTrack.valueType === 'Color4' ? 'G' : 'Y'" :step="0.01" class="flex-1" @update:modelValue="v => setKfComponent(1, v ?? 0)" />
            <BaseNumericInput :modelValue="(selectedKf.value as number[])[2]" :label="selectedKfTrack.valueType === 'Color4' ? 'B' : 'Z'" :step="0.01" class="flex-1" @update:modelValue="v => setKfComponent(2, v ?? 0)" />
            <BaseNumericInput :modelValue="(selectedKf.value as number[])[3]" :label="selectedKfTrack.valueType === 'Color4' ? 'A' : 'W'" :step="0.01" class="flex-1" @update:modelValue="v => setKfComponent(3, v ?? 0)" />
          </template>
        </div>
      </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAnimationStore }    from '@/stores/animationStore'
import { useCommandStore }      from '@/stores/commandStore'
import { InsertKeyframeCommand } from '@/core/commands/animation'
import BaseIcon                 from '@/components/base/BaseIcon.vue'
import BaseNumericInput         from '@/components/base/BaseNumericInput.vue'
import AnimationToolbar         from '@/components/editor/AnimationToolbar.vue'
import AnimationTimeline        from '@/components/editor/AnimationTimeline.vue'
import AnimationCurveEditor     from '@/components/editor/AnimationCurveEditor.vue'
import type { EasingDef, KeyframeDef, AnimationTrackDef } from '@/types/animation'

const animStore    = useAnimationStore()
const commandStore = useCommandStore()

const showCurveEditor = computed(() => animStore.selectedTrackIds.size === 1)

const selectedTrackEasing = computed<EasingDef | null>(() => {
  const clip = animStore.activeClip
  if (!clip) return null
  const [tid] = [...animStore.selectedTrackIds]
  const track = clip.tracks.find(t => t.id === tid)
  return track?.easing ?? null
})

// ── Selected keyframe resolution ─────────────────────────────────────────

/** The single selected keyframe, or null if 0 or 2+ are selected. */
const selectedKf = computed<KeyframeDef | null>(() => {
  if (animStore.selectedKeyframes.size !== 1) return null
  const [key] = [...animStore.selectedKeyframes]
  const [trackId, frameStr] = key.split(':')
  const frame = Number(frameStr)
  const clip = animStore.activeClip
  const track = clip?.tracks.find(t => t.id === trackId)
  return track?.keyframes.find(k => k.frame === frame) ?? null
})

const selectedKfTrack = computed<AnimationTrackDef | null>(() => {
  if (animStore.selectedKeyframes.size !== 1) return null
  const [key] = [...animStore.selectedKeyframes]
  const [trackId] = key.split(':')
  return animStore.activeClip?.tracks.find(t => t.id === trackId) ?? null
})

// ── Value editing ─────────────────────────────────────────────────────────

function _commitKfValue(value: number | number[]): void {
  const kf    = selectedKf.value
  const track = selectedKfTrack.value
  const eid   = animStore.activeEntityId
  const cid   = animStore.activeClipId
  if (!kf || !track || !eid || !cid) return
  commandStore.execute(new InsertKeyframeCommand(eid, cid, track.id, kf.frame, value))
}

function setKfValue(v: number): void {
  _commitKfValue(v)
}

function setKfComponent(index: number, v: number): void {
  const kf = selectedKf.value
  if (!kf) return
  const arr = [...(kf.value as number[])]
  arr[index] = v
  _commitKfValue(arr)
}
</script>
