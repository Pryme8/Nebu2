// ─────────────────────────────────────────────
// ECS — Component base class
// ─────────────────────────────────────────────

import type { InspectorSchema } from '@/types/inspector'
import type { WidgetSchema }    from '@/types/widget'

type ChangeListener = () => void

/**
 * Base class for all ECS components.
 * Each concrete component declares a unique `type` string and
 * optionally overrides `serialize()` for persistence.
 */
export abstract class Component {
  abstract readonly type: string

  /** Back-reference set by World when the component is added to an entity. */
  entityId: string = ''

  private readonly _changeListeners = new Set<ChangeListener>()

  /**
   * Subscribe to property changes on this component.
   * Returns an unsubscribe function — call it to remove the listener.
   */
  onChange(fn: ChangeListener): () => void {
    this._changeListeners.add(fn)
    return () => this._changeListeners.delete(fn)
  }

  /**
   * Notify all subscribers that this component's data has changed.
   * Call this after mutating any property, or from external code (e.g. inspector)
   * after direct property assignments.
   */
  notifyChanged(): void {
    this._changeListeners.forEach(fn => fn())
  }

  /**
   * Whether this component is included when its entity is serialized.
   * Set to `false` for runtime-only components (e.g. live Babylon references
   * that have no meaningful JSON representation).
   */
  persistent: boolean = true

  /**
   * Whether the viewport widget for this component is visible.
   * Only meaningful for components that override `onWidgetDraw()`.
   * The ViewportWidgets system reads this each frame to show/hide the widget.
   */
  showWidget: boolean = true

  /** Return a plain-object snapshot for JSON serialization. */
  serialize(): Record<string, unknown> {
    return {}
  }

  /**
   * Return the declarative inspector schema for this component.
   * ComponentInspector.vue reads this to render the correct input widgets.
   * Override in subclasses — default returns an empty schema (no UI).
   */
  onInspectorDraw(): InspectorSchema {
    return []
  }

  /**
   * Push all data properties to any live Babylon objects this component holds.
   * Called by ComponentInspector after every inspector edit.
   * Override in subclasses that own Babylon objects.
   */
  syncToBabylon(): void {}

  /**
   * Called by sceneStore just before this component is removed from its entity
   * (via removeComponentFromEntity or destroyEntity).
   * Override to perform cleanup or cascade side-effects (e.g. removing a
   * mirror component on a linked entity).
   */
  onRemove(): void {}

  /**
   * Called by ViewportWidgets when a widget entry is first registered.
   * Passes the live Babylon scene (typed as `unknown` to avoid a Babylon
   * dependency in this base class).  Override to store the reference if your
   * widget needs to read live scene data in `onWidgetDraw()`.
   */
  onWidgetAttach(_scene: unknown): void {}

  /**
   * Return the declarative widget schema for this component.
   * ViewportWidgets.syncWidgets() renders this as a LineSystem in the editor
   * viewport.  Never shown at runtime.
   * Override in subclasses — default returns null (no widget).
   */
  onWidgetDraw(): WidgetSchema | null {
    return null
  }
  
  onCreate(_babylonScene: unknown, _world: unknown): void {}

  onDispose(): void {}
}
