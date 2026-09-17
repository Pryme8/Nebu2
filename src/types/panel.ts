// ─────────────────────────────────────────────
// Panel System Types
// ─────────────────────────────────────────────

export type PanelId = string

export type PanelPosition = { x: number; y: number }
export type PanelSize     = { width: number; height: number }
export type PanelRect     = PanelPosition & PanelSize

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

export type PanelState = 'floating' | 'docked' | 'minimized' | 'maximized'

/** A single panel descriptor. Groups are panels that hold tabs. */
export interface PanelDef {
  id:        PanelId
  title:     string
  component: string          // component registry key
  icon?:     string
  closable?: boolean
  /**
   * Whether this panel's layout (rect, state, group membership) is saved
   * as part of the editor session.  Defaults to `true` for all user-facing
   * panels; set to `false` for transient / programmatic panels that should
   * always start at their default position.
   */
  persistent?: boolean
  state:     PanelState
  rect:      PanelRect
  minSize:   PanelSize
  zIndex:    number
  /** If set, this panel is rendered as a tab inside the given group */
  groupId?:  PanelId
  /**
   * When true the panel body is replaced with a "No project loaded" overlay
   * until projectStore.isOpen is true.
   */
  requiresProject?: boolean
  /**
   * When true the panel body is replaced with a "No scene selected" overlay
   * until sceneStore.activeScene is non-null.
   * Implies requiresProject.
   */
  requiresScene?: boolean
}

/** A tab group holds 1-N panels as tabs */
export interface PanelGroup {
  id:           PanelId
  activeTabId:  PanelId
  tabOrder:     PanelId[]
  rect:         PanelRect
  state:        PanelState
  zIndex:       number
}

/** Snap target returned during drag */
export interface SnapTarget {
  targetId: PanelId
  zone:     DropZone
  rect:     PanelRect        // the preview highlight rect
}
