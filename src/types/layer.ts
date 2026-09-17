// ─── Layer & Event type definitions ───────────────────────────────────────────

/**
 * All event types that can be dispatched through the LayerStack.
 * Declared as a const object so it is fully type-erasable.
 */
export const EventType = {
  // Mouse
  MouseMove:    'MouseMove',
  MouseDown:    'MouseDown',
  MouseUp:      'MouseUp',
  MouseWheel:   'MouseWheel',
  // Keyboard
  KeyDown:      'KeyDown',
  KeyUp:        'KeyUp',
  // Window
  WindowResize: 'WindowResize',
  // Render
  FrameRender:  'FrameRender',
  // ECS
  TransformChanged: 'TransformChanged',
} as const

export type EventType = (typeof EventType)[keyof typeof EventType]

/** Modifier key state bundled with keyboard / mouse events. */
export interface ModifierKeys {
  shift: boolean
  ctrl:  boolean
  alt:   boolean
}
