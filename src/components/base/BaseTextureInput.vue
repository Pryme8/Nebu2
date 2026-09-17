<template>
  <!-- Texture slot — accepts drag from the file browser or shows assigned thumbnail -->
  <div
    class="flex items-center gap-2 px-2 rounded border transition-colors select-none"
    :class="[
      isDragging
        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
        : isMissing
          ? 'border-[var(--color-danger)]/60 bg-[var(--color-danger)]/5'
          : modelValue
            ? 'border-[var(--color-border)] bg-[var(--color-bg-base)]'
            : 'border-dashed border-[var(--color-border)]',
    ]"
    style="height: 44px;"
    @dragover.prevent="onDragOver"
    @dragleave="isDragging = false"
    @drop.prevent="onDrop"
  >
<!-- Thumbnail / checkerboard / missing preview -->
      <div
        class="shrink-0 rounded overflow-hidden border border-[var(--color-border)]"
        style="width: 32px; height: 32px;"
      >
        <img
          v-if="thumbnailUrl"
          :src="thumbnailUrl"
          class="w-full h-full object-cover"
          draggable="false"
        />
        <!-- Missing asset indicator -->
        <div
          v-else-if="isMissing"
          class="w-full h-full flex items-center justify-center bg-[var(--color-danger)]/10"
        >
          <BaseIcon name="warning" :size="14" class="text-[var(--color-danger)]" />
        </div>
        <!-- CSS checkerboard — shown when no texture is assigned or no thumbnail exists -->
        <div
          v-else
          class="w-full h-full"
          style="background: repeating-conic-gradient(#888 0% 25%, #444 0% 50%) 0 0 / 8px 8px;"
        />
      </div>

      <!-- Asset name / missing hint / drag hint -->
      <span
        class="flex-1 text-xs truncate"
        :class="isMissing ? 'text-[var(--color-danger)]' : textureName ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'"
      >
        {{ isMissing ? `Missing: ${modelValue!.slice(0, 8)}…` : (textureName ?? 'Drag texture here…') }}
    </span>

    <!-- Clear button -->
    <button
      v-if="modelValue"
      class="shrink-0 opacity-60 hover:opacity-100 hover:text-[var(--color-danger)] transition-colors"
      title="Clear texture"
      @click.stop="emit('update:modelValue', null)"
    >
      <BaseIcon name="close" :size="9" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAssetStore } from '@/stores/assetStore'
import BaseIcon          from './BaseIcon.vue'

const props = defineProps<{
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const assetStore = useAssetStore()
const isDragging = ref(false)

const _entry = computed(() =>
  props.modelValue ? assetStore.assetList.find(e => e.meta.guid === props.modelValue) : undefined
)

const thumbnailUrl = computed(() => _entry.value?.meta.thumbnail ?? null)
const textureName  = computed(() => _entry.value?.name ?? null)
/** True when a GUID is stored but no matching asset exists in the pool. */
const isMissing    = computed(() => !!props.modelValue && !_entry.value)

function onDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('application/nebu-texture')) {
    isDragging.value = true
  }
}

function onDrop(e: DragEvent): void {
  isDragging.value = false
  const guid = e.dataTransfer?.getData('application/nebu-texture')
  if (guid) emit('update:modelValue', guid)
}
</script>
