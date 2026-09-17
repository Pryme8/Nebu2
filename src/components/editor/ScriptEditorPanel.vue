<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center h-7 px-2 gap-1.5 border-b border-[var(--color-border)] panel-elevated shrink-0 select-none">
      <BaseIcon name="script" :size="12" class="text-[var(--color-accent)]/70 shrink-0" />
      <span class="flex-1 text-xs font-medium truncate text-[var(--color-text-secondary)]">
        {{ fileName ?? 'Script Editor' }}
        <span v-if="dirty" class="text-[var(--color-accent)]">*</span>
      </span>
      <BaseButton variant="ghost" size="xs" :disabled="!dirty || !relPath" title="Save (Ctrl+S)" @click="save">
        <BaseIcon name="save" :size="12" />
      </BaseButton>
      <BaseButton variant="ghost" size="xs" title="Close" @click="close">
        <BaseIcon name="close" :size="11" />
      </BaseButton>
    </div>

    <!-- No script open -->
    <div
      v-if="!relPath"
      class="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]"
    >
      Double-click a <BaseIcon name="script" :size="10" class="inline mx-1" /> script file to edit it here.
    </div>

    <!-- Editor area -->
    <textarea
      v-else
      ref="editorRef"
      v-model="source"
      class="flex-1 font-mono text-xs leading-relaxed resize-none outline-none
             bg-[var(--color-bg-base)] text-[var(--color-text-primary)]
             p-3 border-0 tab-size-2"
      spellcheck="false"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      @keydown.ctrl.s.prevent="save"
      @keydown.meta.s.prevent="save"
      @keydown.tab.prevent="insertTab"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useEditorStore }  from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon   from '@/components/base/BaseIcon.vue'

const editorStore  = useEditorStore()
const projectStore = useProjectStore()

const relPath   = computed(() => editorStore.selectedScriptRelPath)
const fileName  = computed(() => {
  const p = relPath.value
  if (!p) return null
  const parts = p.split(/[/\\]/)
  return parts[parts.length - 1] ?? p
})

const source    = ref('')
const savedSource = ref('')
const dirty     = computed(() => source.value !== savedSource.value)
const editorRef = ref<HTMLTextAreaElement | null>(null)

// Load file when selection changes
watch(relPath, async (path) => {
  if (!path) { source.value = ''; savedSource.value = ''; return }
  const text = await projectStore.readScriptSource(path)
  source.value = text ?? ''
  savedSource.value = source.value
}, { immediate: true })

async function save(): Promise<void> {
  if (!relPath.value || !dirty.value) return
  await projectStore.writeScriptSource(relPath.value, source.value)
  savedSource.value = source.value
}

function close(): void {
  editorStore.selectScript(null)
}

function insertTab(e: KeyboardEvent): void {
  const ta = e.target as HTMLTextAreaElement
  const start = ta.selectionStart
  const end   = ta.selectionEnd
  source.value = source.value.slice(0, start) + '  ' + source.value.slice(end)
  // Restore cursor after next tick
  requestAnimationFrame(() => {
    ta.selectionStart = ta.selectionEnd = start + 2
  })
}

// Global Ctrl+S when this panel is focused
function _onKeyDown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && document.activeElement === editorRef.value) {
    e.preventDefault()
    save()
  }
}

onMounted(() => window.addEventListener('keydown', _onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', _onKeyDown))
</script>
