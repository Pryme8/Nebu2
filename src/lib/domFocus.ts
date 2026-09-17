/**
 * Focus helpers shared by every keyboard shortcut handler.
 *
 * Single-key editor shortcuts (Q/W/E/R tool switching) and chorded ones
 * (Ctrl+Z / Ctrl+Y) must both stay inert while the user is typing — otherwise
 * renaming an entity to "Wall" silently switches the active tool to Translate.
 */

/**
 * Whether `target` — or, when omitted, the currently focused element — accepts
 * text entry.
 *
 * Covers plain inputs, textareas (which is what Monaco focuses), selects, and
 * any `contenteditable` host.
 */
export function isTextEntryTarget(target?: EventTarget | null): boolean {
  const el = (target as HTMLElement | null) ?? document.activeElement
  if (!(el instanceof HTMLElement)) return false

  switch (el.tagName) {
    case 'INPUT':
    case 'TEXTAREA':
    case 'SELECT':
      return true
    default:
      return el.isContentEditable
  }
}
