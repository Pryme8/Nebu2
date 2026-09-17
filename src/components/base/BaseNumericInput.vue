<template>
  <div class="flex flex-col gap-0.5">
    <label
      v-if="label"
      class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide select-none"
    >{{ label }}</label>
    <div class="flex items-center gap-1">
      <!-- numeric input -->
      <input
        type="number"
        :value="modelValue ?? ''"
        :placeholder="modelValue === null ? '−' : ''"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        class="w-full h-6 px-2 text-xs rounded bg-[var(--color-bg-base)] border border-[var(--color-border)]
               text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]
               disabled:opacity-50 disabled:pointer-events-none transition-colors
               [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        @input="onInput"
        @wheel="onWheel"
        ref="inputEl"
      />
      <!-- drag handle indicator -->
      <span
        class="text-[var(--color-text-muted)] cursor-ew-resize select-none px-0.5 hover:text-[var(--color-text-secondary)]"
        @mousedown.prevent="onHandleMouseDown"
        title="Drag to scrub"
      >⇔</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, useTemplateRef } from 'vue'
import { useStatusStore } from '@/stores/statusStore'

const props = withDefaults(defineProps<{
  modelValue: number | null
  label?:     string
  min?:       number
  max?:       number
  step?:      number
  disabled?:  boolean
}>(), { step: 0.1 })

const statusStore = useStatusStore()
const inputEl = useTemplateRef<HTMLInputElement>('inputEl')

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function round(v: number) {
  return parseFloat(v.toPrecision(10))
}

function clamp(v: number) {
  let r = v
  if (props.min !== undefined) r = Math.max(props.min, r)
  if (props.max !== undefined) r = Math.min(props.max, r)
  return r
}

function onInput(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  if (!isNaN(val)) emit('update:modelValue', clamp(val))
}

function onWheel(e: WheelEvent) {
  if (document.activeElement !== inputEl.value) return
  e.preventDefault()
  e.stopPropagation()
  const delta = e.deltaY < 0 ? props.step! : -props.step!
  emit('update:modelValue', round(clamp((props.modelValue ?? 0) + delta)))
}

// Drag-to-scrub
const STEP_NORMAL    = 0.1
const STEP_PRECISION = 0.001

let scrubStartX = 0
let scrubStartVal = 0
const scrubbing   = ref(false)
const isPrecision = ref(false)

function updateStatus(precision: boolean) {
  if (precision) {
    statusStore.set('Precision Mode', '[Alt] Normal Mode')
  } else {
    statusStore.set('Scrubbing value', 'Hold [Alt] for Precision Mode')
  }
}

function onHandleMouseDown(e: MouseEvent) {
  if (e.button !== 0 || props.disabled) return
  scrubbing.value   = true
  isPrecision.value = e.altKey
  scrubStartX   = e.clientX
  scrubStartVal = props.modelValue ?? 0
  document.addEventListener('mousemove', onScrubMove)
  document.addEventListener('mouseup',   onScrubUp)
  document.body.style.cursor = 'ew-resize'
  updateStatus(e.altKey)
}

function onScrubMove(e: MouseEvent) {
  if (!scrubbing.value) return
  const precision = e.altKey
  if (precision !== isPrecision.value) {
    // Alt was toggled mid-drag: rebase so value doesn't jump
    scrubStartX   = e.clientX
    scrubStartVal = props.modelValue ?? scrubStartVal
    isPrecision.value = precision
    updateStatus(precision)
  }
  const step = precision ? STEP_PRECISION : STEP_NORMAL
  const dx   = (e.clientX - scrubStartX) * step
  emit('update:modelValue', round(clamp(scrubStartVal + dx)))
}

function onScrubUp() {
  scrubbing.value   = false
  isPrecision.value = false
  document.removeEventListener('mousemove', onScrubMove)
  document.removeEventListener('mouseup',   onScrubUp)
  document.body.style.cursor = ''
  statusStore.clear()
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onScrubMove)
  document.removeEventListener('mouseup',   onScrubUp)
  statusStore.clear()
})
</script>
