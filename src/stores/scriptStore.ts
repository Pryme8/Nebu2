// ─────────────────────────────────────────────
// scriptStore — reactive registry of compiled script classes
//
// Responsibilities:
//  - Load .ts files from the project's scripts/ folder
//  - Compile them via ScriptEngine (sucrase → Blob URL import)
//  - Cache ScriptClassEntry objects (name, cls, hooks)
//  - Maintain a map from scriptGuid → ScriptClassEntry
//  - Wire ScriptComponent._entry and popluate propValues defaults
//    on every entity that references this script
//  - Hot-reload: recompile on disk change, notify affected components
// ─────────────────────────────────────────────

import { defineStore }         from 'pinia'
import { ref, computed }       from 'vue'
import { compileScript }       from '@/core/scripting/ScriptEngine'
import { ScriptComponent }     from '@/core/ecs/components/ScriptComponent'
import type { ScriptClassEntry } from '@/types/script'

export const useScriptStore = defineStore('script', () => {

  // ── State ─────────────────────────────────────────────────────────────────

  /**
   * Map from scriptGuid → ScriptClassEntry.
   * A null entry means the script is known (has a .meta) but has not yet been
   * compiled (or failed to compile).
   */
  const _registry = ref(new Map<string, ScriptClassEntry | null>())

  /** Map from scriptGuid → last compile error string (null when healthy). */
  const _errors   = ref(new Map<string, string | null>())

  // ── Public queries ────────────────────────────────────────────────────────

  function getEntry(scriptGuid: string): ScriptClassEntry | null {
    return _registry.value.get(scriptGuid) ?? null
  }

  function getError(scriptGuid: string): string | null {
    return _errors.value.get(scriptGuid) ?? null
  }

  const scriptGuids = computed(() => [..._registry.value.keys()])

  // ── Registration (called when a script file is discovered) ────────────────

  /**
   * Register a known script (its .meta has been read but not yet compiled).
   * Call this during project open so the GUID is known before compilation.
   */
  function registerScript(scriptGuid: string): void {
    if (!_registry.value.has(scriptGuid)) {
      const map = new Map(_registry.value)
      map.set(scriptGuid, null)
      _registry.value = map
    }
  }

  // ── Compilation ───────────────────────────────────────────────────────────

  /**
   * Compile a script from its source string.
   * On success: updates the registry, wires all matching ScriptComponents.
   * On failure: marks the component as disabled and reports via notificationStore.
   *
   * @param scriptGuid  GUID from the .ts.meta sidecar.
   * @param source      Raw TypeScript source.
   * @param scriptName  Display name (filename without extension).
   * @param relPath     Project-relative path to the source file (e.g. "scripts/MyScript.ts").
   */
  async function compileAndRegister(
    scriptGuid: string,
    source:     string,
    scriptName: string,
    relPath:    string = '',
  ): Promise<void> {
    _setError(scriptGuid, null)
    const entry = await compileScript(source, scriptName)

    if (!entry) {
      // compileScript already pushed error to console + notification store
      const errMsg = `Failed to compile "${scriptName}"`
      _setError(scriptGuid, errMsg)
      _disableComponents(scriptGuid, errMsg)
      return
    }

    if (relPath) entry.relPath = relPath
    _setEntry(scriptGuid, entry)
    _wireComponents(scriptGuid, entry)
  }

  // ── Hot-reload ────────────────────────────────────────────────────────────

  /**
   * Re-compile a script that has changed on disk.
   * Calls onEditorDestroy on live editor instances, replaces the class,
   * then calls onEditorAwake on freshly created instances.
   */
  async function hotReload(
    scriptGuid: string,
    source:     string,
    scriptName: string,
    relPath:    string = '',
  ): Promise<void> {
    // Destroy existing editor instances before replacing the class
    _destroyEditorInstances(scriptGuid)
    await compileAndRegister(scriptGuid, source, scriptName, relPath)
    // Re-awake handled by ScriptEditorSystem which watches the registry
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Coerce an ExposedPropDef default to a type-safe value.
   * Prevents crashes when a user writes `default: 0` for a vec3/color field.
   */
  function _coercePropDefault(type: string, value: unknown): unknown {
    if (type === 'vec3' && (typeof value !== 'object' || value === null)) {
      return { x: 0, y: 0, z: 0 }
    }
    if ((type === 'color' || type === 'color3') && (typeof value !== 'object' || value === null)) {
      return { r: 0, g: 0, b: 0 }
    }
    if (type === 'color4' && (typeof value !== 'object' || value === null)) {
      return { r: 0, g: 0, b: 0, a: 1 }
    }
    return value ?? null
  }

  function _setEntry(scriptGuid: string, entry: ScriptClassEntry): void {
    const map = new Map(_registry.value)
    map.set(scriptGuid, entry)
    _registry.value = map
  }

  function _setError(scriptGuid: string, err: string | null): void {
    const map = new Map(_errors.value)
    map.set(scriptGuid, err)
    _errors.value = map
  }

  /**
   * Wire all ScriptComponents that reference `scriptGuid`:
   *   - Set _entry so onInspectorDraw() builds the correct schema
   *   - Populate any missing propValues with the ExposedPropDef defaults
   *   - Clear any previous error state
   *   - Activate editor instances for scripts with editor hooks
   */
  function _wireComponents(scriptGuid: string, entry: ScriptClassEntry): void {
    import('@/stores/sceneStore').then(({ useSceneStore }) => {
      const sceneStore = useSceneStore()
      const scene = sceneStore.activeScene
      if (!scene) return
      for (const entity of scene.world.entities.values()) {
        for (const rawComp of entity.components) {
          if (!rawComp.type.startsWith('Script:')) continue
          const comp = rawComp as ScriptComponent
          if (comp.scriptGuid !== scriptGuid) continue

          comp._entry    = entry
          comp._error    = null
          comp._disabled = false
          // Keep scriptPath in sync with the authoritative relPath from the compiled entry
          if (entry.relPath) comp.scriptPath = entry.relPath

          // Populate defaults for any key not yet in propValues
          for (const def of (entry.cls.exposedProps ?? [])) {
            if (!(def.key in comp.propValues)) {
              comp.propValues[def.key] = _coercePropDefault(def.type, def.default)
            }
          }
          comp.notifyChanged()

          // Activate editor instance if the script has any editor-time lifecycle hooks.
          const bScene = sceneStore.babylonScene
          if (bScene) {
            import('@/core/scripting/ScriptEditorSystem').then(({ scriptEditorSystem }) => {
              scriptEditorSystem.activateComponent(comp, entry, entity, scene.world, bScene)
            })
          }
        }
      }
    })
  }

  /** Mark all ScriptComponents for this guid as disabled with an error. */
  function _disableComponents(scriptGuid: string, errorMsg: string): void {
    import('@/stores/sceneStore').then(({ useSceneStore }) => {
      const scene = useSceneStore().activeScene
      if (!scene) return
      for (const entity of scene.world.entities.values()) {
        for (const rawComp of entity.components) {
          if (!rawComp.type.startsWith('Script:')) continue
          const comp = rawComp as ScriptComponent
          if (comp.scriptGuid !== scriptGuid) continue
          comp._error    = errorMsg
          comp._disabled = true
          comp._entry    = null
          comp.notifyChanged()
        }
      }
    })
  }

  /** Call onEditorDestroy on any live editor instances for hot-reload. */
  function _destroyEditorInstances(scriptGuid: string): void {
    import('@/core/scripting/ScriptEditorSystem').then(({ scriptEditorSystem }) => {
      scriptEditorSystem.destroyInstancesForScript(scriptGuid)
    })
  }

  /**
   * Remove a script from the registry (e.g. when its file is deleted).
   * Disables all matching ScriptComponents so they show the ⚠ badge.
   */
  function removeScript(scriptGuid: string): void {
    _destroyEditorInstances(scriptGuid)
    _disableComponents(scriptGuid, 'Script file deleted')
    const reg = new Map(_registry.value)
    const err = new Map(_errors.value)
    reg.delete(scriptGuid)
    err.delete(scriptGuid)
    _registry.value = reg
    _errors.value   = err
  }

  /**
   * Clear the entire registry.  Called when a project is closed so the
   * old script classes don't bleed into the next project.
   */
  function clearAll(): void {
    for (const guid of [..._registry.value.keys()]) {
      _destroyEditorInstances(guid)
    }
    _registry.value = new Map()
    _errors.value   = new Map()
  }

  /**
   * Wire all ScriptComponents in `entities` against the current compiled registry.
   * Call this whenever a new set of entities is loaded (scene open, play-mode
   * restore) so components don't stay stuck at "Loading…" when scripts were
   * already compiled before the entities arrived.
   */
  function wireSceneEntities(
    entities: Iterable<{ components: Iterable<{ type: string }> }>,
    bScene:   import('@babylonjs/core').Scene | null,
  ): void {
    import('@/stores/sceneStore').then(({ useSceneStore }) => {
      const scene = useSceneStore().activeScene
      for (const entity of entities) {
        for (const rawComp of entity.components) {
          if (!rawComp.type.startsWith('Script:')) continue
          const comp = rawComp as ScriptComponent
          if (!comp.scriptGuid) continue
          const entry = _registry.value.get(comp.scriptGuid) ?? null
          if (!entry || comp._entry === entry) continue
          comp._entry    = entry
          comp._error    = null
          comp._disabled = false
          if (entry.relPath) comp.scriptPath = entry.relPath
          for (const def of (entry.cls.exposedProps ?? [])) {
            if (!(def.key in comp.propValues)) comp.propValues[def.key] = _coercePropDefault(def.type, def.default)
          }
          comp.notifyChanged()
          if (bScene && scene) {
            const ent = scene.world.getEntity((rawComp as ScriptComponent).entityId)
            if (ent) {
              import('@/core/scripting/ScriptEditorSystem').then(({ scriptEditorSystem }) => {
                scriptEditorSystem.activateComponent(comp, entry!, ent, scene.world, bScene!)
              })
            }
          }
        }
      }
    })
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    scriptGuids,
    getEntry,
    getError,
    registerScript,
    compileAndRegister,
    hotReload,
    removeScript,
    clearAll,
    wireSceneEntities,
  }
})
