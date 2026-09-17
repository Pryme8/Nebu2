// ─────────────────────────────────────────────
// Animation Domain Types
// ─────────────────────────────────────────────

// ── Value Types (map to BABYLON.Animation.ANIMATIONTYPE_*) ──────

export type AnimatableValueType =
  | 'Float'       // ANIMATIONTYPE_FLOAT
  | 'Vector2'     // ANIMATIONTYPE_VECTOR2
  | 'Vector3'     // ANIMATIONTYPE_VECTOR3
  | 'Quaternion'  // ANIMATIONTYPE_QUATERNION
  | 'Color3'      // ANIMATIONTYPE_COLOR3
  | 'Color4'      // ANIMATIONTYPE_COLOR4
  | 'Matrix'      // ANIMATIONTYPE_MATRIX

// ── Loop Modes (map to BABYLON.Animation.ANIMATIONLOOPMODE_*) ───

export type AnimationLoopMode =
  | 'Cycle'                 // ANIMATIONLOOPMODE_CYCLE
  | 'Constant'              // ANIMATIONLOOPMODE_CONSTANT
  | 'Relative'              // ANIMATIONLOOPMODE_RELATIVE
  | 'Yoyo'                  // ANIMATIONLOOPMODE_YOYO

// ── Easing ──────────────────────────────────────────────────────

export type EasingType =
  | 'None'
  | 'Circle'
  | 'Back'
  | 'Bounce'
  | 'Cubic'
  | 'Elastic'
  | 'Exponential'
  | 'Power'
  | 'Quadratic'
  | 'Quartic'
  | 'Quintic'
  | 'Sine'
  | 'Bezier'

export type EasingMode = 'EaseIn' | 'EaseOut' | 'EaseInOut'

export interface EasingDef {
  type: EasingType
  mode: EasingMode
  /** Bezier control points [x1, y1, x2, y2]. Only used when type === 'Bezier'. */
  bezier?: [number, number, number, number]
}

// ── Keyframe ────────────────────────────────────────────────────

/**
 * A single keyframe on an animation track.
 * `value` is a plain number for Float tracks, or an array for multi-component
 * types: [x, y] for Vector2, [x, y, z] for Vector3/Color3, [x, y, z, w] for
 * Quaternion/Color4.
 */
export interface KeyframeDef {
  /** Frame number (integer, >= 0). */
  frame: number
  value: number | number[]
  /** Per-keyframe easing override. Falls back to the track default if absent. */
  easing?: EasingDef
}

// ── Animation Track ─────────────────────────────────────────────

/**
 * One animated property.  Each track maps to a single BABYLON.Animation object.
 */
export interface AnimationTrackDef {
  /** Stable GUID within the clip. */
  id: string
  /**
   * Dot-path property on the target Babylon node.
   * e.g. "position", "position.x", "intensity", "diffuse"
   */
  property: string
  valueType: AnimatableValueType
  keyframes: KeyframeDef[]
  /** Default easing applied to all keyframes that don't supply their own. */
  easing: EasingDef
  /** Whether this track is muted (skipped during rebuild). */
  muted: boolean
}

// ── Animation Clip ───────────────────────────────────────────────

/**
 * One named animation clip — wraps a set of tracks + playback settings.
 * Each clip maps to a BABYLON.AnimationGroup.
 */
export interface AnimationClipDef {
  /** Stable GUID. */
  id: string
  name: string
  /** Frames per second (Babylon Animation fps parameter). Must be > 0. */
  fps: number
  /** Total frame count. Determines clip duration = frameCount / fps seconds. */
  frameCount: number
  loopMode: AnimationLoopMode
  tracks: AnimationTrackDef[]
  /** Playback speed multiplier (default 1). */
  speedRatio: number
  /** Auto-play when the scene loads at runtime. */
  autoPlay: boolean
  /** Enable smooth blending when this clip is started. */
  enableBlending: boolean
  /** How fast to blend in (lower = slower blend). */
  blendingSpeed: number
}

// ── Animation Event ──────────────────────────────────────────────

/**
 * A timed callback fired by the AnimationSystem at a specific frame.
 * `handler` is matched against empty-arg methods on the entity's ScriptComponents.
 */
export interface AnimationEventDef {
  frame: number
  /** Method name to call on Script components attached to the same entity. */
  handler: string
}

// ── Common Animatable Property Catalogue ────────────────────────

export interface AnimatablePropDescriptor {
  label:     string
  property:  string
  valueType: AnimatableValueType
  category:  string
}

/** Catalogue of well-known animatable properties for the track picker. */
export const ANIMATABLE_PROPS: AnimatablePropDescriptor[] = [
  // Transform
  { label: 'Position',    property: 'position',   valueType: 'Vector3',  category: 'Transform' },
  { label: 'Position X',  property: 'position.x', valueType: 'Float',    category: 'Transform' },
  { label: 'Position Y',  property: 'position.y', valueType: 'Float',    category: 'Transform' },
  { label: 'Position Z',  property: 'position.z', valueType: 'Float',    category: 'Transform' },
  { label: 'Rotation',    property: 'rotation',   valueType: 'Vector3',  category: 'Transform' },
  { label: 'Rotation X',  property: 'rotation.x', valueType: 'Float',    category: 'Transform' },
  { label: 'Rotation Y',  property: 'rotation.y', valueType: 'Float',    category: 'Transform' },
  { label: 'Rotation Z',  property: 'rotation.z', valueType: 'Float',    category: 'Transform' },
  { label: 'Scale',       property: 'scaling',    valueType: 'Vector3',  category: 'Transform' },
  { label: 'Scale X',     property: 'scaling.x',  valueType: 'Float',    category: 'Transform' },
  { label: 'Scale Y',     property: 'scaling.y',  valueType: 'Float',    category: 'Transform' },
  { label: 'Scale Z',     property: 'scaling.z',  valueType: 'Float',    category: 'Transform' },
  { label: 'Rotation (Quaternion)', property: 'rotationQuaternion', valueType: 'Quaternion', category: 'Transform' },
  // Visibility
  { label: 'Visibility',  property: 'visibility', valueType: 'Float',    category: 'Mesh' },
  // Light
  { label: 'Intensity',   property: 'intensity',  valueType: 'Float',    category: 'Light' },
  { label: 'Diffuse',     property: 'diffuse',    valueType: 'Color3',   category: 'Light' },
  { label: 'Specular',    property: 'specular',   valueType: 'Color3',   category: 'Light' },
  // Camera
  { label: 'FOV',         property: 'fov',        valueType: 'Float',    category: 'Camera' },
  { label: 'Near Clip',   property: 'minZ',       valueType: 'Float',    category: 'Camera' },
  { label: 'Far Clip',    property: 'maxZ',       valueType: 'Float',    category: 'Camera' },
]

/** Helper: default value for a given value type (for new keyframes). */
export function defaultKeyframeValue(type: AnimatableValueType): number | number[] {
  switch (type) {
    case 'Float':      return 0
    case 'Vector2':    return [0, 0]
    case 'Vector3':    return [0, 0, 0]
    case 'Color3':     return [1, 1, 1]
    case 'Quaternion': return [0, 0, 0, 1]
    case 'Color4':     return [1, 1, 1, 1]
    case 'Matrix':     return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }
}
