// ─────────────────────────────────────────────
// pluginStore — Plugin registry and lifecycle management
//
// This store is the single source of truth for all plugins the application
// knows about.  It separates two concerns:
//
//   1. REGISTRATION — plugins are registered at app boot (registerPlugin).
//      No side effects: no Babylon objects, no systems, nothing.
//
//   2. ACTIVATION — plugins are activated per-project (activatePlugin).
//      This merges component types into the ECS registry and calls the
//      plugin's onActivate hook with the live Babylon + ECS context.
//
// Components contributed by active plugins are exposed through
// `pluginAddableComponents` so InspectorPanel can include them in the
// "Add Component" dropdown without knowing about specific plugins.
// ─────────────────────────────────────────────

import { defineStore }     from 'pinia'
import { ref, computed }   from 'vue'
import type { NebuPlugin, PluginContext, PluginComponentDef } from '@/types/plugin'
import type { World }                                         from '@/core/ecs/World'
import { defaultComponentRegistry }                           from '@/core/ecs/componentRegistry'
import { useNotificationStore }                               from '@/stores/notificationStore'

export const usePluginStore = defineStore('plugin', () => {

  // ── State ──────────────────────────────────────────────────────────────────

  /** All plugins the app knows about (registered at startup). */
  const _registered = new Map<string, NebuPlugin>()

  /** IDs of currently active plugins (for the open project). */
  const activePluginIds = ref<Set<string>>(new Set())

  /**
   * Reactive list of all registered plugins, for UI rendering.
   * Re-builds whenever a plugin is registered or activated/deactivated.
   */
  const _registeredRevision = ref(0)

  const registeredPlugins = computed<NebuPlugin[]>(() => {
    _registeredRevision.value  // reactive dependency
    return [..._registered.values()]
  })

  // ── Registration ───────────────────────────────────────────────────────────

  /**
   * Register a plugin so the app is aware of it.
   * Safe to call before any project is open — no side effects.
   * Calling again with the same id is a no-op (idempotent).
   */
  function registerPlugin(plugin: NebuPlugin): void {
    if (_registered.has(plugin.id)) return
    _registered.set(plugin.id, plugin)
    _registeredRevision.value++
  }

  // ── Activation / Deactivation ──────────────────────────────────────────────

  /**
   * Activate a plugin for the current project.
   *
   *  1. Merges the plugin's component defs into `defaultComponentRegistry`
   *     so World.deserialize can reconstruct their components from saved JSON.
   *  2. Calls plugin.onActivate(ctx) if defined (may be async — awaited here).
   *  3. Marks the plugin as active.
   *
   * Safe to call if the plugin is already active (idempotent).
   */
  async function activatePlugin(id: string, ctx: PluginContext): Promise<void> {
    if (activePluginIds.value.has(id)) return

    const plugin = _registered.get(id)
    if (!plugin) {
      console.warn(`[PluginStore] Cannot activate unknown plugin: ${id}`)
      return
    }

    try {
      // Merge component deserializers into the global registry
      for (const def of plugin.components) {
        defaultComponentRegistry.set(def.type, def.deserialize)
      }

      if (plugin.onActivate) {
        await plugin.onActivate(ctx)
      }

      // Trigger reactivity by replacing the Set
      activePluginIds.value = new Set([...activePluginIds.value, id])
    } catch (err) {
      // Roll back registry entries on failure
      for (const def of plugin.components) {
        defaultComponentRegistry.delete(def.type)
      }
      useNotificationStore().error(`Plugin "${plugin.displayName}" failed to activate: ${String(err)}`)
      console.error(`[PluginStore] activatePlugin(${id}) threw:`, err)
    }
  }

  /**
   * Deactivate a plugin for the current project.
   *
   *  1. Calls plugin.onDeactivate(ctx) if defined.
   *  2. Removes the plugin's component deserializers from `defaultComponentRegistry`.
   *  3. Marks the plugin as inactive.
   *
   * Safe to call if the plugin is already inactive (idempotent).
   */
  function deactivatePlugin(id: string, ctx: PluginContext): void {
    if (!activePluginIds.value.has(id)) return

    const plugin = _registered.get(id)
    if (!plugin) return

    try {
      if (plugin.onDeactivate) {
        plugin.onDeactivate(ctx)
      }
    } catch (err) {
      console.error(`[PluginStore] deactivatePlugin(${id}) threw:`, err)
    }

    // Remove component deserializers
    for (const def of plugin.components) {
      defaultComponentRegistry.delete(def.type)
    }

    // Trigger reactivity
    const next = new Set(activePluginIds.value)
    next.delete(id)
    activePluginIds.value = next
  }

  /**
   * Deactivate ALL currently active plugins.
   * Called when a project is closed so no stale Babylon objects linger.
   */
  function deactivateAll(ctx: PluginContext): void {
    for (const id of [...activePluginIds.value]) {
      deactivatePlugin(id, ctx)
    }
  }

  // ── Plugin-contributed component definitions ────────────────────────────────

  /**
   * Flat list of all PluginComponentDef entries from every active plugin.
   * InspectorPanel uses this to extend the "Add Component" dropdown.
   */
  const pluginComponentDefs = computed<PluginComponentDef[]>(() => {
    const ids = activePluginIds.value   // reactive
    const defs: PluginComponentDef[] = []
    for (const id of ids) {
      const plugin = _registered.get(id)
      if (plugin) defs.push(...plugin.components)
    }
    return defs
  })

  /**
   * Concatenated Monaco ambient type declaration strings from every
   * REGISTERED plugin that declares an `ambientTypes` field.
   *
   * Using registered (not active) so IntelliSense for plugin component types
   * is available as soon as a plugin is registered at app start — without
   * waiting for Babylon activation (which requires a live scene context).
   */
  const allAmbientTypes = computed<string>(() => {
    _registeredRevision.value   // reactive dependency — updates when registerPlugin() is called
    const parts: string[] = []
    for (const plugin of _registered.values()) {
      if (plugin.ambientTypes) parts.push(plugin.ambientTypes)
    }
    return parts.join('\n')
  })

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function isActive(id: string): boolean {
    return activePluginIds.value.has(id)
  }

  function getPlugin(id: string): NebuPlugin | undefined {
    return _registered.get(id)
  }

  /**
   * Register component deserializers for the given plugin IDs into
   * `defaultComponentRegistry` without running `onActivate`.
   *
   * Call this before loading a scene from disk so that plugin-contributed
   * component types survive World.deserialize even when the full Babylon
   * context (needed for onActivate) isn't available yet.
   */
  function primeComponentRegistry(ids: string[]): void {
    for (const id of ids) {
      const plugin = _registered.get(id)
      if (!plugin) continue
      for (const def of plugin.components) {
        defaultComponentRegistry.set(def.type, def.deserialize)
      }
    }
  }

  /**
   * Notify all active plugins that the active ECS world has changed.
   * Plugins that registered systems with the old world must move them here.
   * Called by sceneStore whenever a scene create/switch/load changes the world.
   */
  function notifyWorldChanged(oldWorld: World, newWorld: World): void {
    for (const id of activePluginIds.value) {
      const plugin = _registered.get(id)
      plugin?.onWorldChanged?.(oldWorld, newWorld)
    }
  }

  return {
    // State
    registeredPlugins,
    activePluginIds,
    pluginComponentDefs,
    allAmbientTypes,
    // Actions
    registerPlugin,
    activatePlugin,
    deactivatePlugin,
    deactivateAll,
    primeComponentRegistry,
    notifyWorldChanged,
    // Helpers
    isActive,
    getPlugin,
  }
})
