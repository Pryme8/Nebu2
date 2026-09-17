<template>
  <!-- Top-level editor toolbar: tool switcher, play/pause, settings -->
  <div class="flex items-center h-9 px-3 gap-px border-b border-[var(--color-border)] panel-elevated shrink-0 select-none">
    <!-- Left: tool buttons -->
    <div class="flex items-center gap-0.5 mr-3">
      <BaseButton
        v-for="tool in tools"
        :key="tool.id"
        variant="ghost" size="sm"
        :class="editorStore.activeTool === tool.id ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : ''"
        :title="`${tool.label} (${tool.key})`"
        @click="editorStore.activeTool = tool.id as any"
      >
        <BaseIcon :name="tool.icon" :size="13" />
      </BaseButton>
    </div>

    <div class="w-px h-5 bg-[var(--color-border)] mx-1" />

    <!-- Gizmo space toggle -->
    <BaseButton
      variant="outline" size="xs"
      :class="editorStore.gizmoSpace === 'world' ? 'text-[var(--color-text-primary)]' : ''"
      @click="editorStore.gizmoSpace = editorStore.gizmoSpace === 'world' ? 'local' : 'world'"
      title="Toggle gizmo space (World/Local)"
    >{{ editorStore.gizmoSpace === 'world' ? 'World' : 'Local' }}</BaseButton>

    <!-- Snap toggle -->
    <BaseButton
      variant="ghost" size="xs"
      :class="editorStore.snapEnabled ? 'text-[var(--color-accent)]' : ''"
      @click="editorStore.snapEnabled = !editorStore.snapEnabled"
      title="Toggle snapping"
    >
      <span class="font-mono text-[11px]">⊡</span>
      <span class="ml-1 text-[11px]">Snap</span>
    </BaseButton>

    <div class="w-px h-5 bg-[var(--color-border)] mx-1" />

    <!-- Viewport widget toggles -->
    <BaseButton
      variant="ghost" size="sm"
      :class="editorStore.showGrid ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'"
      title="Toggle ground grid"
      @click="editorStore.showGrid = !editorStore.showGrid"
    >
      <BaseIcon name="grid" :size="13" />
    </BaseButton>
    <BaseButton
      variant="ghost" size="sm"
      :class="editorStore.showWorldAxis ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'"
      title="Toggle world axis"
      @click="editorStore.showWorldAxis = !editorStore.showWorldAxis"
    >
      <BaseIcon name="axes" :size="13" />
    </BaseButton>
    <BaseButton
      variant="ghost" size="sm"
      :class="editorStore.showCameraAxis ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'"
      title="Toggle camera axis gizmo"
      @click="editorStore.showCameraAxis = !editorStore.showCameraAxis"
    >
      <BaseIcon name="compass" :size="13" />
    </BaseButton>

    <div class="flex-1" />

    <!-- Right: play controls -->
    <div class="flex items-center gap-0.5">
      <!-- Play — visible when not in play mode -->
      <BaseButton
        v-if="!editorStore.isPlaying"
        variant="solid" size="xs"
        :title="hasCameraForPlay ? 'Play' : 'No Camera component — add a Camera to an entity first'"
        :class="!hasCameraForPlay ? 'opacity-40 cursor-not-allowed' : ''"
        @click="onPlay"
      >▶ Play</BaseButton>

      <!-- Stop — visible when playing -->
      <BaseButton
        v-if="editorStore.isPlaying"
        variant="danger" size="xs"
        title="Stop play mode"
        class="font-semibold"
        @click="onStop"
      >⏹ Stop</BaseButton>

      <BaseButton variant="ghost" size="xs" title="Pause" :disabled="!editorStore.isPlaying">⏸</BaseButton>
    </div>

    <div class="w-px h-5 bg-[var(--color-border)] mx-2" />

    <BaseButton variant="ghost" size="sm" title="Viewport Settings" @click="editorStore.openViewportSettings()">
      <BaseIcon name="settings" :size="13" />
    </BaseButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore }       from '@/stores/editorStore'
import { useSceneStore }        from '@/stores/sceneStore'
import { useNotificationStore } from '@/stores/notificationStore'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon   from '@/components/base/BaseIcon.vue'

const editorStore       = useEditorStore()
const sceneStore        = useSceneStore()
const notificationStore = useNotificationStore()

const hasCameraForPlay = computed(() => sceneStore.hasCameraForPlay)

function onPlay(): void {
  if (!hasCameraForPlay.value) {
    notificationStore.warning('Add a Camera component to an entity before entering play mode.')
    return
  }
  editorStore.startPlay()
}

function onStop(): void {
  editorStore.stopPlay()
}

const tools = [
  { id: 'select',    icon: 'cursor',   label: 'Select',    key: 'Q' },
  { id: 'translate', icon: 'move',     label: 'Translate', key: 'W' },
  { id: 'rotate',    icon: 'rotate',   label: 'Rotate',    key: 'E' },
  { id: 'scale',     icon: 'scale',    label: 'Scale',     key: 'R' },
]
</script>
