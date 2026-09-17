<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[9000] flex flex-col"
      style="background: var(--color-bg-base)"
      tabindex="-1"
      @keydown.esc.stop="close"
    >
      <!-- Header ──────────────────────────────────────────────────── -->
      <div class="flex items-center h-10 px-3 gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] shrink-0 select-none">
        <BaseIcon name="script" :size="14" class="text-[var(--color-accent)]/70 shrink-0" />

        <span class="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {{ fileName }}
        </span>

        <span class="text-xs text-[var(--color-text-muted)] truncate flex-1 pl-1">
          {{ relPath }}
        </span>

        <!-- Dirty indicator -->
        <span
          v-if="dirty"
          class="shrink-0 text-[var(--color-accent)] text-xs select-none"
          title="Unsaved changes"
        >●</span>

        <!-- Save button -->
        <BaseButton
          variant="ghost"
          size="xs"
          :disabled="!dirty"
          title="Save (Ctrl+S)"
          @click="save"
        >
          <BaseIcon name="save" :size="12" />
          <span class="ml-1">Save</span>
        </BaseButton>

        <!-- Close button -->
        <BaseButton variant="ghost" size="xs" title="Close (Esc)" @click="close">
          <BaseIcon name="close" :size="12" />
        </BaseButton>
      </div>

      <!-- Unsaved-changes banner ───────────────────────────────────── -->
      <div
        v-if="dirty"
        class="shrink-0 flex items-center gap-2 px-3 py-1 text-[11px]
               bg-[var(--color-accent)]/10 border-b border-[var(--color-accent)]/20
               text-[var(--color-accent)]"
      >
        <BaseIcon name="save" :size="10" />
        Unsaved changes — press <kbd class="mx-1 px-1 rounded bg-[var(--color-bg-overlay)] font-mono text-[10px]">Ctrl+S</kbd> to save.
      </div>

      <!-- Monaco code editor ─────────────────────────────────────── -->
      <MonacoEditor
        ref="editorRef"
        v-model="source"
        :filename="fileName"
        class="flex-1 min-h-0"
        @save="save"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useEditorStore }  from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import BaseButton    from '@/components/base/BaseButton.vue'
import BaseIcon      from '@/components/base/BaseIcon.vue'
import MonacoEditor  from '@/components/base/MonacoEditor.vue'

const editorStore  = useEditorStore()
const projectStore = useProjectStore()

const relPath  = computed(() => editorStore.selectedScriptRelPath ?? '')
const fileName = computed(() => {
  const parts = relPath.value.split(/[/\\]/)
  return parts[parts.length - 1] ?? relPath.value
})

const source      = ref('')
const savedSource = ref('')
const dirty       = computed(() => source.value !== savedSource.value)

const editorRef = ref<InstanceType<typeof MonacoEditor> | null>(null)

// Load file whenever the path changes
watch(relPath, async (path) => {
  if (!path) { source.value = ''; savedSource.value = ''; return }
  const text = await projectStore.readScriptSource(path)
  source.value      = text ?? ''
  savedSource.value = source.value
  await nextTick()
  editorRef.value?.focus()
}, { immediate: true })

async function save(): Promise<void> {
  if (!relPath.value || !dirty.value) return
  await projectStore.writeScriptSource(relPath.value, source.value)
  savedSource.value = source.value
}

function close(): void {
  editorStore.selectScript(null)
}

</script>
