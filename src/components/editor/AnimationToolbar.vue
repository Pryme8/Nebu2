<!-- AnimationToolbar — playback transport + clip management bar -->
<template>
  <div class="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] shrink-0 overflow-x-auto">

    <!-- Entity / Clip selector -->
    <div class="flex items-center gap-1 min-w-0 shrink-0">
      <BaseIcon name="animation" :size="11" class="text-[var(--color-accent)] shrink-0" />
      <span class="text-[10px] text-[var(--color-text-muted)] truncate max-w-[80px] select-none">{{ entityName }}</span>
      <BaseIcon name="chevronRight" :size="9" class="text-[var(--color-text-muted)] shrink-0" />
      <select
        :value="animStore.activeClipId ?? ''"
        class="h-6 px-1 text-[11px] rounded bg-[var(--color-bg-base)] border border-[var(--color-border)]
               text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] max-w-[110px]"
        @change="onClipChange"
      >
        <option
          v-for="clip in allClips"
          :key="clip.id"
          :value="clip.id"
        >{{ clip.name }}</option>
      </select>
    </div>

    <div class="w-px h-4 bg-[var(--color-border)] mx-0.5 shrink-0" />

    <!-- Transport controls -->
    <div class="flex items-center gap-0.5 shrink-0">
      <BaseButton variant="ghost" size="xs" title="Go to first frame" @click="animStore.seekTo(0)">
        <BaseIcon name="skipBack" :size="11" />
      </BaseButton>
      <BaseButton variant="ghost" size="xs" :title="animStore.isPlaying ? 'Pause' : 'Play'" @click="animStore.togglePlay()">
        <BaseIcon :name="animStore.isPlaying ? 'pause' : 'play'" :size="11" />
      </BaseButton>
      <BaseButton variant="ghost" size="xs" title="Stop" @click="animStore.stop()">
        <BaseIcon name="stop" :size="11" />
      </BaseButton>
      <BaseButton variant="ghost" size="xs" title="Go to last frame" @click="animStore.seekTo(animStore.frameCount)">
        <BaseIcon name="skipForward" :size="11" />
      </BaseButton>
    </div>

    <div class="w-px h-4 bg-[var(--color-border)] mx-0.5 shrink-0" />

    <!-- Frame counter -->
    <div class="flex items-center gap-1 shrink-0">
      <BaseNumericInput
        :modelValue="animStore.currentFrame"
        :min="0"
        :max="animStore.frameCount"
        :step="1"
        class="w-14"
        @update:modelValue="v => animStore.seekTo(v ?? 0)"
      />
      <span class="text-[10px] text-[var(--color-text-muted)] select-none">/ {{ animStore.frameCount }}</span>
    </div>

    <div class="w-px h-4 bg-[var(--color-border)] mx-0.5 shrink-0" />

    <!-- Speed ratio -->
    <div class="flex items-center gap-1 shrink-0">
      <span class="text-[10px] text-[var(--color-text-muted)] select-none">×</span>
      <BaseNumericInput
        :modelValue="animStore.previewSpeed"
        :min="0.1"
        :max="4"
        :step="0.1"
        class="w-12"
        @update:modelValue="v => { if (v !== null) animStore.previewSpeed = v }"
      />
    </div>

    <div class="w-px h-4 bg-[var(--color-border)] mx-0.5 shrink-0" />

    <!-- Snap toggle -->
    <button
      class="h-6 w-6 flex items-center justify-center rounded border transition-colors"
      :class="animStore.snapToFrame
        ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
        : 'border-[var(--color-border)] text-[var(--color-text-muted)]'"
      title="Snap to frame"
      @click="animStore.snapToFrame = !animStore.snapToFrame"
    >
      <BaseIcon name="keyframe" :size="10" />
    </button>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Add Track button + dropdown -->
    <div class="relative shrink-0" ref="trackMenuAnchor">
      <BaseButton
        variant="ghost"
        size="xs"
        :disabled="!animStore.activeClipId"
        title="Add property track"
        class="gap-1 px-2"
        @click="toggleTrackMenu"
      >
        <BaseIcon name="add" :size="10" />
        <span class="text-[10px]">Add Track</span>
      </BaseButton>
    </div>

    <!-- Teleported dropdown — renders in <body> so no stacking context clips it -->
    <Teleport to="body">
      <template v-if="showTrackMenu">
        <!-- Click-outside backdrop -->
        <div class="fixed inset-0 z-[9998]" @click="showTrackMenu = false" />

        <!-- Dropdown panel -->
        <div
          class="fixed z-[9999] min-w-[200px] rounded border border-[var(--color-border)]
                 bg-[var(--color-bg-surface)] shadow-xl overflow-hidden"
          :style="dropdownStyle"
        >
          <!-- Custom property row -->
          <div class="px-2 pt-1.5 pb-1 border-b border-[var(--color-border)]">
            <div class="flex items-center gap-1">
              <input
                v-model="customProp"
                placeholder="custom.property"
                autofocus
                class="flex-1 h-5 px-1.5 text-[10px] rounded bg-[var(--color-bg-base)]
                       border border-[var(--color-border)] text-[var(--color-text-primary)]
                       focus:outline-none focus:border-[var(--color-accent)]"
                @keydown.enter="addCustomTrack"
              />
              <button
                class="h-5 px-2 text-[10px] rounded bg-[var(--color-accent)]/20
                       text-[var(--color-accent)] hover:bg-[var(--color-accent)]/40 transition-colors"
                @click="addCustomTrack"
              >Add</button>
            </div>
          </div>

          <!-- Catalogue entries grouped by category -->
          <div class="max-h-72 overflow-y-auto">
            <template v-for="(group, cat) in groupedProps" :key="cat">
              <div class="px-2 pt-1.5 pb-0.5">
                <span class="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] select-none">
                  {{ cat }}
                </span>
              </div>
              <button
                v-for="prop in group"
                :key="prop.property"
                class="w-full text-left flex items-center justify-between px-3 py-1 text-[11px]
                       text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 transition-colors"
                :disabled="isTrackPresent(prop.property)"
                :class="isTrackPresent(prop.property) ? 'opacity-30 cursor-default' : ''"
                @click="addCatalogueTrack(prop)"
              >
                <span>{{ prop.label }}</span>
                <span class="text-[9px] text-[var(--color-text-muted)] ml-2 shrink-0">{{ prop.valueType }}</span>
              </button>
            </template>
          </div>
        </div>
      </template>
    </Teleport>

    <div class="w-px h-4 bg-[var(--color-border)] mx-0.5 shrink-0" />

    <!-- Zoom controls -->
    <div class="flex items-center gap-0.5 shrink-0">
      <BaseButton variant="ghost" size="xs" title="Zoom in" @click="animStore.zoomIn()">
        <BaseIcon name="add" :size="10" />
      </BaseButton>
      <BaseButton variant="ghost" size="xs" title="Zoom out" @click="animStore.zoomOut()">
        <BaseIcon name="close" :size="10" />
      </BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAnimationStore }  from '@/stores/animationStore'
import { useSceneStore }      from '@/stores/sceneStore'
import { useCommandStore }    from '@/stores/commandStore'
import { AddAnimationTrackCommand } from '@/core/commands/animation'
import { ANIMATABLE_PROPS }   from '@/types/animation'
import type { AnimationClipDef, AnimatablePropDescriptor } from '@/types/animation'
import BaseIcon         from '@/components/base/BaseIcon.vue'
import BaseButton       from '@/components/base/BaseButton.vue'
import BaseNumericInput from '@/components/base/BaseNumericInput.vue'

const animStore    = useAnimationStore()
const sceneStore   = useSceneStore()
const commandStore = useCommandStore()

// ── Track menu state ───────────────────────────────────────────────────────
const showTrackMenu  = ref(false)
const customProp     = ref('')
const trackMenuAnchor = ref<HTMLElement | null>(null)
const dropdownStyle  = ref({ top: '0px', right: '0px' })

function toggleTrackMenu(): void {
  if (showTrackMenu.value) {
    showTrackMenu.value = false
    return
  }
  // Measure the button position before showing, then show
  const rect = trackMenuAnchor.value?.getBoundingClientRect()
  if (rect) {
    dropdownStyle.value = {
      top:   `${rect.bottom + 4}px`,
      right: `${window.innerWidth - rect.right}px`,
    }
  }
  showTrackMenu.value = true
}

/** Catalogue grouped by category for the dropdown. */
const groupedProps = computed(() => {
  const map: Record<string, AnimatablePropDescriptor[]> = {}
  for (const p of ANIMATABLE_PROPS) {
    ;(map[p.category] ??= []).push(p)
  }
  return map
})

/** True if a track for this property already exists in the active clip. */
function isTrackPresent(property: string): boolean {
  return animStore.activeClip?.tracks.some(t => t.property === property) ?? false
}

function addCatalogueTrack(prop: AnimatablePropDescriptor): void {
  showTrackMenu.value = false
  const eid = animStore.activeEntityId
  const cid = animStore.activeClipId
  if (!eid || !cid) return
  commandStore.execute(new AddAnimationTrackCommand(eid, cid, prop.property, prop.valueType))
}

function addCustomTrack(): void {
  const prop = customProp.value.trim()
  if (!prop) return
  const eid = animStore.activeEntityId
  const cid = animStore.activeClipId
  if (!eid || !cid) return
  commandStore.execute(new AddAnimationTrackCommand(eid, cid, prop, 'Float'))
  customProp.value = ''
  showTrackMenu.value = false
}

const entityName = computed(() => {
  const eid = animStore.activeEntityId
  if (!eid) return ''
  return sceneStore.activeScene?.world.getEntity(eid)?.name ?? eid.slice(0, 8)
})

const allClips = computed<AnimationClipDef[]>(() => {
  const eid = animStore.activeEntityId
  if (!eid) return []
  const entity = sceneStore.activeScene?.world.getEntity(eid)
  const comp = entity?.getComponent('Animation') as
    import('@/core/ecs/components/AnimationComponent').AnimationComponent | undefined
  return comp?.clips ?? []
})

function onClipChange(e: Event): void {
  const clipId = (e.target as HTMLSelectElement).value
  const eid = animStore.activeEntityId
  if (!eid || !clipId) return
  animStore.editClip(eid, clipId)
}
</script>
