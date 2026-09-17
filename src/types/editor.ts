// ─────────────────────────────────────────────
// Editor Domain Types
// ─────────────────────────────────────────────

/** Matches Entity.id — a UUID string. */
export type EntityId = string

export type EditorTool = 'select' | 'translate' | 'rotate' | 'scale'
export type GizmoSpace = 'world' | 'local'

/** Settings for the editor viewport camera and default light. */
export interface ViewportPrefs {
  /** Camera near clip plane (minZ). Default 0.1. */
  cameraNearClip: number
  /** Camera far clip plane (maxZ). Default 10000. */
  cameraFarClip:  number
  /** WASD fly speed multiplier. Default 1.0. */
  flySpeed:       number
  /** Editor ambient light intensity. Default 0.9. */
  lightIntensity: number
  /** Editor ambient light direction X. Default 0. */
  lightDirX:      number
  /** Editor ambient light direction Y. Default 1. */
  lightDirY:      number
  /** Editor ambient light direction Z. Default 0. */
  lightDirZ:      number
}

/**
 * Persistent editor preferences — saved between sessions.
 * These are the settings a user deliberately tunes and expects to keep.
 */
export interface EditorPrefs {
  activeTool:      EditorTool
  gizmoSpace:      GizmoSpace
  snapEnabled:     boolean
  snapTranslation: number
  snapRotation:    number
  snapScale:       number
  // Viewport widgets
  showGrid:        boolean
  showWorldAxis:   boolean
  showCameraAxis:  boolean
  // Viewport camera / light settings
  viewport?:       ViewportPrefs
}

/**
 * Full editor state snapshot used internally.
 * Split into:
 *  - `temp`       — volatile, not persisted across restarts (selection, etc.)
 *  - `persistent` — saved to session storage each run  (prefs)
 */
export interface EditorState {
  /** Volatile session state — never saved, always reset on startup. */
  temp: {
    selectedEntityIds: EntityId[]
  }
  /** User preferences — persisted to session storage. */
  persistent: EditorPrefs
}
