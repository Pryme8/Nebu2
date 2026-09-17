<template>
  <button
    type="button"
    :class="[
      'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-1',
      sizeClasses,
      variantClasses,
      { 'opacity-50 pointer-events-none': disabled },
    ]"
    :disabled="disabled"
    v-bind="$attrs"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
// BaseButton — generalized button atom.
// Variants: ghost | solid | danger | outline
// Sizes:    xs | sm | md
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  variant?: 'ghost' | 'solid' | 'danger' | 'outline'
  size?:    'xs' | 'sm' | 'md'
  disabled?: boolean
}>(), {
  variant:  'ghost',
  size:     'sm',
  disabled: false,
})

const sizeClasses = {
  xs: 'px-1.5 py-0.5 text-[11px] h-5',
  sm: 'px-2 py-1 text-xs h-6',
  md: 'px-3 py-1.5 text-sm h-7',
}[props.size]

const variantClasses = {
  ghost:   'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-overlay)]',
  solid:   'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-active)]',
  danger:  'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10',
  outline: 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]',
}[props.variant]
</script>
