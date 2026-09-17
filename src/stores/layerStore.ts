import { defineStore } from 'pinia'
import { shallowRef, computed } from 'vue'
import { LayerStack } from '@/core/layers/LayerStack'
import { EditorLayer } from '@/core/layers/EditorLayer'
import type { ILayer } from '@/core/layers/ILayer'
import type { IEvent } from '@/core/layers/IEvent'
import { SessionSerializer } from '@/core/serialization/SessionSerializer'
import { useEditorStore } from '@/stores/editorStore'
import { usePanelStore }  from '@/stores/panelStore'
import type { SessionState, SerializedLayerState } from '@/types/session'
import { SESSION_VERSION } from '@/types/session'

/**
 * layerStore — Pinia store that owns the application's LayerStack singleton.
 *
 * The EditorLayer is created and pushed here so it is available as soon as
 * the store is first accessed (i.e. on app mount).  The RenderLayer is pushed
 * later by BabylonViewport once the Engine + Scene are ready.
 *
 * Session save/restore is orchestrated here so a single call coordinates all
 * stores (editorStore, panelStore) and all persistent layers.
 */
export const useLayerStore = defineStore('layer', () => {
  const stack = new LayerStack()

  // EditorLayer is the first layer pushed — it captures DOM events and
  // handles editor-wide keyboard shortcuts.
  const editorLayer = new EditorLayer(stack)
  stack.pushLayer(editorLayer)

  // Reactive snapshot of the stack contents for DevTools / debug panels.
  const layerNames = computed(() =>
    stack.layers.map(l => l.name)
  )

  /** Push any layer onto the stack (called by BabylonViewport for RenderLayer). */
  function pushLayer(layer: ILayer): void {
    stack.pushLayer(layer)
  }

  /** Remove a layer from the stack.  */
  function popLayer(layer: ILayer): void {
    stack.popLayer(layer)
  }

  /** Manually dispatch an event (useful for testing / programmatic triggers). */
  function dispatchEvent(event: IEvent): void {
    stack.dispatchEvent(event)
  }

  // ── Session persistence ──────────────────────────────────────────────────────

  /**
   * Snapshot the full editor session and write it to localStorage.
   * Call this on window unload or at any deliberate save point.
   */
  function saveSession(): void {
    const editorStore = useEditorStore()
    const panelStore  = usePanelStore()

    const layerStates: SerializedLayerState[] = stack.layers
      .filter(l => l.persistent)
      .map(l => ({ name: l.name, data: l.serializeState() }))

    const session: SessionState = {
      version:     SESSION_VERSION,
      savedAt:     Date.now(),
      editorPrefs: editorStore.serializePrefs(),
      panelLayout: panelStore.serializeLayout(),
      layerStates,
    }

    SessionSerializer.save(session)
  }

  /**
   * Load the persisted session from localStorage and apply it to the current
   * stores and layers.  Safe to call before panels are fully initialised —
   * any panels/layers that don't exist yet are silently skipped.
   */
  function restoreSession(): void {
    const session = SessionSerializer.load()
    if (!session) return

    useEditorStore().loadPrefs(session.editorPrefs)
    usePanelStore().loadLayout(session.panelLayout)

    for (const saved of session.layerStates) {
      const layer = stack.layers.find(l => l.name === saved.name && l.persistent)
      layer?.deserializeState(saved.data)
    }
  }

  /** Clear the saved session (e.g. "Reset Layout" action). */
  function clearSession(): void {
    // Remove the beforeunload listener so the current (stale) layout doesn't
    // get re-saved when location.reload() triggers the unload event.
    window.removeEventListener('beforeunload', saveSession)
    SessionSerializer.clear()
  }

  // ── Auto-save on tab/window close ────────────────────────────────────────────
  window.addEventListener('beforeunload', saveSession)

  return {
    stack,
    editorLayer,
    layerNames,
    pushLayer,
    popLayer,
    dispatchEvent,
    saveSession,
    restoreSession,
    clearSession,
    _stackRef: shallowRef(stack),
  }
})

