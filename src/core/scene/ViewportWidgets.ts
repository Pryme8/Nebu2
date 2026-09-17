import { Scene, MeshBuilder, Color3, Color4, Vector3, TransformNode, type Node } from '@babylonjs/core'
import type { Mesh, LinesMesh, Observer } from '@babylonjs/core'
import { GridMaterial } from '@babylonjs/materials'
import type { Entity }             from '@/core/ecs/Entity'
import type { WidgetSchema }       from '@/types/widget'
import type { Component }          from '@/core/ecs/Component'
import type { TransformComponent } from '@/core/ecs/components/TransformComponent'
import { CameraComponent }         from '@/core/ecs/components/CameraComponent'

/** One live widget entry: one LineSystem mesh per colour group. */
interface WidgetEntry {
  root:      TransformNode
  meshes:    LinesMesh[]
  component: Component
  /** Set to true by onChange subscriptions; cleared after each rebuild. */
  dirty:     boolean
  /** Unsubscribe functions — called when the entry is disposed. */
  unsubs:    Array<() => void>
  /**
   * Compact signature of the current schema topology:
   * lines-per-group × points-per-line.  Used to detect when the widget
   * geometry must be fully recreated (e.g. collider shape type change).
   */
  topoSig:   string
}

/**
 * ViewportWidgets — manages editor-only visual helpers in the Babylon scene.
 *
 * These meshes are never serialised into ECS data; they exist purely as
 * viewport aids used by the editor.
 *
 * Widgets:
 *  - Ground grid  (GridMaterial infinite-looking plane, 200 × 200 units)
 *  - World-axis arrows  (X=red, Y=green, Z=blue, 5-unit long lines)
 *  - Component widgets  (any Component that overrides onWidgetDraw())
 */
// ── Module-level helpers ─────────────────────────────────────────────────

/** Build a compact topology signature from a WidgetSchema. */
function _topoSig(schema: WidgetSchema): string {
  if (!schema.groups.length) return ''
  return schema.groups
    .map(g => g.lines.map(l => l.length).join(','))
    .join('|')
}

export class ViewportWidgets {
  private readonly _scene: Scene

  private _gridMesh:  Mesh       | null = null
  private _xAxis:     LinesMesh  | null = null
  private _yAxis:     LinesMesh  | null = null
  private _zAxis:     LinesMesh  | null = null

  /** Keyed by `${entityId}__${componentType}` */
  private _widgets     = new Map<string, WidgetEntry>()
  private _widgetObserver: Observer<Scene> | null = null

  constructor(scene: Scene) {
    this._scene = scene
    this._buildGrid()
    this._buildWorldAxis()
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setGridVisible(visible: boolean): void {
    if (this._gridMesh) this._gridMesh.isVisible = visible
  }

  setWorldAxisVisible(visible: boolean): void {
    if (this._xAxis) this._xAxis.isVisible = visible
    if (this._yAxis) this._yAxis.isVisible = visible
    if (this._zAxis) this._zAxis.isVisible = visible
  }

  /**
   * Synchronise all component widgets to the current ECS entity list.
   *
   * Call this whenever entities or components are added or removed.
   * Per-frame geometry updates (driven by `onWidgetDraw()` each tick) handle
   * inspector-driven value changes automatically — no extra call needed.
   *
   * @param entities - flat list from `sceneStore.entityList`
   */
  syncWidgets(entities: Entity[]): void {
    // Build the expected set of keys from every component with a widget
    const incomingKeys = new Set<string>()
    for (const entity of entities) {
      for (const comp of entity.components) {
        if (comp.onWidgetDraw() === null) continue
        incomingKeys.add(`${entity.id}__${comp.type}`)
      }
    }

    // Remove stale entries
    for (const [key, entry] of this._widgets) {
      if (!incomingKeys.has(key)) {
        this._disposeWidgetEntry(entry)
        this._widgets.delete(key)
      }
    }

    // Add new entries
    for (const entity of entities) {
      const tc = entity.getComponent<TransformComponent>('Transform')

      for (const comp of entity.components) {
        comp.onWidgetAttach(this._scene)
        const schema = comp.onWidgetDraw()
        if (schema === null) continue
        const key = `${entity.id}__${comp.type}`
        if (!this._widgets.has(key)) {
          this._widgets.set(key, this._buildWidgetEntry(key, comp, schema, tc?.babylonNode ?? null, tc ?? null))
        }
        // Existing entries keep their subscriptions — component instances are stable
      }
    }

    // Manage the per-frame observer
    if (this._widgets.size > 0 && !this._widgetObserver) {
      this._widgetObserver = this._scene.onBeforeRenderObservable.add(() => this._tickWidgets())
    } else if (this._widgets.size === 0 && this._widgetObserver) {
      this._scene.onBeforeRenderObservable.remove(this._widgetObserver)
      this._widgetObserver = null
    }
  }

  dispose(): void {
    this._gridMesh?.dispose()
    this._xAxis?.dispose()
    this._yAxis?.dispose()
    this._zAxis?.dispose()
    this._gridMesh = null
    this._xAxis    = null
    this._yAxis    = null
    this._zAxis    = null

    if (this._widgetObserver) {
      this._scene.onBeforeRenderObservable.remove(this._widgetObserver)
      this._widgetObserver = null
    }
    for (const entry of this._widgets.values()) this._disposeWidgetEntry(entry)
    this._widgets.clear()
  }

  // ── Generic widget helpers ────────────────────────────────────────────────

  private _buildWidgetEntry(
    key: string, comp: Component, schema: WidgetSchema,
    parentNode: TransformNode | null, tc: TransformComponent | null,
  ): WidgetEntry {
    const root = new TransformNode(`__w_${key}`, this._scene)

    // Camera widgets must be parented to the Babylon camera node (not just the
    // entity TransformNode) so the frustum gizmo inherits the camera's own
    // look-at rotation (set via setTarget) in addition to the world position
    // from the parent TransformNode.
    const widgetParent: Node | null =
      (comp instanceof CameraComponent && comp.babylonCamera)
        ? comp.babylonCamera
        : parentNode
    root.parent = widgetParent

    const meshes = this._buildMeshes(key, schema, root)

    const entry: WidgetEntry = { root, meshes, component: comp, dirty: false, unsubs: [], topoSig: _topoSig(schema) }
    root.setEnabled(comp.showWidget)

    // Subscribe: mark dirty whenever the owning component or the entity transform changes
    entry.unsubs.push(comp.onChange(() => { entry.dirty = true }))
    if (tc) entry.unsubs.push(tc.onChange(() => { entry.dirty = true }))

    return entry
  }

  /** Called once per frame — syncs visibility and rebuilds dirty entries. */
  private _tickWidgets(): void {
    for (const [key, entry] of this._widgets.entries()) {
      // Always sync widget visibility — cheap boolean check each frame
      entry.root.setEnabled(entry.component.showWidget)

      if (!entry.dirty) continue
      entry.dirty = false

      const schema = entry.component.onWidgetDraw()
      if (!schema) continue

      const newSig = _topoSig(schema)
      if (newSig !== entry.topoSig) {
        // Topology changed (e.g. collider shape switched) — recreate all meshes
        entry.meshes.forEach(m => m.dispose())
        entry.meshes  = this._buildMeshes(key, schema, entry.root)
        entry.topoSig = newSig
      } else {
        // Same topology — cheap instance update
        schema.groups.forEach((group, gi) => {
          const mesh = entry.meshes[gi]
          if (!mesh) return
          const bLines = group.lines.map(poly => poly.map(p => new Vector3(p.x, p.y, p.z)))
          MeshBuilder.CreateLineSystem('', { lines: bLines, instance: mesh }, this._scene)
          if (group.color) {
            mesh.color.r = group.color.r
            mesh.color.g = group.color.g
            mesh.color.b = group.color.b
          }
        })
      }

      // Re-parent camera widgets to the current Babylon camera node.
      if (entry.component instanceof CameraComponent && entry.component.babylonCamera) {
        const camNode = entry.component.babylonCamera as unknown as Node
        if (entry.root.parent !== camNode) entry.root.parent = camNode
      }
    }
  }

  /** Create LineSystem meshes from a WidgetSchema, parented to `parent`. */
  private _buildMeshes(key: string, schema: WidgetSchema, parent: TransformNode): LinesMesh[] {
    return schema.groups.map((group, gi) => {
      const bLines = group.lines.map(poly => poly.map(p => new Vector3(p.x, p.y, p.z)))
      const mesh   = MeshBuilder.CreateLineSystem(`__wl_${key}_${gi}`, { lines: bLines, updatable: true }, this._scene)
      mesh.color      = group.color ? new Color3(group.color.r, group.color.g, group.color.b) : new Color3(1, 0.82, 0.3)
      mesh.isPickable = false
      mesh.parent     = parent
      return mesh
    })
  }

  private _disposeWidgetEntry(entry: WidgetEntry): void {
    entry.unsubs.forEach(u => u())
    entry.meshes.forEach(m => m.dispose())
    entry.root.dispose()
  }

  // ── Private builders ──────────────────────────────────────────────────────

  private _buildGrid(): void {
    const ground = MeshBuilder.CreateGround(
      '__editor_grid',
      { width: 200, height: 200 },
      this._scene,
    )

    const mat = new GridMaterial('__editor_grid_mat', this._scene)
    mat.majorUnitFrequency = 5
    mat.minorUnitVisibility = 0.45
    mat.gridRatio           = 1
    mat.mainColor           = new Color3(0.22, 0.22, 0.28)
    mat.lineColor           = new Color3(0.35, 0.35, 0.48)
    mat.opacity             = 0.98
    mat.backFaceCulling     = false

    ground.material    = mat
    ground.isPickable  = false
    this._gridMesh     = ground
  }

  private _buildWorldAxis(): void {
    const LEN = 5
    const O   = Vector3.Zero()

    this._xAxis = MeshBuilder.CreateLines('__editor_axis_x', {
      points: [O, new Vector3(LEN, 0, 0)],
      colors: [new Color4(1, 0.25, 0.25, 1), new Color4(1, 0.25, 0.25, 1)],
    }, this._scene)

    this._yAxis = MeshBuilder.CreateLines('__editor_axis_y', {
      points: [O, new Vector3(0, LEN, 0)],
      colors: [new Color4(0.25, 0.9, 0.25, 1), new Color4(0.25, 0.9, 0.25, 1)],
    }, this._scene)

    this._zAxis = MeshBuilder.CreateLines('__editor_axis_z', {
      points: [O, new Vector3(0, 0, LEN)],
      colors: [new Color4(0.25, 0.45, 1, 1), new Color4(0.25, 0.45, 1, 1)],
    }, this._scene)

    // Ensure they are not pickable so they don't interfere with selection
    this._xAxis.isPickable = false
    this._yAxis.isPickable = false
    this._zAxis.isPickable = false
  }
}
