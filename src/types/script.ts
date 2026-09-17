// ─────────────────────────────────────────────
// Script types
//
// ExposedPropDef feeds both the static `exposedProps` array on NebuScript
// subclasses AND the inspector schema built by ScriptComponent.onInspectorDraw().
// The `type` and supporting fields map 1-to-1 with PropField in inspector.ts.
// ─────────────────────────────────────────────

import type { PropField } from './inspector'

/**
 * One exposed property on a NebuScript subclass.
 * Users declare these in the static `exposedProps` array on their script class.
 *
 * The shape extends PropField (the existing inspector field type) with a
 * `default` value that is applied when the component is first attached and
 * no saved value exists yet.
 *
 * Example:
 *   static readonly exposedProps: ExposedPropDef[] = [
 *     { key: 'speed',  type: 'number',     label: 'Speed',  default: 5,    min: 0 },
 *     { key: 'target', type: 'entity-ref', label: 'Target', default: null },
 *   ]
 */
export type ExposedPropDef = PropField & {
  /** The initial value used when the component is first attached. */
  default: unknown
}

/**
 * Serialized form stored per ScriptComponent in the .scene file.
 */
export interface SerializedScriptComponent {
  /** Stable UUID for this script slot (independent of which script asset is assigned). */
  slotId:         string
  /** GUID that identifies the script asset (matches its .ts.meta file). Empty when unassigned. */
  scriptGuid:     string
  /** Project-relative path — shown in inspector; GUID is authoritative. */
  scriptPath:     string
  /** Inspector-written overrides keyed by ExposedPropDef.key. */
  propValues:     Record<string, unknown>
  /**
   * Manual execution priority.  Higher numbers run first.
   * When 0 (default) the entity's sortOrder determines ordering.
   */
  executionOrder: number
}

/**
 * Which lifecycle hooks a script class actually overrides.
 * Computed once at class-load time by comparing each prototype method against
 * NebuScript.prototype.  Any method that is NOT overridden means we skip
 * registering the corresponding Babylon observable, saving per-frame cycles.
 */
export interface ScriptHookFlags {
  // ── Editor-time ──────────────────────────────
  onEditorAwake:   boolean
  onEditorUpdate:  boolean
  onEditorDestroy: boolean
  // ── Runtime ──────────────────────────────────
  onAwake:         boolean
  onStart:         boolean
  onEnable:        boolean
  onDisable:       boolean
  onUpdate:        boolean
  onLateUpdate:    boolean
  onFixedUpdate:   boolean
  onDestroy:       boolean
}

/**
 * One entry in scriptStore's reactive class registry.
 * Created when ScriptEngine successfully compiles a script file.
 */
export interface ScriptClassEntry {
  /** The compiled, executable script class constructor. */
  cls:  new () => import('@/core/scripting/NebuScript').NebuScript
  /** Display name derived from the filename (no path, no extension). */
  name: string
  /** Lifecycle presence flags computed at load time. */
  hooks: ScriptHookFlags
  /** Project-relative path to the source file (e.g. "scripts/MyScript.ts"). */
  relPath?: string
}
