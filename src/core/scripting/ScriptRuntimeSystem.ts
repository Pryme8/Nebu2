// ─────────────────────────────────────────────
// ScriptRuntimeSystem — drives the full runtime script lifecycle
//
// Extends ECS System so it plugs into World.addSystem() / World.onStart() /
// World.onUpdate() / World.onShutdown().
//
// Key optimizations:
//  - At onStart(), each script's ScriptHookFlags are consulted.  Scripts that
//    do NOT override onUpdate / onLateUpdate / onFixedUpdate are placed into
//    an empty slot list, meaning ZERO per-frame overhead for those hooks.
//  - onFixedUpdate is only wired when the Babylon scene has an active physics
//    engine.  The observer is registered once at onStart and removed in
//    onShutdown.
//
// Execution order within each lifecycle phase:
//  1. Scripts with higher `executionOrder` run first.
//  2. Ties broken by entity `sortOrder` ascending (hierarchy order).
//
// Error handling:
//  Any exception thrown inside a lifecycle method disables ONLY that script
//  (ScriptComponent._disabled = true), logs the error, and shows a toast.
//  Other scripts continue running.
// ─────────────────────────────────────────────

import { System }              from '../ecs/System'
import { ScriptComponent }     from '../ecs/components/ScriptComponent'
import { useScriptStore }      from '@/stores/scriptStore'
import type { NebuScript }     from '@/core/scripting/NebuScript'
import type { ScriptClassEntry } from '@/types/script'
import type { Scene as BabylonScene, Nullable, Observer } from '@babylonjs/core'

interface ScriptSlot {
  comp:     ScriptComponent
  instance: NebuScript
}

export class ScriptRuntimeSystem extends System {

  private readonly _babylonScene: BabylonScene

  // ── Per-hook slot lists ───────────────────────────────────────────────────
  // Only scripts that override the hook are placed in the list.
  // Zero overhead for scripts that don't implement a given hook.
  private _allSlots:          ScriptSlot[] = []
  private _updateSlots:       ScriptSlot[] = []
  private _lateUpdateSlots:   ScriptSlot[] = []
  private _fixedUpdateSlots:  ScriptSlot[] = []

  /** Babylon physics observable handle — null when no physics engine present. */
  private _physicsObserver: Nullable<Observer<BabylonScene>> = null

  /** Entities queued for destruction by destroySelf() calls. */
  private _destroyQueue: string[] = []

  constructor(babylonScene: BabylonScene) {
    super()
    this._babylonScene = babylonScene
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override onStart(): void {
    const scriptStore = useScriptStore()

    // ── Collect all (entity, ScriptComponent, ClassEntry) tuples ──────────
    type SlotData = {
      comp:       ScriptComponent
      entry:      ScriptClassEntry
      entityId:   string
      entitySort: number
    }
    const collected: SlotData[] = []

    for (const entity of this.world.entities.values()) {
      if (!entity.active) continue
      for (const comp of entity.components) {
        if (!comp.type.startsWith('Script:')) continue
        const sc = comp as ScriptComponent
        if (sc._disabled) continue
        const entry = scriptStore.getEntry(sc.scriptGuid)
        if (!entry) continue
        collected.push({
          comp: sc,
          entry,
          entityId:   entity.id,
          entitySort: entity.sortOrder,
        })
      }
    }

    // ── Sort: executionOrder DESC then entitySort ASC ─────────────────────
    collected.sort((a, b) => {
      const od = b.comp.executionOrder - a.comp.executionOrder
      if (od !== 0) return od
      return a.entitySort - b.entitySort
    })

    // ── Instantiate + inject + onAwake ────────────────────────────────────
    for (const { comp, entry, entityId } of collected) {
      const instance = this._instantiate(comp, entityId, entry)
      if (!instance) continue
      if (entry.hooks.onAwake) this._safeCall(comp, instance, 'onAwake')
    }

    // ── onEnable for active entities ──────────────────────────────────────
    for (const { comp, entry } of collected) {
      if (!comp._instance) continue
      const entity = this.world.getEntity(comp.entityId)
      if (entity?.active && entry.hooks.onEnable) {
        this._safeCall(comp, comp._instance, 'onEnable')
      }
    }

    // ── onStart ───────────────────────────────────────────────────────────
    for (const { comp, entry } of collected) {
      if (!comp._instance) continue
      if (entry.hooks.onStart) this._safeCall(comp, comp._instance, 'onStart')
    }

    // ── Build per-hook slot lists ─────────────────────────────────────────
    // Only slots where the hook is overridden are inserted.
    // This is the core optimization: unimplemented hooks cost nothing per frame.
    for (const { comp, entry } of collected) {
      if (!comp._instance) continue
      const slot: ScriptSlot = { comp, instance: comp._instance }

      this._allSlots.push(slot)
      if (entry.hooks.onUpdate)     this._updateSlots.push(slot)
      if (entry.hooks.onLateUpdate) this._lateUpdateSlots.push(slot)
      if (entry.hooks.onFixedUpdate) this._fixedUpdateSlots.push(slot)
    }

    // ── Wire physics observer ─────────────────────────────────────────────
    // Only if: (a) any script implements onFixedUpdate, AND
    //          (b) the scene has a physics engine.
    if (this._fixedUpdateSlots.length > 0) {
      this._wirePhysics()
    }
  }

  override onUpdate(dt: number): void {
    // ── onUpdate ──────────────────────────────────────────────────────────
    for (const slot of this._updateSlots) {
      if (slot.comp._disabled) continue
      this._safeCall(slot.comp, slot.instance, 'onUpdate', dt)
    }

    // ── onLateUpdate ─────────────────────────────────────────────────────
    for (const slot of this._lateUpdateSlots) {
      if (slot.comp._disabled) continue
      this._safeCall(slot.comp, slot.instance, 'onLateUpdate', dt)
    }

    // ── Flush destroy queue ───────────────────────────────────────────────
    this._flushDestroyQueue()
  }

  override onShutdown(): void {
    // Unwire physics observer before clearing slots
    if (this._physicsObserver) {
      this._babylonScene.onBeforePhysicsObservable.remove(this._physicsObserver)
      this._physicsObserver = null
    }

    // onDisable → onDestroy for every script that has a live instance.
    // NOTE: the hook-flag optimization only applies to per-frame hooks (onUpdate etc.).
    // Shutdown hooks are called once so the overhead is irrelevant — always fire them.
    // We also allow disabled components through here so cleanup code always runs.
    const scriptStore = useScriptStore()
    for (const slot of this._allSlots) {
      const instance = slot.comp._instance
      if (!instance) continue
      const entry = scriptStore.getEntry(slot.comp.scriptGuid)
      if (!slot.comp._disabled && entry?.hooks.onDisable) {
        this._safeCall(slot.comp, instance, 'onDisable')
      }
      this._safeCall(slot.comp, instance, 'onDestroy')
      slot.comp._instance = null
    }

    this._allSlots         = []
    this._updateSlots      = []
    this._lateUpdateSlots  = []
    this._fixedUpdateSlots = []
    this._destroyQueue     = []
  }

  // ── Private: instantiation ────────────────────────────────────────────────

  private _instantiate(
    comp:     ScriptComponent,
    entityId: string,
    entry:    ScriptClassEntry,
  ): NebuScript | null {
    const entity = this.world.getEntity(entityId)
    if (!entity) return null

    const instance = new entry.cls()

    // Inject ECS/Babylon context
    instance.entity = entity
    instance.world  = this.world
    instance.scene  = this._babylonScene

    // Apply saved propValues over default field values
    for (const [k, v] of Object.entries(comp.propValues)) {
      (instance as unknown as Record<string, unknown>)[k] = v
    }

    comp._instance = instance
    return instance
  }

  // ── Private: physics ─────────────────────────────────────────────────────

  private _wirePhysics(): void {
    const physicsEngine = this._babylonScene.getPhysicsEngine()
    if (!physicsEngine) return   // physics not enabled in this scene — skip silently

    const timeStep = physicsEngine.getTimeStep?.() ?? (1 / 60)

    this._physicsObserver = this._babylonScene.onBeforePhysicsObservable.add(() => {
      for (const slot of this._fixedUpdateSlots) {
        if (slot.comp._disabled) continue
        this._safeCall(slot.comp, slot.instance, 'onFixedUpdate', timeStep)
      }
    })
  }

  // ── Private: safe call ────────────────────────────────────────────────────

  /**
   * Call a lifecycle method on a script instance, catching any exception.
   * On error: disables the script component, logs to console, toasts the editor.
   */
  private _safeCall(
    comp:        ScriptComponent,
    instance:    NebuScript,
    methodName:  string,
    arg?:        number,
  ): void {
    try {
      const fn = (instance as unknown as Record<string, (arg?: number) => void>)[methodName]
      if (typeof fn === 'function') fn.call(instance, arg)
    } catch (err) {
      const msg = `[Script] Runtime error in "${comp._entry?.name ?? comp.scriptGuid}" → ${methodName}():\n${err instanceof Error ? err.message : String(err)}`
      console.error(msg)
      comp._error    = msg
      comp._disabled = true
      comp.notifyChanged()

      import('@/stores/notificationStore').then(({ useNotificationStore }) => {
        useNotificationStore().error(msg.slice(0, 200), 0)
      })
    }
  }

  // ── Private: destroy queue ────────────────────────────────────────────────

  private _flushDestroyQueue(): void {
    if (this._destroyQueue.length === 0) return
    const ids = [...this._destroyQueue]
    this._destroyQueue = []
    import('@/stores/sceneStore').then(({ useSceneStore }) => {
      const store = useSceneStore()
      for (const id of ids) store.destroyEntity(id)
    })
  }
}
