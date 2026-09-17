<template>
  <!-- Collapsible section used throughout inspector/properties panels -->
  <div class="flex flex-col border-b border-[var(--color-border)] last:border-0">
    <button
      class="flex items-center gap-1.5 w-full h-7 px-2 text-xs font-medium
             text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
             hover:bg-[var(--color-bg-overlay)] select-none transition-colors"
      @click="open = !open"
    >
      <BaseIcon :name="open ? 'chevronDown' : 'chevronRight'" :size="12" />
      <span>{{ title }}</span>
      <slot name="header-actions" />
    </button>
    <Transition name="section-expand">
      <div v-if="open" class="flex flex-col gap-1.5 px-2 pb-2 pt-1">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import BaseIcon from './BaseIcon.vue'

withDefaults(defineProps<{
  title:          string
  defaultOpen?:   boolean
}>(), { defaultOpen: true })

const open = ref(true)
</script>

<style scoped>
.section-expand-enter-active,
.section-expand-leave-active {
  transition: opacity 0.15s ease, max-height 0.2s ease;
  max-height: 600px;
  overflow: hidden;
}
.section-expand-enter-from,
.section-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
