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
import { useSceneStore }   from '@/stores/sceneStore'
import { useCommandStore } from '@/stores/commandStore'
import { usePanelStore }   from '@/stores/panelStore'
import { useNotificationStore } from '@/stores/notificationStore'
import {
  CreateEntityCommand,
  DestroyEntityCommand,
  PasteEntityCommand,
  snapshotSubtree,
} from '@/core/commands/entity'
import { LightComponent }  from '@/core/ecs/components/LightComponent'
import { CameraComponent } from '@/core/ecs/components/CameraComponent'
import { MeshComponent }   from '@/core/ecs/components/MeshComponent'
import type { LightType }  from '@/core/ecs/components/LightComponent'

interface MenuDef { label: string; items: MenuEntry[] }

const projectStore = useProjectStore()
const editorStore  = useEditorStore()
const layerStore   = useLayerStore()
const sceneStore   = useSceneStore()
const commandStore = useCommandStore()
const panelStore   = usePanelStore()
const notify       = useNotificationStore()

const DOCS_URL = 'https://github.com/Pryme8/Nebu2#readme'

// ── Selection helpers ───────────────────────────────────────────────────────

const noSelection = () => editorStore.primaryId === null
const noScene     = () => !sceneStore.activeScene

function selectedEntity() {
  const id = editorStore.primaryId
  return id ? sceneStore.activeScene?.world.getEntity(id) ?? null : null
}

// ── Entity creation ─────────────────────────────────────────────────────────

/** Create an entity under the current selection, with optional components. */
function createEntity(name: string, components: Array<() => import('@/core/ecs/Component').Component> = []): void {
  if (!sceneStore.activeScene) return
  commandStore.execute(new CreateEntityCommand(name, editorStore.primaryId, components))
}

function createPrimitive(kind: string): void {
  createEntity(kind, [() => {
    const m = new MeshComponent()
    m.meshType = kind as MeshComponent['meshType']
    return m
  }])
}

function createLight(type: LightType): void {
  createEntity(`${type} Light`, [() => {
    const l = new LightComponent()
    l.lightType = type
    return l
  }])
}

// ── Clipboard ───────────────────────────────────────────────────────────────

function copySelection(): void {
  const id = editorStore.primaryId
  if (!id) return
  editorStore.clipboard = snapshotSubtree(id)
  notify.info('Copied')
}

function cutSelection(): void {
  const entity = selectedEntity()
  if (!entity) return
  editorStore.clipboard = snapshotSubtree(entity.id)
  commandStore.execute(new DestroyEntityCommand(entity.id, entity.name))
}

function pasteClipboard(): void {
  const snaps = editorStore.clipboard
  if (!snaps?.length) return
  // Paste under the current selection, or at root when nothing is selected.
  commandStore.execute(new PasteEntityCommand(snaps, editorStore.primaryId))
}

function duplicateSelection(): void {
  const id = editorStore.primaryId
  if (!id) return
  const entity = sceneStore.activeScene?.world.getEntity(id)
  commandStore.execute(new PasteEntityCommand(snapshotSubtree(id), entity?.parentId ?? null))
}

function deleteSelection(): void {
  const entity = selectedEntity()
  if (!entity) return
  commandStore.execute(new DestroyEntityCommand(entity.id, entity.name))
}

// ── View ────────────────────────────────────────────────────────────────────

/** Bring a panel to the front by its component-registry key. */
function focusPanel(component: string): void {
  const panel = [...panelStore.panels.values()].find(p => p.component === component)
  if (!panel) { notify.warning(`Panel "${component}" is not open`); return }
  if (panel.groupId) panelStore.setActiveTab(panel.groupId, panel.id)
  panelStore.bringToFront(panel.id)
}

// ── Menus ───────────────────────────────────────────────────────────────────

const menus: MenuDef[] = [
  {
    label: 'File',
    items: [
      { label: 'New Project…', action: async () => {
        const name = window.prompt('Project name:', 'My Project')
        if (name?.trim()) await projectStore.newProject(name.trim())
      }},
      { label: 'Open Project…', shortcut: 'Ctrl+O', action: async () => {
        const result = await projectStore.openProject()
        if (result === 'not_a_project') alert('Selected folder is not a Nebu project (missing .nebu file).')
      }},
      { separator: true },
      { label: 'Save', shortcut: 'Ctrl+S',
        disabled: () => !projectStore.isOpen,
        action: () => projectStore.saveProject() },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', shortcut: 'Ctrl+Z',
        disabled: () => !commandStore.canUndo, action: () => commandStore.undo() },
      { label: 'Redo', shortcut: 'Ctrl+Y',
        disabled: () => !commandStore.canRedo, action: () => commandStore.redo() },
      { separator: true },
      { label: 'Cut',   shortcut: 'Ctrl+X', disabled: noSelection, action: cutSelection },
      { label: 'Copy',  shortcut: 'Ctrl+C', disabled: noSelection, action: copySelection },
      { label: 'Paste', shortcut: 'Ctrl+V',
        disabled: () => !editorStore.hasClipboard, action: pasteClipboard },
      { separator: true },
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: noSelection, action: duplicateSelection },
      { label: 'Delete',    shortcut: 'Del',    disabled: noSelection, action: deleteSelection },
      { separator: true },
      { label: 'Project Settings…', action: () => editorStore.openProjectSettings() },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Hierarchy', action: () => focusPanel('HierarchyPanel') },
      { label: 'Inspector', action: () => focusPanel('InspectorPanel') },
      { label: 'Files',     action: () => focusPanel('FileBrowserPanel') },
      { label: 'Assets',    action: () => focusPanel('AssetsPanel') },
      { label: 'Console',   action: () => focusPanel('ConsolePanel') },
      { label: 'Animation', action: () => focusPanel('AnimationPanel') },
      { separator: true },
      { label: 'Viewport Settings…', action: () => editorStore.openViewportSettings() },
      { separator: true },
      { label: 'Reset Layout', action: () => { layerStore.clearSession(); location.reload() } },
    ],
  },
  {
    label: 'GameObject',
    items: [
      { label: 'Create Empty', shortcut: 'Ctrl+Shift+N',
        disabled: noScene, action: () => createEntity('Empty Entity') },
      { separator: true },
      {
        label: '3D Object',
        disabled: noScene,
        items: [
          'Box', 'Sphere', 'Cylinder', 'Capsule', 'Torus', 'TorusKnot',
          'Ground', 'Plane', 'Disc', 'IcoSphere',
        ].map(kind => ({ label: kind, action: () => createPrimitive(kind) })),
      },
      {
        label: 'Light',
        disabled: noScene,
        items: (['Hemispheric', 'Directional', 'Spot', 'Point'] as LightType[])
          .map(type => ({ label: type, action: () => createLight(type) })),
      },
      { label: 'Camera', disabled: noScene,
        action: () => createEntity('Camera', [() => new CameraComponent()]) },
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
      { label: 'Documentation', action: () => window.open(DOCS_URL, '_blank', 'noopener') },
      { label: 'About Nebu2',   action: () => notify.info('Nebu2 — a Unity-inspired editor for Babylon.js') },
    ],
  },
]
</script>
