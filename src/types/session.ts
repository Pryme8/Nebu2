import type { EditorPrefs } from './editor'
import type { PanelState } from './panel'

// ─── Session persistence version ─────────────────────────────────────────────
/** Bump this when the session format changes in a breaking way (triggers discard). */
export const SESSION_VERSION = '1.1.0'

// ─── Panel layout shapes ──────────────────────────────────────────────────────

/**
 * Saved state for a single floating panel (identified by component name,
 * which is stable across sessions unlike the runtime ID).
 */
export interface SerializedPanelEntry {
  /** Component registry key — stable identifier, e.g. 'HierarchyPanel'. */
  component:   string
  title:       string
  state:       PanelState
  rect:        { x: number; y: number; width: number; height: number }
}

/**
 * Saved state for a tab group.
 * Members are identified by their component name (stable), not runtime IDs.
 */
export interface SerializedGroupEntry {
  /** Component names of all tabs, in tab order. */
  members:         string[]
  /** Component name of the currently active tab. */
  activeComponent: string
  state:           PanelState
  rect:            { x: number; y: number; width: number; height: number }
}

export interface SerializedPanelLayout {
  /** Ungrouped panels. */
  panels: SerializedPanelEntry[]
  /** Tab groups (each entry contains the component names of its member panels). */
  groups: SerializedGroupEntry[]
}

// ─── Layer state shape ────────────────────────────────────────────────────────

/** Blob of arbitrary layer-specific persistent state. */
export interface SerializedLayerState {
  /** Must match the layer's `name` property for look-up on restore. */
  name: string
  data: Record<string, unknown>
}

// ─── Full session snapshot ────────────────────────────────────────────────────

/**
 * Snapshot of the full editor session — saved to localStorage between runs.
 * Does NOT include scene/asset/project data (that lives in project files).
 *
 * Only preferences and layout are stored here.  All volatile state (selection,
 * active dialog, etc.) is left at defaults on startup.
 */
export interface SessionState {
  /** Must equal SESSION_VERSION; mismatches cause the session to be discarded. */
  version:     string
  /** Unix ms when the session was last saved. */
  savedAt:     number
  /** Persistent editor preferences (tool, snap, gizmo space). */
  editorPrefs: EditorPrefs
  /** Panel layout at save time. */
  panelLayout: SerializedPanelLayout
  /** Optional per-layer state for layers that opt into persistence. */
  layerStates: SerializedLayerState[]
}
