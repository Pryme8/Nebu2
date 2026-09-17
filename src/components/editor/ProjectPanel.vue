<template>
  <div class="flex flex-col h-full">

    <!-- ── Header toolbar ─────────────────────────────────────── -->
    <div class="flex items-center h-7 px-2 gap-1 border-b border-[var(--color-border)] panel-elevated shrink-0">
      <BaseIcon name="project" :size="12" class="text-[var(--color-text-muted)] shrink-0" />
      <span class="flex-1 text-xs font-medium truncate text-[var(--color-text-secondary)]">
        {{ projectStore.projectName ?? 'No Project' }}
      </span>
      <BaseButton
        v-if="projectStore.isOpen"
        variant="ghost" size="xs"
        title="Save Project (Ctrl+S)"
        @click="saveProject"
      >
        <BaseIcon name="save" :size="12" />
      </BaseButton>
      <BaseButton
        v-if="projectStore.isOpen"
        variant="ghost" size="xs"
        title="Import Asset"
        @click="triggerImport"
      >
        <BaseIcon name="import" :size="12" />
      </BaseButton>
      <input ref="fileInputRef" type="file" class="hidden" multiple @change="onFileSelected" />
    </div>

    <!-- ── No project open ───────────────────────────────────── -->
    <div v-if="!projectStore.isOpen" class="flex-1 flex flex-col items-center justify-center gap-3 px-4">
      <!-- New project inline form -->
      <template v-if="creatingNew">
        <p class="text-xs text-[var(--color-text-muted)] text-center">Enter a name for the new project,<br>then choose an empty folder.</p>
        <BaseInput
          v-model="newProjectName"
          placeholder="Project name…"
          class="w-full"
          @keydown.enter="confirmNew"
          @keydown.esc="creatingNew = false"
        />
        <div class="flex gap-2 w-full">
          <BaseButton variant="solid" size="sm" class="flex-1 justify-center" @click="confirmNew" :disabled="!newProjectName.trim()">
            Choose Folder…
          </BaseButton>
          <BaseButton variant="ghost" size="sm" @click="creatingNew = false">Cancel</BaseButton>
        </div>
        <p v-if="createError" class="text-xs text-[var(--color-danger)] text-center">{{ createError }}</p>
      </template>

      <template v-else>
        <BaseButton variant="solid" size="sm" class="w-full justify-center" @click="openProject">
          <BaseIcon name="openFolder" :size="13" class="mr-1" />
          Open Project…
        </BaseButton>
        <BaseButton variant="outline" size="sm" class="w-full justify-center" @click="creatingNew = true">
          <BaseIcon name="add" :size="13" class="mr-1" />
          New Project…
        </BaseButton>
        <p v-if="openError" class="text-xs text-[var(--color-danger)] text-center">{{ openError }}</p>
      </template>
    </div>

    <!-- ── Project open: file tree ────────────────────────────── -->
    <div v-else class="flex-1 overflow-y-auto py-1">
      <div v-if="projectStore.fileTree.length === 0" class="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
        Project folder is empty.
      </div>
      <FileTreeItem
        v-for="node in projectStore.fileTree"
        :key="node.name"
        :node="node"
        :depth="0"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useProjectStore } from '@/stores/projectStore'
import { useAssetStore }   from '@/stores/assetStore'
import BaseButton          from '@/components/base/BaseButton.vue'
import BaseIcon            from '@/components/base/BaseIcon.vue'
import BaseInput           from '@/components/base/BaseInput.vue'
import FileTreeItem        from './FileTreeItem.vue'

const projectStore = useProjectStore()
const assetStore   = useAssetStore()

const creatingNew    = ref(false)
const newProjectName = ref('')
const createError    = ref('')
const openError      = ref('')
const fileInputRef   = ref<HTMLInputElement | null>(null)

async function openProject(): Promise<void> {
  openError.value = ''
  try {
    const result = await projectStore.openProject()
    if (result === 'not_a_project') {
      openError.value = 'The selected folder does not contain a .nebu project file.'
    }
  } catch (err) {
    openError.value = err instanceof Error ? err.message : 'Failed to open project.'
  }
}

async function confirmNew(): Promise<void> {
  const name = newProjectName.value.trim()
  if (!name) return
  createError.value = ''
  try {
    const ok = await projectStore.newProject(name)
    if (ok) {
      creatingNew.value    = false
      newProjectName.value = ''
    } else {
      createError.value = 'Folder selection was cancelled.'
    }
  } catch (err) {
    createError.value = err instanceof Error ? err.message : 'Failed to create project.'
  }
}

async function saveProject(): Promise<void> {
  await projectStore.saveProject()
}

function triggerImport(): void {
  fileInputRef.value?.click()
}

async function onFileSelected(event: Event): Promise<void> {
  const dirHandle = projectStore.directoryHandle
  if (!dirHandle) return
  const files = (event.target as HTMLInputElement).files
  if (!files) return
  for (const file of files) {
    await assetStore.importAsset(file, dirHandle)
  }
  await projectStore.refreshFileTree()
  // Reset so the same file can be re-selected
  if (fileInputRef.value) fileInputRef.value.value = ''
}
</script>
