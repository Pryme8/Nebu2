import type { SessionState } from '@/types/session'
import { SESSION_VERSION }   from '@/types/session'

const STORAGE_KEY = 'nebu2-session'

/**
 * Thin wrapper around localStorage for serializing/restoring the editor session.
 *
 * Saved data includes:
 *  - Editor preferences (tool, snap, gizmo space)
 *  - Panel layout (positions, sizes, tab groups)
 *  - Optional per-layer state for persistent layers
 *
 * Scene/project data is NOT handled here — that lives in project files.
 */
export class SessionSerializer {

  /** Write the full session snapshot to localStorage. */
  static save(state: SessionState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) {
      console.warn('[SessionSerializer] Could not save session:', e)
    }
  }

  /**
   * Load a previously saved session from localStorage.
   * Returns `null` if nothing is saved, the data is malformed,
   * or the version doesn't match (preventing corrupt state).
   */
  static load(): SessionState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const data = JSON.parse(raw) as SessionState
      if (data.version !== SESSION_VERSION) {
        console.info(
          `[SessionSerializer] Session version mismatch (saved: ${data.version}, expected: ${SESSION_VERSION}). Discarding.`,
        )
        return null
      }
      return data
    } catch (e) {
      console.warn('[SessionSerializer] Could not load session:', e)
      return null
    }
  }

  /** Remove the saved session from localStorage. */
  static clear(): void {
    localStorage.removeItem(STORAGE_KEY)
  }
}
