<template>
  <div
    data-menu-bar
    class="flex items-center h-7 px-1 shrink-0 border-b border-[var(--color-border)] select-none"
    style="background: var(--color-bg-elevated)"
  >
    <!-- App icon / name -->
    <span class="px-2 text-xs font-bold text-[var(--color-accent)] tracking-tight mr-1">
      Nebu<span class="text-[var(--color-text-muted)]">2</span>
    </span>

    <!-- Menu items -->
    <div class="flex items-center h-full">
      <MenuBarItem
        v-for="menu in menus"
        :key="menu.label"
        :label="menu.label"
        :items="menu.items"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import MenuBarItem from './MenuBarItem.vue'
import type { MenuEntry } from './MenuBarItem.vue'
import { useProjectStore } from '@/stores/projectStore'
import { useEditorStore }  from '@/stores/editorStore'
import { useLayerStore }   from '@/stores/layerStore'

interface MenuDef { label: string; items: MenuEntry[] }

const projectStore = useProjectStore()
const editorStore  = useEditorStore()
const layerStore   = useLayerStore()

const menus: MenuDef[] = [
  {
    label: 'File',
    items: [
      { label: 'New Project…',  shortcut: '',         action: async () => {
        const name = window.prompt('Project name:', 'My Project')
        if (name?.trim()) await projectStore.newProject(name.trim())
      }},
      { label: 'Open Project…', shortcut: 'Ctrl+O',   action: async () => {
        const result = await projectStore.openProject()
        if (result === 'not_a_project') alert('Selected folder is not a Nebu project (missing .nebu file).')
      }},
      { separator: true },
      { label: 'Save',          shortcut: 'Ctrl+S',   action: () => projectStore.saveProject() },
      { separator: true },
      { label: 'Exit',          shortcut: 'Alt+F4',   action: () => {} },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo',          shortcut: 'Ctrl+Z', action: () => {} },
      { label: 'Redo',          shortcut: 'Ctrl+Y', action: () => {} },
      { separator: true },
      { label: 'Cut',           shortcut: 'Ctrl+X', action: () => {} },
      { label: 'Copy',          shortcut: 'Ctrl+C', action: () => {} },
      { label: 'Paste',         shortcut: 'Ctrl+V', action: () => {} },
      { separator: true },
      { label: 'Duplicate',     shortcut: 'Ctrl+D', action: () => {} },
      { label: 'Delete',        shortcut: 'Del',    action: () => {} },
      { separator: true },
      { label: 'Project Settings…', shortcut: '', action: () => editorStore.openProjectSettings() },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Reset Layout',  shortcut: '', action: () => { layerStore.clearSession(); location.reload() } },
      { separator: true },
      { label: 'Hierarchy',     shortcut: '', action: () => {} },
      { label: 'Inspector',     shortcut: '', action: () => {} },
      { label: 'Assets',        shortcut: '', action: () => {} },
      { label: 'Console',       shortcut: '', action: () => {} },
    ],
  },
  {
    label: 'GameObject',
    items: [
      { label: 'Create Empty',  shortcut: 'Ctrl+Shift+N', action: () => {} },
      { separator: true },
      { label: '3D Object ▶',   shortcut: '', action: () => {} },
      { label: 'Light ▶',       shortcut: '', action: () => {} },
      { label: 'Camera',        shortcut: '', action: () => {} },
    ],
  },
  {
    label: 'Build',
    items: [
      { label: 'Export Project…', shortcut: 'Ctrl+B', action: () => editorStore.openExportDialog() },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'Documentation', shortcut: '', action: () => {} },
      { label: 'About Nebu2',   shortcut: '', action: () => {} },
    ],
  },
]
</script>
