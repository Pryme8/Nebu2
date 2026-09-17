import { defineStore }          from 'pinia'
import { ref, computed }        from 'vue'
import type { ExportConfig, ExportSceneEntry } from '@/types/export'
import type { ScriptMeta, MaterialMeta }       from '@/core/export/ExportBuilder'
import { BUILT_IN_TEMPLATES }   from '@/core/export/BuiltInTemplates'
import { useProjectStore, type FileBrowserNode } from '@/stores/projectStore'
import { useAssetStore }        from '@/stores/assetStore'
import { useNotificationStore } from '@/stores/notificationStore'

export const useExportStore = defineStore('export', () => {

  // ── Dialog visibility ──────────────────────────────────────────────────
  const isOpen = ref(false)
  function openDialog():  void { isOpen.value = true  }
  function closeDialog(): void { isOpen.value = false }

  // ── Export progress ───────────────────────────────────────────────────
  const isExporting  = ref(false)
  const progress     = ref(0)   // 0–1
  const errorMessage = ref<string | null>(null)

  // ── Derived lists used to populate the dialog ─────────────────────────

  /**
   * Flat list of all scene nodes in the file tree —
   * used to populate the scene-picker checkboxes.
   */
  const availableScenes = computed<ExportSceneEntry[]>(() => {
    const projectStore = useProjectStore()
    const results: ExportSceneEntry[] = []
    _walkTree(projectStore.fileTree, results)
    return results
  })

  function _walkTree(nodes: FileBrowserNode[], out: ExportSceneEntry[]): void {
    for (const node of nodes) {
      if (node.kind === 'scene' && node.meta) {
        out.push({ guid: node.meta.guid, name: node.name, relPath: node.meta.relPath })
      }
      if (node.children?.length) _walkTree(node.children, out)
    }
  }

  // ── Available templates ────────────────────────────────────────────────
  const availableTemplates = computed(() => BUILT_IN_TEMPLATES.slice())

  // ── Main export action ────────────────────────────────────────────────

  async function exportProject(config: ExportConfig): Promise<void> {
    const projectStore = useProjectStore()
    const assetStore   = useAssetStore()
    const notify       = useNotificationStore()
    const dirHandle    = projectStore.directoryHandle

    if (!dirHandle) {
      notify.error('No project open — cannot export.')
      return
    }
    if (config.scenes.length === 0) {
      notify.error('Select at least one scene to export.')
      return
    }

    isExporting.value  = true
    errorMessage.value = null
    progress.value     = 0

    try {
      // Build script and material metas from the file tree
      const scriptMetas:   ScriptMeta[]   = []
      const materialMetas: MaterialMeta[] = []
      _collectScriptAndMaterialMetas(projectStore.fileTree, scriptMetas, materialMetas)

      // Lazy-import the builder (keeps initial bundle lean)
      const { buildExport, triggerZipDownload } = await import('@/core/export/ExportBuilder')

      const zipBytes = await buildExport(
        config,
        dirHandle,
        assetStore.assetList,
        scriptMetas,
        materialMetas,
        (p) => { progress.value = p },
      )

      triggerZipDownload(zipBytes, config.outputName)
      notify.success(`Exported "${config.outputName}.zip" successfully.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errorMessage.value = msg
      notify.error(`Export failed: ${msg}`)
    } finally {
      isExporting.value = false
      progress.value    = 0
    }
  }

  function _collectScriptAndMaterialMetas(
    nodes:       FileBrowserNode[],
    scripts:     ScriptMeta[],
    materials:   MaterialMeta[],
  ): void {
    for (const node of nodes) {
      if (node.kind === 'script' && node.meta) {
        scripts.push({ guid: node.meta.guid, name: node.name, relPath: node.meta.relPath })
      }
      if (node.kind === 'material' && node.meta) {
        materials.push({ id: node.meta.guid, relPath: node.meta.relPath })
      }
      if (node.children?.length) _collectScriptAndMaterialMetas(node.children, scripts, materials)
    }
  }

  return {
    isOpen,
    isExporting,
    progress,
    errorMessage,
    availableScenes,
    availableTemplates,
    openDialog,
    closeDialog,
    exportProject,
  }
})
