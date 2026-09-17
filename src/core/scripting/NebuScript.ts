// ─────────────────────────────────────────────
// NebuScript — base class for all entity scripts
//
// Users subclass this in their .ts script files.
// All lifecycle methods have empty default implementations so scripts
// only override the hooks they actually need.
//
// The ScriptEngine detects overrides at class-load time by comparing each
// prototype method to NebuScript.prototype — non-overridden hooks are
// NEVER registered on Babylon observables, saving per-frame work.
// ─────────────────────────────────────────────

import type { Entity }             from '@/core/ecs/Entity'
import type { World }              from '@/core/ecs/World'
import type { Scene as BabylonScene } from '@babylonjs/core'
import type { TransformComponent } from '@/core/ecs/components/TransformComponent'
import type { Component }          from '@/core/ecs/Component'
import type { ExposedPropDef }     from '@/types/script'

export abstract class NebuScript {
  // ── Injected by ScriptRuntimeSystem before any lifecycle call ────────────────
  entity!:  Entity
  world!:   World
  scene!:   BabylonScene

  // ── Exposed properties declaration ──────────────────────────────────────────
  /**
   * Declare serializable, inspector-visible properties here.
   *
   *   static readonly exposedProps: ExposedPropDef[] = [
   *     { key: 'speed',  type: 'number',     label: 'Speed',  default: 5, min: 0 },
   *     { key: 'target', type: 'entity-ref', label: 'Target', default: null },
   *   ]
   */
  static readonly exposedProps: Array<Omit<ExposedPropDef, 'type'> & { type: string }> = []

  // ── Convenience helpers ──────────────────────────────────────────────────────

  /** Shorthand to get this entity's TransformComponent. */
  get transform(): TransformComponent {
    return this.entity.getComponent<TransformComponent>('Transform')!
  }

  /** Get any component from this entity by type string. */
  getComponent<T extends Component>(type: string): T | undefined {
    return this.entity.getComponent<T>(type)
  }

  /** Find the first entity in the world with the given name. */
  findEntity(name: string): Entity | undefined {
    for (const e of this.world.entities.values()) {
      if (e.name === name) return e
    }
    return undefined
  }

  /** Find all entities in the world that have the given tag. */
  findEntitiesWithTag(tag: string): Entity[] {
    return [...this.world.entities.values()].filter(e => e.tags.includes(tag))
  }

  /**
   * Resolve an entity-ref prop (stored as entity ID string) to the live Entity.
   * Returns null when the prop is unset or the referenced entity no longer exists.
   *
   *   const target = this.resolveRef('targetId')
   */
  resolveRef(propKey: string): Entity | null {
    const id = (this as unknown as Record<string, unknown>)[propKey]
    if (typeof id !== 'string') return null
    return this.world.getEntity(id) ?? null
  }

  // ── Editor-time lifecycle ────────────────────────────────────────────────────
  // These run in the editor even when Play is NOT active.

  /** Called once when the script is first compiled / reloaded in the editor. */
  onEditorAwake():             void {}

  /** Called every editor frame (runs via Babylon's render loop). */
  onEditorUpdate(_dt: number): void {}

  /** Called when the component is removed or the scene is closed in the editor. */
  onEditorDestroy():           void {}

  // ── Runtime lifecycle ────────────────────────────────────────────────────────
  // These only run during Play mode.

  /**
   * Called immediately when Play starts, before the first frame.
   * All scripts receive onAwake before any receive onStart.
   * Use for initialization that doesn't depend on other scripts.
   */
  onAwake():                   void {}

  /**
   * Called once on the first frame, after ALL scripts have received onAwake.
   * Use when your initialization depends on other scripts being ready.
   */
  onStart():                   void {}

  /** Called whenever the entity or component becomes active. */
  onEnable():                  void {}

  /** Called whenever the entity or component becomes inactive. */
  onDisable():                 void {}

  /** Called every rendered frame.  dt = seconds since last frame. */
  onUpdate(_dt: number):       void {}

  /** Called after ALL scripts have had their onUpdate for the current frame. */
  onLateUpdate(_dt: number):   void {}

  /**
   * Called on the physics fixed-timestep.
   * Only fires when the scene has an active physics engine (Havok, Cannon, etc.).
   * Use for physics-related logic that must stay synchronized with simulation.
   */
  onFixedUpdate(_dt: number):  void {}

  /**
   * Called immediately before this entity is destroyed.
   * Clean up any subscriptions, timers, or external references here.
   */
  onDestroy():                  void {}
}
