// ─────────────────────────────────────────────
// Notification types
// ─────────────────────────────────────────────

export type NotificationKind = 'info' | 'success' | 'warning' | 'error'

export interface Notification {
  id:       string
  message:  string
  kind:     NotificationKind
  /** Auto-dismiss after this many ms. 0 = never auto-dismiss. Default 3000. */
  duration: number
}
