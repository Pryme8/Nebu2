<template>
  <!-- Console Panel — log output -->
  <div class="flex flex-col h-full">
    <div class="flex items-center h-7 px-2 gap-2 border-b border-[var(--color-border)] panel-elevated shrink-0">
      <span class="text-[11px] text-[var(--color-text-muted)]">{{ entries.length }} entries</span>
      <div class="flex-1" />
      <!-- Filter toggles -->
      <BaseButton
        v-for="level in levels"
        :key="level.key"
        variant="ghost" size="xs"
        :class="filters.has(level.key) ? 'opacity-100' : 'opacity-30'"
        @click="toggleFilter(level.key)"
      >
        <span :style="{ color: level.color }">{{ level.label }}</span>
      </BaseButton>
      <BaseButton variant="ghost" size="xs" @click="clear" title="Clear">
        <BaseIcon name="trash" :size="11" />
      </BaseButton>
    </div>

    <div ref="scrollEl" class="flex-1 overflow-y-auto font-mono text-[11px]">
      <div
        v-for="(entry, i) in filtered"
        :key="i"
        :class="[
          'flex items-start gap-2 px-2 py-0.5 border-b border-[var(--color-border)]/30',
          entry.level === 'error'   ? 'bg-[var(--color-danger)]/8 text-[var(--color-danger)]' :
          entry.level === 'warn'    ? 'bg-[var(--color-warning)]/8 text-[var(--color-warning)]' :
          'text-[var(--color-text-secondary)]'
        ]"
      >
        <span class="shrink-0 text-[var(--color-text-muted)]">{{ entry.time }}</span>
        <span class="flex-1 break-all whitespace-pre-wrap">{{ entry.message }}</span>
      </div>
      <div v-if="filtered.length === 0" class="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
        Console is empty.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon   from '@/components/base/BaseIcon.vue'

type LogLevel = 'log' | 'warn' | 'error' | 'info'
interface LogEntry { level: LogLevel; message: string; time: string }

const levels = [
  { key: 'log'   as LogLevel, label: 'Log',   color: 'var(--color-text-secondary)' },
  { key: 'info'  as LogLevel, label: 'Info',  color: '#38bdf8' },
  { key: 'warn'  as LogLevel, label: 'Warn',  color: 'var(--color-warning)' },
  { key: 'error' as LogLevel, label: 'Error', color: 'var(--color-danger)' },
]

const entries  = ref<LogEntry[]>([])
const filters  = ref<Set<LogLevel>>(new Set(['log','info','warn','error']))
const scrollEl = ref<HTMLElement | null>(null)
const filtered = computed(() => entries.value.filter(e => filters.value.has(e.level)))

function toggleFilter(l: LogLevel) {
  if (filters.value.has(l)) filters.value.delete(l)
  else filters.value.add(l)
}
function clear() { entries.value = [] }

function fmt(args: unknown[]) {
  return args.map(a => {
    if (a === null)              return 'null'
    if (a === undefined)         return 'undefined'
    if (typeof a !== 'object')   return String(a)
    // Safe stringify: skip circular refs and non-plain objects gracefully
    try {
      const seen = new WeakSet()
      return JSON.stringify(a, (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]'
          seen.add(v)
          // Don't try to serialize Babylon/DOM objects — just show constructor name
          if (v.constructor && v.constructor.name !== 'Object' && v.constructor.name !== 'Array') {
            return `[${v.constructor.name}]`
          }
        }
        return v
      })
    } catch {
      return String(a)
    }
  }).join(' ')
}
function now() { return new Date().toLocaleTimeString('en', { hour12: false }) }

// Intercept console
const _orig = { log: console.log, warn: console.warn, error: console.error, info: console.info }

function push(level: LogLevel, ...args: unknown[]) {
  entries.value.push({ level, message: fmt(args), time: now() })
  nextTick(() => { if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight })
}

onMounted(() => {
  console.log   = (...a) => { _orig.log(...a);   push('log',   ...a) }
  console.warn  = (...a) => { _orig.warn(...a);  push('warn',  ...a) }
  console.error = (...a) => { _orig.error(...a); push('error', ...a) }
  console.info  = (...a) => { _orig.info(...a);  push('info',  ...a) }
  console.log('[Nebu2] Console ready')
})

onUnmounted(() => {
  Object.assign(console, _orig)
})
</script>
