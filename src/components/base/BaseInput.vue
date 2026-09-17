<template>
  <div class="flex flex-col w-full gap-0.5">
    <label
      v-if="label"
      class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide select-none"
    >{{ label }}</label>
    <input
      v-bind="$attrs"
      :value="modelValue"
      :type="type"
      :disabled="disabled"
      :placeholder="placeholder"
      class="w-full h-6 px-2 text-xs rounded bg-[var(--color-bg-base)] border border-[var(--color-border)]
             text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]
             focus:outline-none focus:border-[var(--color-accent)]
             disabled:opacity-50 disabled:pointer-events-none transition-colors"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  modelValue?: string | number
  label?:      string
  type?:       string
  placeholder?: string
  disabled?:   boolean
}>(), { type: 'text' })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
