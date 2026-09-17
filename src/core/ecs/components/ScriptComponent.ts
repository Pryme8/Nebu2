// ─────────────────────────────────────────────
// ScriptComponent — ECS component that wraps a single user script
//
// One ScriptComponent per script slot per entity.
// Type key is dynamic: `Script:${scriptGuid}` — this lets a single entity
// carry multiple different scripts while the existing component-map API
// (Entity.addComponent / removeComponent / getComponent) works unchanged.
//
// Inspector schema is built dynamically from ScriptClassEntry.cls.exposedProps.
// The scriptStore sets `_entry` on the component after compiling the class;
// until then the inspector shows a "Loading…" placeholder.
//
// propValues stores inspector-written overrides keyed by ExposedPropDef.key.
// syncToBabylon() pushes them onto the live script instance after each edit.
// ─────────────────────────────────────────────

import { Component }              from '../Component'
import { generateGuid }           from '@/lib/guid'
import type { InspectorSchema }   from '@/types/inspector'
import type { NebuScript }        from '@/core/scripting/NebuScript'
import type { ScriptClassEntry }  from '@/types/script'
import type { SerializedScriptComponent } from '@/types/script'

export class ScriptComponent extends Component {
  // ── Identity ──────────────────────────────────────────────────────────────

  /** Dynamic type key: `Script:${slotId}` — stable for the lifetime of this slot. */
  readonly type: string

  /** Stable UUID identifying this script slot (unrelated to which script is assigned). */
  readonly slotId: string

  /** GUID of the script asset (from its .ts.meta sidecar). Empty string = unassigned. */
  scriptGuid: string

  /** Project-relative path shown in the inspector (display; GUID is authoritative). */
  scriptPath: string

  /**
   * Inspector-authored property overrides.
   * Keys match ExposedPropDef.key; values are what the inspector last wrote.
   * synced to the live `_instance` via syncToBabylon().
   */
  propValues: Record<string, unknown>

  /**
   * Manual execution priority.  Higher values run first.
   * When 0 (default) entity sortOrder determines ordering among scripts.
   */
  executionOrder: number

  // ── Runtime-only (not serialized) ────────────────────────────────────────

  /** The live NebuScript instance.  Null when not in play mode. */
  _instance:  NebuScript | null    = null

  /**
   * Loaded class entry from scriptStore.
   * Set by scriptStore after the script file compiles successfully.
   * Also used by onInspectorDraw() to build the schema.
   */
  _entry:     ScriptClassEntry | null = null

  /** Last compile/runtime error message, or null if healthy. */
  _error:     string | null         = null

  /**
   * True when this script has been disabled due to a compile or runtime error.
   * The inspector shows an ⚠ badge; the runtime system skips this component.
   */
  _disabled:  boolean               = false

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(slotId: string, scriptGuid: string, scriptPath: string, executionOrder = 0) {
    super()
    this.slotId         = slotId
    this.scriptGuid     = scriptGuid
    this.scriptPath     = scriptPath
    this.propValues     = {}
    this.executionOrder = executionOrder
    this.type           = `Script:${slotId}`
  }

  /** Create a new empty script slot with no script assigned. */
  static createEmpty(): ScriptComponent {
    return new ScriptComponent(generateGuid(), '', '', 0)
  }

  // ── Inspector ─────────────────────────────────────────────────────────────

  override onInspectorDraw(): InspectorSchema {
    const name = this._getDisplayName()

    if (this._disabled && this._error) {
      return [{ title: `⚠ ${name} (Error)`, fields: [] }]
    }
    if (!this.scriptGuid) {
      // Unbound slot — the picker is rendered externally in InspectorPanel
      return [{ title: 'Script', fields: [] }]
    }
    if (!this._entry) {
      return [{ title: `${name} (Loading…)`, fields: [] }]
    }

    // Map each ExposedPropDef to an inspector field whose key path goes
    // through propValues so ComponentInspector reads/writes propValues[k].
    const fields = (this._entry.cls.exposedProps ?? []).map(p => ({
      ...p,
      key: `propValues.${p.key}`,
    }))

    // Append an execution order field at the bottom
    return [{
      title: name,
      fields: [
        ...fields,
        {
          key:   'executionOrder',
          type:  'number' as const,
          label: 'Exec Order',
          min:   -9999,
          max:   9999,
          step:  1,
        },
      ],
    }]
  }

  /**
   * Push propValues into the live script instance.
   * Called by ComponentInspector (via SetPropertyCommand) after every edit.
   */
  override syncToBabylon(): void {
    if (!this._instance || this._disabled) return
    for (const [k, v] of Object.entries(this.propValues)) {
      (this._instance as unknown as Record<string, unknown>)[k] = v
    }
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  override serialize(): Record<string, unknown> {
    const s: SerializedScriptComponent = {
      slotId:         this.slotId,
      scriptGuid:     this.scriptGuid,
      scriptPath:     this.scriptPath,
      propValues:     { ...this.propValues },
      executionOrder: this.executionOrder,
    }
    return s as unknown as Record<string, unknown>
  }

  static deserialize(data: Record<string, unknown>): ScriptComponent {
    const d = data as unknown as SerializedScriptComponent
    // Fall back to scriptGuid as slotId for scenes saved before the slotId field existed
    const slotId = d.slotId || d.scriptGuid || generateGuid()
    const c = new ScriptComponent(
      slotId,
      d.scriptGuid ?? '',
      d.scriptPath ?? '',
      d.executionOrder ?? 0,
    )
    c.propValues = { ...(d.propValues ?? {}) }
    return c
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _getDisplayName(): string {
    if (this._entry?.name) return this._entry.name
    const parts = this.scriptPath.split(/[/\\]/)
    const file  = parts[parts.length - 1] ?? this.scriptPath
    return file.replace(/\.ts$/, '') || this.scriptGuid.slice(0, 8)
  }
}
