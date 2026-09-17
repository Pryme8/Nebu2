<template>
  <div
    class="flex items-center justify-between px-3 h-6 shrink-0 border-t border-[var(--color-border)]
           bg-[var(--color-bg-surface)] text-[11px] select-none"
  >
    <!-- Left: status message -->
    <span class="text-[var(--color-text-secondary)] truncate">
      {{ statusStore.message }}
    </span>

    <!-- Right: key hint -->
    <span v-if="statusStore.hint" class="flex items-center gap-1.5 text-[var(--color-text-muted)] shrink-0 ml-4">
      <template v-for="(segment, i) in parsedHint" :key="i">
        <kbd
          v-if="segment.isKey"
          class="px-1 py-px rounded border border-[var(--color-border)]
                 bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]
                 font-sans leading-none"
        >{{ segment.text }}</kbd>
        <span v-else>{{ segment.text }}</span>
      </template>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStatusStore } from '@/stores/statusStore'

const statusStore = useStatusStore()

/**
 * Parse hint string like "Hold [Alt] for Precision Mode" into segments.
 * Text inside [...] is rendered as a <kbd> key pill.
 */
const parsedHint = computed(() => {
  const segments: { text: string; isKey: boolean }[] = []
  const parts = statusStore.hint.split(/(\[[^\]]+\])/)
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('[') && part.endsWith(']')) {
      segments.push({ text: part.slice(1, -1), isKey: true })
    } else {
      segments.push({ text: part, isKey: false })
    }
  }
  return segments
})
</script>
