<template>
  <div class="w-full h-full flex flex-col overflow-hidden" style="background: var(--color-bg-base)">
    <!-- Menu bar -->
    <AppMenuBar />
    <!-- Editor toolbar -->
    <EditorToolbar />

    <!-- Main editor area — panels are absolute inside here -->
    <div class="flex-1 min-h-0">
      <PanelManager :registry="componentRegistry" />
    </div>

    <!-- Toast notifications (teleports to body) -->
    <NotificationStack />

    <!-- Bottom status bar -->
    <AppStatusBar />

    <!-- Project settings modal (teleports to body internally) -->
    <ProjectSettingsDialog v-if="editorStore.projectSettingsOpen" />

    <!-- Viewport settings modal (teleports to body internally) -->
    <ViewportSettingsDialog v-if="editorStore.viewportSettingsOpen" />

    <!-- Script editor fullscreen dialog -->
    <ScriptEditorDialog v-if="editorStore.selectedScriptRelPath" />

    <!-- Export / build dialog -->
    <ExportDialog v-if="editorStore.exportDialogOpen" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, nextTick, onUnmounted, watch } from 'vue'
import { usePanelStore }    from '@/stores/panelStore'
import { useLayerStore }    from '@/stores/layerStore'
import { useSceneStore }    from '@/stores/sceneStore'
import { useCommandStore }  from '@/stores/commandStore'
import { useEditorStore }   from '@/stores/editorStore'
import { usePluginStore }   from '@/stores/pluginStore'
import { havokPlugin }      from '@nebu/plugin-havok'
import { isTextEntryTarget } from '@/lib/domFocus'

import AppMenuBar       from '@/components/editor/AppMenuBar.vue'
import EditorToolbar    from '@/components/editor/EditorToolbar.vue'
import PanelManager     from '@/components/panels/PanelManager.vue'

import HierarchyPanel   from '@/components/editor/HierarchyPanel.vue'
import InspectorPanel   from '@/components/editor/InspectorPanel.vue'
import AssetsPanel      from '@/components/editor/AssetsPanel.vue'
import ConsolePanel     from '@/components/editor/ConsolePanel.vue'
import FileBrowserPanel  from '@/components/editor/FileBrowserPanel.vue'
import NotificationStack from '@/components/base/NotificationStack.vue'
import AppStatusBar      from '@/components/base/AppStatusBar.vue'
import ScriptEditorPanel  from '@/components/editor/ScriptEditorPanel.vue'
import ViewportPanel      from '@/components/editor/ViewportPanel.vue'
import AnimationPanel     from '@/components/editor/AnimationPanel.vue'
import ScriptEditorDialog  from '@/components/editor/ScriptEditorDialog.vue'
import ProjectSettingsDialog  from '@/components/editor/ProjectSettingsDialog.vue'
import ViewportSettingsDialog from '@/components/editor/ViewportSettingsDialog.vue'
import ExportDialog           from '@/components/editor/ExportDialog.vue'

const componentRegistry: Record<string, unknown> = {
  HierarchyPanel,
  InspectorPanel,
  AssetsPanel,
  ConsolePanel,
  FileBrowserPanel,
  ScriptEditorPanel,
  ViewportPanel,
  AnimationPanel,
}

const panelStore   = usePanelStore()
const sceneStore   = useSceneStore()
const commandStore = useCommandStore()
const editorStore  = useEditorStore()
// Initialise the LayerStack early so EditorLayer begins capturing DOM events
// as soon as the app mounts (before BabylonViewport pushes RenderLayer).
const layerStore = useLayerStore()

// ── Plugin Registration ─────────────────────────────────────
//
// Plugins are registered here at app boot — BEFORE any project is opened.
// Registration has no side effects; it only makes the plugin known to the
// system so it appears in Project Settings → Plugins.
//
// Activation happens per-project (driven by projectStore + pluginStore)
// once the user enables a plugin in the Plugins tab.
const pluginStore = usePluginStore()
pluginStore.registerPlugin(havokPlugin)

// Clear command history whenever the active scene changes to avoid stale
// component references in queued commands.
watch(() => sceneStore.activeSceneId, () => commandStore.clear())

// ── Keyboard: Undo / Redo ────────────────────────────────────

function _onKeyDown(e: KeyboardEvent): void {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return

  // Don't intercept shortcuts while the user is typing in an input
  if (isTextEntryTarget(e.target)) return

  if (e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    commandStore.undo()
  } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
    e.preventDefault()
    commandStore.redo()
  }
}

onUnmounted(() => window.removeEventListener('keydown', _onKeyDown))

onMounted(async () => {
  window.addEventListener('keydown', _onKeyDown)
  // Wait one tick so PanelManager's ResizeObserver has fired and set the viewport
  await nextTick()

  const container = document.getElementById('editor-root')
  const r = container?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight - 64 }
  const cW = r.width
  const cH = r.height

  // Ensure viewport is initialized before computing normalized values
  panelStore.setViewport(r.left, r.top, cW, cH)

  // ── Zone sizes in pixels ─────────────────────────────────────
  const LEFT_W    = 260
  const RIGHT_W   = 280
  const BOTTOM_H  = 200
  const TOP_H     = cH - BOTTOM_H - 1   // 1px gap
  const CENTER_W  = cW - LEFT_W - RIGHT_W

  // ── Normalize helper ─────────────────────────────────────────
  const nx = (px: number) => px / cW
  const ny = (py: number) => py / cH
  const nw = (pw: number) => pw / cW
  const nh = (ph: number) => ph / cH

  // ── Left: Hierarchy ──────────────────────────────────────────
  panelStore.addPanel({
    title: 'Hierarchy', component: 'HierarchyPanel',
    icon: 'chevronRight', closable: false, state: 'floating',
    requiresScene: true,
    rect:    { x: nx(0),          y: ny(0), width: nw(LEFT_W),  height: nh(TOP_H) },
    minSize: { width: 160, height: 100 },
  })

  // ── Center: 3D Viewport ──────────────────────────────────────
  panelStore.addPanel({
    title: 'Viewport', component: 'ViewportPanel',
    icon: 'scene', closable: false, state: 'floating',
    rect:    { x: nx(LEFT_W), y: ny(0), width: nw(CENTER_W), height: nh(TOP_H) },
    minSize: { width: 200, height: 150 },
  })

  // ── Right: Inspector ─────────────────────────────────────────
  panelStore.addPanel({
    title: 'Inspector', component: 'InspectorPanel',
    closable: false, state: 'floating',
    requiresScene: true,
    rect:    { x: nx(cW - RIGHT_W), y: ny(0), width: nw(RIGHT_W), height: nh(TOP_H) },
    minSize: { width: 200, height: 120 },
  })

  // ── Bottom: FileBrowser + Assets + Console tab group ─────────
  const fileBrowserId = panelStore.addPanel({
    title: 'Files', component: 'FileBrowserPanel', state: 'floating',
    requiresProject: true,
    rect:    { x: 0, y: ny(TOP_H + 1), width: 1, height: nh(BOTTOM_H) },
    minSize: { width: 200, height: 80 },
  })
  const assetsId = panelStore.addPanel({
    title: 'Assets', component: 'AssetsPanel', state: 'floating',
    requiresProject: true,
    rect:    { x: 0, y: ny(TOP_H + 1), width: 1, height: nh(BOTTOM_H) },
    minSize: { width: 200, height: 80 },
  })
  const consoleId = panelStore.addPanel({
    title: 'Console', component: 'ConsolePanel', state: 'floating',
    rect:    { x: 0, y: ny(TOP_H + 1), width: 1, height: nh(BOTTOM_H) },
    minSize: { width: 200, height: 80 },
  })
  const animationId = panelStore.addPanel({
    title: 'Animation', component: 'AnimationPanel', state: 'floating',
    rect:    { x: 0, y: ny(TOP_H + 1), width: 1, height: nh(BOTTOM_H) },
    minSize: { width: 300, height: 100 },
  })
  panelStore.createGroup([fileBrowserId, assetsId, consoleId, animationId], {
    x: 0, y: ny(TOP_H + 1), width: 1, height: nh(BOTTOM_H),
  })

  // Restore layout + prefs from the last session (best-effort, silent on failure).
  // Called after default panels are created so loadLayout has targets to match.
  layerStore.restoreSession()
})
</script>


