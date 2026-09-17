/**
 * Ambient TypeScript declarations injected into Monaco's language service.
 *
 * These mirror the real runtime types (NebuScript, Entity, TransformComponent,
 * ExposedPropDef, Vec3, Color3Like) so that user scripts get full IntelliSense
 * — completions, hover docs, and error squiggles — without importing anything.
 *
 * The string returned by `getNebuAmbientTypes()` is registered with Monaco via
 *   monaco.languages.typescript.typescriptDefaults.addExtraLib(...)
 * using the virtual path `ts:nebu-globals.d.ts`.
 */
export function getNebuAmbientTypes(): string {
  return /* ts */ `
// ─── Nebu ambient type declarations ─────────────────────────────────────────
// These are injected by the editor — you do NOT need to import them.

interface Vec3       { x: number; y: number; z: number }
interface Color3Like { r: number; g: number; b: number }
interface Color4Like { r: number; g: number; b: number; a: number }

// ── ExposedPropDef ────────────────────────────────────────────────────────────

type PropFieldType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'color'
  | 'vec3'
  | 'entity-ref'
  | 'material'
  | 'texture'

interface ExposedPropDef {
  /** Property key on the script instance. */
  key:     string
  /** Display label in the Inspector. */
  label:   string
  /** Field type — controls which widget the Inspector renders. */
  type:    PropFieldType
  /** Default value applied when the component is first attached. */
  default: unknown
  // ── number field extras ────────────────────
  min?:    number
  max?:    number
  step?:   number
}

// ── Component (base) ──────────────────────────────────────────────────────────

declare class Component {
  /** Unique type key, e.g. 'Transform', 'Mesh', 'Light'. */
  readonly type: string
  /** The entity this component belongs to. */
  entityId: string
  /** Whether this component is written to the scene file. */
  persistent: boolean
}

// ── TransformComponent ────────────────────────────────────────────────────────

declare class TransformComponent extends Component {
  readonly type: 'Transform'
  position: import('@babylonjs/core').Vector3
  /** Euler rotation in radians. */
  rotation: import('@babylonjs/core').Vector3
  scale:    import('@babylonjs/core').Vector3
  rotationQuaternion: import('@babylonjs/core').Quaternion | null
  /** World-space forward vector (−Z in Babylon's left-handed system). */
  readonly forward: import('@babylonjs/core').Vector3
  /** World-space up vector. */
  readonly up:      import('@babylonjs/core').Vector3
  /** World-space right vector. */
  readonly right:   import('@babylonjs/core').Vector3
  /** The underlying Babylon TransformNode — available after Play starts. */
  readonly babylonNode: import('@babylonjs/core').TransformNode | null
}

// ── NameComponent ─────────────────────────────────────────────────────────────

declare class NameComponent extends Component {
  readonly type: 'Name'
  /** The display name of the entity. */
  value: string
}

// ── TagComponent ──────────────────────────────────────────────────────────────

declare class TagComponent extends Component {
  readonly type: 'Tag'
  tags: string[]
}

// ── ActiveComponent ───────────────────────────────────────────────────────────

declare class ActiveComponent extends Component {
  readonly type: 'Active'
  /** Whether the entity is active in the scene. */
  enabled: boolean
}

// ── LightComponent ────────────────────────────────────────────────────────────

declare class LightComponent extends Component {
  readonly type: 'Light'
  lightType:   'Hemispheric' | 'Directional' | 'Spot' | 'Point'
  intensity:   number
  diffuse:     Color3Like
  specular:    Color3Like
  /** Direction the light points (Directional / Spot). */
  direction:   Vec3
  /** Sky colour for Hemispheric lights. */
  groundColor: Color3Like
  /** World-space position (Spot / Point). */
  position:    Vec3
  /** Cone half-angle in radians (Spot). */
  angle:       number
  /** Spot exponent — focus of the spot cone. */
  exponent:    number
  castShadows: boolean
  /** Runtime Babylon light instance — available after Play starts. */
  babylonLight: import('@babylonjs/core').HemisphericLight
              | import('@babylonjs/core').DirectionalLight
              | import('@babylonjs/core').SpotLight
              | import('@babylonjs/core').PointLight
              | null
}

// ── CameraComponent ───────────────────────────────────────────────────────────

declare class CameraComponent extends Component {
  readonly type: 'Camera'
  cameraType:     'UniversalCamera' | 'ArcRotateCamera'
  fov:            number
  minZ:           number
  maxZ:           number
  isMainCamera:   boolean
  /** Attach Babylon built-in keyboard / mouse controls. */
  attachControls: boolean
  /** Movement speed (UniversalCamera). */
  speed:          number
  /** Look-at target in world space (ArcRotateCamera). */
  target:         Vec3
  /** Azimuth angle in radians (ArcRotateCamera). */
  alpha:          number
  /** Elevation angle in radians (ArcRotateCamera). */
  beta:           number
  /** Orbit radius (ArcRotateCamera). */
  radius:         number
  /** Entity UUID to track as the look-at target. */
  targetEntityId: string | null
  /** Runtime Babylon camera instance — available after Play starts. */
  babylonCamera:  import('@babylonjs/core').UniversalCamera
                | import('@babylonjs/core').ArcRotateCamera
                | null
  /**
   * Aim the camera at a target.
   * @param node - Optional Babylon TransformNode to look at directly.
   *               When omitted the component uses its own 'targetEntityId'.
   */
  applyLookAt(node?: import('@babylonjs/core').TransformNode | import('@babylonjs/core').Vector3): void
}

// ── MeshComponent ─────────────────────────────────────────────────────────────

declare class MeshComponent extends Component {
  readonly type: 'Mesh'
  source:         'procedural' | 'model'
  modelGuid:      string | null
  meshType:       'Box' | 'Sphere' | 'Cylinder' | 'Capsule' | 'Torus' | 'TorusKnot'
                | 'Ground' | 'Plane' | 'Disc' | 'IcoSphere' | 'Polyhedron'
                | 'TiledPlane' | 'TiledBox' | 'TiledGround'
  materialId:     string | null
  castShadows:    boolean
  receiveShadows: boolean
  /** Runtime Babylon mesh instance — available after Play starts. */
  babylonMesh:    import('@babylonjs/core').Mesh | null
}

// ── Entity ───────────────────────────────────────────────────────────────────

declare class Entity {
  readonly id:    string
  name:           string
  parentId:       string | null
  tags:           string[]
  active:         boolean
  sortOrder:      number

  addComponent<T extends Component>(component: T): T
  getComponent<T extends Component>(type: string): T | undefined
  hasComponent(type: string): boolean
  removeComponent(type: string): boolean
  get components(): IterableIterator<Component>
  get componentTypes(): string[]
}

// ── World ────────────────────────────────────────────────────────────────────

declare class World {
  readonly entities: Map<string, Entity>
  getEntity(id: string): Entity | undefined
  createEntity(name: string): Entity
  destroyEntity(id: string): void
}

// ── NebuScript (base class for all user scripts) ─────────────────────────────

declare abstract class NebuScript {
  // ── Injected at runtime ───────────────────────────────────────────────────
  /** The entity this script is attached to. */
  entity: Entity
  /** The ECS World. */
  world: World
  /** The live Babylon.js Scene. Available in all runtime lifecycle hooks. */
  scene: import("@babylonjs/core").Scene

  // ── Static declaration ────────────────────────────────────────────────────
  /**
   * Declare serializable Inspector properties.
   *
   * @example
   * static override readonly exposedProps: ExposedPropDef[] = [
   *   { key: 'speed',  type: 'number',     label: 'Speed',   default: 5,    min: 0, step: 0.1 },
   *   { key: 'active', type: 'boolean',    label: 'Active',  default: true },
   *   { key: 'label',  type: 'string',     label: 'Label',   default: '' },
   *   { key: 'tint',   type: 'color',      label: 'Tint',    default: { r:1, g:1, b:1 } },
   *   { key: 'offset', type: 'vec3',       label: 'Offset',  default: { x:0, y:0, z:0 } },
   *   { key: 'target', type: 'entity-ref', label: 'Target',  default: null },
   * ]
   */
  static readonly exposedProps: Array<{ key: string; label: string; type: string; default?: unknown; min?: number; max?: number; step?: number }>

  // ── Convenience helpers ───────────────────────────────────────────────────

  /** Shorthand for this entity's TransformComponent. */
  get transform(): TransformComponent

  /**
   * Get a component from this entity by its type key.
   * @example const mesh = this.getComponent<MeshComponent>('Mesh')
   */
  getComponent<T extends Component>(type: string): T | undefined

  /**
   * Find the first entity in the world with the given name.
   * @returns The entity, or undefined if not found.
   */
  findEntity(name: string): Entity | undefined

  /**
   * Find all entities in the world that carry the given tag.
   */
  findEntitiesWithTag(tag: string): Entity[]

  /**
   * Resolve an entity-ref exposed prop to the live Entity.
   * Returns null when the prop is unset or the entity no longer exists.
   * @example const target = this.resolveRef('targetId')
   */
  resolveRef(propKey: string): Entity | null

  // ── Editor-time lifecycle ─────────────────────────────────────────────────
  // Runs in the Nebu editor viewport even when Play is NOT active.

  /** Called once when the script is compiled / hot-reloaded in the editor. */
  onEditorAwake(): void
  /** Called every editor frame (Babylon render loop). */
  onEditorUpdate(dt: number): void
  /** Called when the component is removed or the scene is closed in the editor. */
  onEditorDestroy(): void

  // ── Runtime lifecycle ─────────────────────────────────────────────────────

  /**
   * Called immediately when Play starts, before the first frame.
   * All scripts receive onAwake before any receive onStart.
   * Use for self-contained initialization (cache component refs, etc.).
   */
  onAwake(): void

  /**
   * Called on the first frame, after ALL scripts have finished onAwake.
   * Use when your init depends on another script being ready first.
   */
  onStart(): void

  /** Called whenever this entity / component becomes active. */
  onEnable(): void

  /** Called whenever this entity / component becomes inactive. */
  onDisable(): void

  /**
   * Called every rendered frame.
   * @param dt Elapsed seconds since the last frame.
   */
  onUpdate(dt: number): void

  /**
   * Called after ALL scripts have received onUpdate this frame.
   * Good for camera follow, IK, or anything that reads other scripts' output.
   * @param dt Elapsed seconds since the last frame.
   */
  onLateUpdate(dt: number): void

  /**
   * Called on the physics fixed timestep.
   * Only fires when the scene has an active physics engine (e.g. Havok).
   * Use for physics forces, raycasts, and collision queries.
   * @param dt Fixed timestep interval in seconds.
   */
  onFixedUpdate(dt: number): void

  /**
   * Called just before this entity is destroyed.
   * Clean up timers, subscriptions, or external references here.
   */
  onDestroy(): void
}
// ─────────────────────────────────────────────────────────────────────────────
`
}
