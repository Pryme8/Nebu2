import { Component } from '../Component'

/**
 * Marks an entity as the root of a prefab instance.
 * Stamped automatically by sceneStore.instantiatePrefab() on every root entity
 * of an instantiated prefab.  The inspector renders a special banner for this
 * component with "Apply to All", "Save as Unique", and "Revert" actions.
 *
 * persistent = true so the link survives scene save/load.
 */
export class PrefabInstanceComponent extends Component {
  readonly type = 'PrefabInstance'

  /** GUID of the source .prefab asset file. */
  prefabGuid: string

  /** Human-readable name of the source prefab (display only). */
  prefabName: string

  constructor(prefabGuid: string, prefabName: string) {
    super()
    this.prefabGuid = prefabGuid
    this.prefabName = prefabName
    this.persistent = true
  }

  override serialize(): Record<string, unknown> {
    return { prefabGuid: this.prefabGuid, prefabName: this.prefabName }
  }

  static deserialize(data: Record<string, unknown>): PrefabInstanceComponent {
    return new PrefabInstanceComponent(
      (data.prefabGuid as string) ?? '',
      (data.prefabName as string) ?? '',
    )
  }
}
