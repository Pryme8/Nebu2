<template>
  <div
    class="flex items-center gap-3 px-2 py-1.5 rounded transition-colors"
    :class="disabled ? 'opacity-50' : 'hover:bg-[var(--color-bg-overlay)] cursor-pointer'"
    @click="!disabled && emit('toggle')"
  >
    <!-- Checkbox -->
    <div
      class="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors"
      :class="checked
        ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
        : 'border-[var(--color-border)] bg-[var(--color-bg-base)]'"
    >
      <svg v-if="checked" viewBox="0 0 10 8" class="w-2.5 h-2.5 fill-white">
        <path d="M1 4l3 3 5-6" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <!-- Label + description -->
    <div class="flex-1 min-w-0">
      <span class="text-xs font-medium text-[var(--color-text-primary)]">{{ label }}</span>
      <span class="ml-2 text-[11px] text-[var(--color-text-muted)]">{{ description }}</span>
    </div>

    <!-- Availability badge -->
    <span
      class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
      :class="available
        ? 'bg-[var(--color-success,#22c55e)]/15 text-[var(--color-success,#22c55e)]'
        : 'bg-[var(--color-bg-overlay)] text-[var(--color-text-muted)]'"
    >
      {{ available ? 'Available' : 'Not available' }}
    </span>
  </div>
</template>

<script setup lang="ts">
import type { EngineTarget } from '@/types/project'

defineProps<{
  engine:      EngineTarget
  label:       string
  description: string
  checked:     boolean
  available:   boolean
  disabled:    boolean
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>
