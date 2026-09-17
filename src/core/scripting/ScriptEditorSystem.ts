// ─────────────────────────────────────────────
// ScriptEditorSystem — drives editor-time script execution
//
// A singleton (NOT an ECS System) that manages NebuScript instances used
// exclusively inside the editor viewport — before the user enters play mode.
//
// Lifecycle hooks handled here:
//   onEditorAwake   — called once when a script instance is first activated
//   onEditorUpdate  — called every render frame (via onBeforeRenderObservable)
//   onEditorDestroy — called when the script is removed or hot-reloaded
//
// Only scripts whose ScriptHookFlags indicate they implement at least one of
// the above three hooks ever get an editor instance.  Scripts with no editor
// hooks have zero overhead.
//
// Integration points:
//   • scriptStore._wireComponents   → calls activateComponent() for each wired comp
//   • sceneStore.addComponentToEntity → calls activateComponent() on Script:* add
//   • sceneStore.setBabylonScene    → calls attach() / detach()
//   • scriptStore.hotReload         → calls destroyInstancesForScript() before recompile
// ─────────────────────────────────────────────

import type { Scene as BabylonScene, Nullable, Observer } from '@babylonjs/core'
import type { Entity }         from '@/core/ecs/Entity'
import type { World }          from '@/core/ecs/World'
import type { NebuScript }     from './NebuScript'
import type { ScriptClassEntry } from '@/types/script'
import type { ScriptComponent }  from '@/core/ecs/components/ScriptComponent'

interface EditorSlot {
  comp:     ScriptComponent
  instance: NebuScript
  hooks:    ScriptClassEntry['hooks']
}

class ScriptEditorSystem {

  private _scene:      BabylonScene | null = null
  private _observer:   Nullable<Observer<BabylonScene>> = null

  /** Per-guid lists of currently-alive editor instances. */
  private readonly _slots = new Map<string, EditorSlot[]>()

  /** Sub-list: only slots where hooks.onEditorUpdate is true. */
  private _updateList: EditorSlot[] = []

  // ── Scene attachment ──────────────────────────────────────────────────────

  /**
   * Wire this system to a Babylon scene.
   * Call from sceneStore.setBabylonScene() whenever the scene becomes available.
   * Idempotent — safe to call again with the same scene.
   */
  attach(babylonScene: BabylonScene): void {
    if (this._scene === babylonScene) return
    this.detach()
    this._scene    = babylonScene
    this._observer = babylonScene.onBeforeRenderObservable.add(() => {
      for (const slot of this._updateList) {
        this._safeCall(slot, 'onEditorUpdate')
      }
    })
  }

  /**
   * Disconnect from the Babylon scene.
   * Called on scene disposal or before attaching to a new scene.
   * Destroys all live editor instances first.
   */
  detach(): void {
    if (this._observer && this._scene) {
      this._scene.onBeforeRenderObservable.remove(this._observer)
    }
    this._observer = null

    // Destroy all instances
    for (const slots of this._slots.values()) {
      for (const slot of slots) {
        if (slot.hooks.onEditorDestroy) this._safeCall(slot, 'onEditorDestroy')
      }
    }
    this._slots.clear()
    this._updateList = []
    this._scene      = null
  }

  // ── Per-component activation ──────────────────────────────────────────────

  /**
   * Create an editor instance for a newly-wired ScriptComponent.
   * Only creates one when the script overrides at least one editor hook.
   * Safe to call during both initial wiring and hot-reload re-wire.
   */
  activateComponent(
    comp:     ScriptComponent,
    entry:    ScriptClassEntry,
    entity:   Entity,
    world:    World,
    scene:    BabylonScene,
  ): void {
    const h = entry.hooks
    // Skip scripts that have no editor-time hooks — zero overhead.
    if (!h.onEditorAwake && !h.onEditorUpdate && !h.onEditorDestroy) return

    const instance = new entry.cls()

    // Inject context
    instance.entity = entity
    instance.world  = world
    instance.scene  = scene

    // Apply inspector-authored prop overrides
    for (const [k, v] of Object.entries(comp.propValues)) {
      (instance as unknown as Record<string, unknown>)[k] = v
    }

    const slot: EditorSlot = { comp, instance, hooks: h }

    const list = this._slots.get(comp.scriptGuid) ?? []
    list.push(slot)
    this._slots.set(comp.scriptGuid, list)

    if (h.onEditorUpdate) {
      this._updateList.push(slot)
    }

    if (h.onEditorAwake) {
      this._safeCall(slot, 'onEditorAwake')
    }
  }

  // ── Hot-reload support ────────────────────────────────────────────────────

  /**
   * Destroy all editor instances for a given script guid.
   * Called by scriptStore BEFORE the class is replaced during hot-reload,
   * so onEditorDestroy runs on the OLD class instances.
   */
  destroyInstancesForScript(scriptGuid: string): void {
    const slots = this._slots.get(scriptGuid)
    if (!slots?.length) return

    for (const slot of slots) {
      if (slot.hooks.onEditorDestroy) this._safeCall(slot, 'onEditorDestroy')
    }

    // Remove from update list
    this._updateList = this._updateList.filter(s => s.comp.scriptGuid !== scriptGuid)
    this._slots.delete(scriptGuid)
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _safeCall(
    slot:    EditorSlot,
    method:  'onEditorAwake' | 'onEditorUpdate' | 'onEditorDestroy',
  ): void {
    try {
      const fn = (slot.instance as unknown as Record<string, () => void>)[method]
      if (typeof fn === 'function') fn.call(slot.instance)
    } catch (err) {
      const name = slot.comp._entry?.name ?? slot.comp.scriptGuid
      const msg  = `[Script][Editor] ${name}.${method}(): ${err instanceof Error ? err.message : String(err)}`
      console.error(msg)
      import('@/stores/notificationStore').then(({ useNotificationStore }) => {
        useNotificationStore().error(msg.slice(0, 200), 0)
      })
    }
  }
}

/** Module-level singleton — import and use directly. */
export const scriptEditorSystem = new ScriptEditorSystem()
