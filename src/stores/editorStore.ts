import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import type { EditorState, EditorTool, GizmoSpace, EntityId, EditorPrefs, ViewportPrefs } from '@/types/editor'
import { useSceneStore } from '@/stores/sceneStore'
import type { SerializedEntity } from '@/core/ecs/World'

export const useEditorStore = defineStore('editor', () => {

  // ── Selection (temp — not persisted) ─────────────────────────────
  const selectedIds         = ref<Set<EntityId>>(new Set())
  const selectedSceneGuid   = ref<string | null>(null)
  const selectedMaterialId  = ref<string | null>(null)
  const selectedTextureGuid = ref<string | null>(null)
  const selectedScriptRelPath = ref<string | null>(null)
  const selectedModelGuid   = ref<string | null>(null)
  const primaryId           = computed(() => [...selectedIds.value][0] ?? null)

  // ── Entity clipboard (temp — not persisted) ──────────────────────
  // Holds a serialized subtree rather than an id, so Cut still works
  // after the source entity is gone and a copy can be pasted repeatedly.
  const clipboard = ref<SerializedEntity[] | null>(null)
  const hasClipboard = computed(() => (clipboard.value?.length ?? 0) > 0)

  function select(id: EntityId, multi = false): void {
    selectedSceneGuid.value    = null   // entity click clears scene selection
    selectedMaterialId.value   = null
    selectedTextureGuid.value  = null
    selectedScriptRelPath.value = null
    selectedModelGuid.value    = null
    if (!multi) {
      selectedIds.value.clear()
      selectedIds.value.add(id)
    } else {
      if (selectedIds.value.has(id)) selectedIds.value.delete(id)
      else selectedIds.value.add(id)
    }
  }
  function deselect(id: EntityId): void   { selectedIds.value.delete(id) }
  function clearSelection(): void          { selectedIds.value.clear(); selectedSceneGuid.value = null; selectedMaterialId.value = null; selectedTextureGuid.value = null; selectedScriptRelPath.value = null; selectedModelGuid.value = null }

  function selectScene(guid: string): void {
    selectedIds.value.clear()
    selectedSceneGuid.value    = guid
    selectedMaterialId.value   = null
    selectedTextureGuid.value  = null
    selectedScriptRelPath.value = null
    selectedModelGuid.value    = null
  }

  function selectMaterial(id: string): void {
    selectedIds.value.clear()
    selectedSceneGuid.value    = null
    selectedMaterialId.value   = id
    selectedTextureGuid.value  = null
    selectedScriptRelPath.value = null
    selectedModelGuid.value    = null
  }

  function selectTexture(guid: string): void {
    selectedIds.value.clear()
    selectedSceneGuid.value    = null
    selectedMaterialId.value   = null
    selectedTextureGuid.value  = guid
    selectedScriptRelPath.value = null
    selectedModelGuid.value    = null
  }

  function selectScript(relPath: string | null): void {
    selectedIds.value.clear()
    selectedSceneGuid.value    = null
    selectedMaterialId.value   = null
    selectedTextureGuid.value  = null
    selectedScriptRelPath.value = relPath
    selectedModelGuid.value    = null
  }

  function selectModel(guid: string): void {
    selectedIds.value.clear()
    selectedSceneGuid.value     = null
    selectedMaterialId.value    = null
    selectedTextureGuid.value   = null
    selectedScriptRelPath.value = null
    selectedModelGuid.value     = guid
  }

  // ── Play mode ────────────────────────────────────────────────────
  const isPlaying      = ref(false)
  const _playTransitioning = ref(false)

  function startPlay(): void {
    if (_playTransitioning.value || isPlaying.value) return
    const sceneStore = useSceneStore()
    if (!sceneStore.hasCameraForPlay) return
    _playTransitioning.value = true
    try {
      sceneStore.enterPlayMode()
      isPlaying.value = true
    } finally {
      _playTransitioning.value = false
    }
  }

  function stopPlay(): void {
    if (_playTransitioning.value || !isPlaying.value) return
    _playTransitioning.value = true
    try {
      useSceneStore().exitPlayMode()
      isPlaying.value = false
    } finally {
      _playTransitioning.value = false
    }
  }

  // ── Dialog visibility ────────────────────────────────────────────
  const projectSettingsOpen    = ref(false)
  const viewportSettingsOpen   = ref(false)
  const exportDialogOpen        = ref(false)
  function openProjectSettings()    { projectSettingsOpen.value  = true  }
  function closeProjectSettings()   { projectSettingsOpen.value  = false }
  function openViewportSettings()   { viewportSettingsOpen.value = true  }
  function closeViewportSettings()  { viewportSettingsOpen.value = false }
  function openExportDialog()       { exportDialogOpen.value     = true  }
  function closeExportDialog()      { exportDialogOpen.value     = false }

  // ── Persistent prefs ─────────────────────────────────────────────
  const activeTool      = ref<EditorTool>('select')
  const gizmoSpace      = ref<GizmoSpace>('world')
  const snapEnabled     = ref(false)
  const snapTranslation = ref(0.25)
  const snapRotation    = ref(15)
  const snapScale       = ref(0.1)
  // Viewport widgets
  const showGrid        = ref(true)
  const showWorldAxis   = ref(true)
  const showCameraAxis  = ref(true)

  // Viewport camera / light prefs
  const viewportPrefs = reactive<ViewportPrefs>({
    cameraNearClip: 0.1,
    cameraFarClip:  10000,
    flySpeed:       1.0,
    lightIntensity: 0.9,
    lightDirX:      0,
    lightDirY:      1,
    lightDirZ:      0,
  })

  // ── Full state snapshot ──────────────────────────────────────────
  const state = computed<EditorState>(() => ({
    temp: {
      selectedEntityIds: [...selectedIds.value],
    },
    persistent: {
      activeTool:      activeTool.value,
      gizmoSpace:      gizmoSpace.value,
      snapEnabled:     snapEnabled.value,
      snapTranslation: snapTranslation.value,
      snapRotation:    snapRotation.value,
      snapScale:       snapScale.value,
      showGrid:        showGrid.value,
      showWorldAxis:   showWorldAxis.value,
      showCameraAxis:  showCameraAxis.value,
    },
  }))

  // ── Session serialization ────────────────────────────────────────

  /** Capture the persistent subset for session storage. */
  function serializePrefs(): EditorPrefs {
    return {
      activeTool:      activeTool.value,
      gizmoSpace:      gizmoSpace.value,
      snapEnabled:     snapEnabled.value,
      snapTranslation: snapTranslation.value,
      snapRotation:    snapRotation.value,
      snapScale:       snapScale.value,
      showGrid:        showGrid.value,
      showWorldAxis:   showWorldAxis.value,
      showCameraAxis:  showCameraAxis.value,
      viewport:        { ...viewportPrefs },
    }
  }

  /** Restore persistent prefs from a previously serialized snapshot. */
  function loadPrefs(prefs: EditorPrefs): void {
    activeTool.value      = prefs.activeTool
    gizmoSpace.value      = prefs.gizmoSpace
    snapEnabled.value     = prefs.snapEnabled
    snapTranslation.value = prefs.snapTranslation
    snapRotation.value    = prefs.snapRotation
    snapScale.value       = prefs.snapScale
    showGrid.value        = prefs.showGrid        ?? true
    showWorldAxis.value   = prefs.showWorldAxis   ?? true
    showCameraAxis.value  = prefs.showCameraAxis  ?? true
    if (prefs.viewport) Object.assign(viewportPrefs, prefs.viewport)
  }

  return {
    selectedIds, selectedSceneGuid, selectedMaterialId, selectedTextureGuid, selectedScriptRelPath, selectedModelGuid, primaryId,
    clipboard, hasClipboard,
    select, deselect, clearSelection, selectScene, selectMaterial, selectTexture, selectScript, selectModel,
    activeTool, gizmoSpace,
    snapEnabled, snapTranslation, snapRotation, snapScale,
    showGrid, showWorldAxis, showCameraAxis,
    viewportPrefs,
    isPlaying, startPlay, stopPlay,
    state,
    serializePrefs, loadPrefs,
    projectSettingsOpen, openProjectSettings, closeProjectSettings,
    viewportSettingsOpen, openViewportSettings, closeViewportSettings,
    exportDialogOpen, openExportDialog, closeExportDialog,
  }
})

