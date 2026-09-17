// ─────────────────────────────────────────────
// Plugin Contract Types
//
// A NebuPlugin is the single descriptor object every plugin must export.
// It contributes ECS components (shown in the Inspector's "Add Component"
// menu), ECS systems, and optional Babylon-level setup/teardown logic.
//
// Built-in plugins live in packages/ inside this monorepo.
// External plugins are published as npm packages with the same shape.
// ─────────────────────────────────────────────

import type { Component }        from '@/core/ecs/Component'
import type { ComponentFactory } from '@/core/ecs/componentRegistry'
import type { World }            from '@/core/ecs/World'
import type { Engine, Scene }    from '@babylonjs/core'

// ── PluginContext ──────────────────────────────────────────────────────────

/**
 * Injected into onActivate / onDeactivate so a plugin can access live
 * Babylon objects and the ECS World without importing stores directly.
 */
export interface PluginContext {
  /** The live Babylon.js Scene. */
  scene:  Scene
  /** The live Babylon.js Engine. */
  engine: Engine
  /** The ECS World of the currently active Nebu scene. */
  world:  World
}

// ── PluginComponentDef ─────────────────────────────────────────────────────

/**
 * Describes one ECS component contributed by a plugin.
 *  - `type`        must match the `Component.type` string exactly.
 *  - `label`       is shown in the "Add Component" dropdown.
 *  - `factory`     creates a fresh default instance.
 *  - `deserialize` restores an instance from serialized JSON (used by World.deserialize).
 */
export interface PluginComponentDef {
  type:        string
  label:       string
  factory:     () => Component
  deserialize: ComponentFactory
}

// ── NebuPlugin ─────────────────────────────────────────────────────────────

/**
 * The single descriptor every plugin must export as a named export.
 *
 * Lifecycle:
 *   registerPlugin  → plugin is known to the app (no side effects).
 *   activatePlugin  → onActivate is awaited; systems are added; component
 *                      types are merged into the ECS registry.
 *   deactivatePlugin → onDeactivate is called; entries are removed from the
 *                      registry; any systems added by the plugin must be
 *                      cleaned up inside onDeactivate via ctx.world.
 *
 * Rule: onActivate is the only place a plugin should create Babylon objects,
 * register systems, or perform async work (e.g. loading wasm).
 */
export interface NebuPlugin {
  /** Unique reverse-DNS style identifier.  e.g. 'com.nebu.physics-havok' */
  readonly id:          string
  /** Human-readable name shown in Project Settings → Plugins. */
  readonly displayName: string
  /** One-sentence description of what the plugin provides. */
  readonly description: string
  /** SemVer version string. */
  readonly version:     string
  /**
   * `true`  — plugin ships inside the Nebu monorepo (always available).
   * `false` — plugin must be installed via npm before it can be activated.
   */
  readonly builtin:     boolean

  /** ECS components this plugin contributes to the registry. */
  readonly components:  PluginComponentDef[]

  /**
   * TypeScript ambient declarations (a `declare class ...` string) injected
   * into the Monaco script editor so user scripts get full IntelliSense for
   * this plugin's component types without any import statement.
   *
   * The string is registered as a global `.d.ts` lib alongside the built-in
   * Nebu globals whenever a MonacoEditor mounts.
   *
   * @example
   * ambientTypes: `
   *   declare class MyComponent extends Component {
   *     readonly type: 'MyComponent'
   *     speed: number
   *   }
   * `
   */
  readonly ambientTypes?: string

  /**
   * Called once when the plugin is activated for the current project.
   * Async to support wasm / network loading (e.g. HavokPhysics()).
   * Must be idempotent — may be called again after deactivation.
   */
  onActivate?(ctx: PluginContext):   Promise<void>

  /**
   * Called when the plugin is deactivated for the current project,
   * or when the project is closed.
   * Should dispose all Babylon objects and ECS systems created in onActivate.
   */
  onDeactivate?(ctx: PluginContext): void

  /**
   * Called whenever the active ECS world changes (scene create / scene switch /
   * scene load from disk).  Plugins that registered ECS systems with the old
   * world must move them to the new world here.
   */
  onWorldChanged?(oldWorld: World, newWorld: World): void
}
