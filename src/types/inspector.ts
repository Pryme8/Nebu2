// ─────────────────────────────────────────────
// Inspector schema
//
// Components implement onInspectorDraw(): InspectorSchema to describe
// their own inspector UI declaratively.  ComponentInspector.vue reads
// this schema and renders the correct input widget for each field type.
//
// Rule: schema data is never serialized — it is recomputed on demand.
// ─────────────────────────────────────────────

/** Matches a Babylon Vector3's plain-object representation. */
export interface Vec3Like   { x: number; y: number; z: number }
/** Matches a Babylon Color3's plain-object representation (0–1 range). */
export interface Color3Like { r: number; g: number; b: number }
/** Matches a Babylon Color4's plain-object representation (0–1 range). */
export interface Color4Like { r: number; g: number; b: number; a: number }

// ── Field descriptors ────────────────────────────────────────────

interface BasePropField {
  /**
   * Dot-path into the component instance.
   * e.g. "intensity" | "direction.x" | "diffuse"
   */
  key:   string
  label: string
}

export interface NumberField  extends BasePropField { type: 'number';  min?: number; max?: number; step?: number }
export interface BooleanField extends BasePropField { type: 'boolean' }
export interface StringField  extends BasePropField { type: 'string' }
/** Renders three numeric inputs for x / y / z. */
export interface Vec3Field    extends BasePropField { type: 'vec3';   step?: number }
/** Renders a colour swatch + R G B numeric inputs (0–1 range). */
export interface Color3Field  extends BasePropField { type: 'color3' }
/** Renders a colour swatch + R G B A numeric inputs (0–1 range). */
export interface Color4Field  extends BasePropField { type: 'color4' }
/** Renders a <select> drop-down. */
export interface EnumField    extends BasePropField {
  type:    'enum'
  options: Array<{ label: string; value: string | number }>
}
/** Renders a drag-drop target that accepts an entity dragged from the hierarchy. Stores entity ID as string | null. */
export interface EntityRefField extends BasePropField { type: 'entity-ref' }

/** Renders a drop-down populated from the materialStore.  Stores material ID as string | null. */
export interface MaterialRefField extends BasePropField { type: 'material-ref' }

/** Renders a drag-drop thumbnail slot for a texture asset.  Stores texture GUID as string | null. */
export interface TextureRefField extends BasePropField { type: 'texture-ref' }

/** Renders a drag-drop slot for a model asset (.glb / .gltf / etc.).  Stores asset GUID as string | null. */
export interface ModelRefField extends BasePropField { type: 'model-ref' }

/** Renders the animation clip manager — clip list with Edit/Delete/Add buttons. */
export interface AnimationClipListField extends BasePropField { type: 'animation-clip-list' }

export type PropField =
  | NumberField
  | BooleanField
  | StringField
  | Vec3Field
  | Color3Field
  | Color4Field
  | EnumField
  | EntityRefField
  | MaterialRefField
  | TextureRefField
  | ModelRefField
  | AnimationClipListField

// ── Section & schema ─────────────────────────────────────────────

export interface PropSection {
  title:  string
  fields: PropField[]
}

/** Full inspector layout returned by Component.onInspectorDraw(). */
export type InspectorSchema = PropSection[]

/**
 * Anything that can be rendered in the inspector.
 * Both ECS components and the SceneSettingsProxy implement this interface.
 */
export interface InspectorTarget {
  onInspectorDraw(): InspectorSchema
  syncToBabylon(): void
  notifyChanged(): void
}
