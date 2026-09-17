import { EventType, type ModifierKeys } from '@/types/layer'
import { IEvent } from './IEvent'

// ──────────────────────────────── Mouse ───────────────────────────────────────

export class MouseMoveEvent extends IEvent {
  readonly type = EventType.MouseMove
  readonly x: number
  readonly y: number
  readonly deltaX: number
  readonly deltaY: number
  constructor(x: number, y: number, deltaX: number, deltaY: number) {
    super()
    this.x = x
    this.y = y
    this.deltaX = deltaX
    this.deltaY = deltaY
  }
  override isInputEvent() { return true }
}

export class MouseDownEvent extends IEvent {
  readonly type = EventType.MouseDown
  readonly x: number
  readonly y: number
  /** 0 = primary, 1 = middle, 2 = secondary */
  readonly button: number
  readonly modifiers: ModifierKeys
  constructor(x: number, y: number, button: number, modifiers: ModifierKeys) {
    super()
    this.x = x
    this.y = y
    this.button = button
    this.modifiers = modifiers
  }
  override isInputEvent() { return true }
}

export class MouseUpEvent extends IEvent {
  readonly type = EventType.MouseUp
  readonly x: number
  readonly y: number
  readonly button: number
  readonly modifiers: ModifierKeys
  constructor(x: number, y: number, button: number, modifiers: ModifierKeys) {
    super()
    this.x = x
    this.y = y
    this.button = button
    this.modifiers = modifiers
  }
  override isInputEvent() { return true }
}

export class MouseWheelEvent extends IEvent {
  readonly type = EventType.MouseWheel
  readonly x: number
  readonly y: number
  /** Positive = scroll down, negative = scroll up */
  readonly delta: number
  readonly modifiers: ModifierKeys
  constructor(x: number, y: number, delta: number, modifiers: ModifierKeys) {
    super()
    this.x = x
    this.y = y
    this.delta = delta
    this.modifiers = modifiers
  }
  override isInputEvent() { return true }
}

// ─────────────────────────────── Keyboard ─────────────────────────────────────

export class KeyDownEvent extends IEvent {
  readonly type = EventType.KeyDown
  readonly key: string
  readonly code: string
  readonly modifiers: ModifierKeys
  readonly repeat: boolean
  constructor(key: string, code: string, modifiers: ModifierKeys, repeat: boolean) {
    super()
    this.key = key
    this.code = code
    this.modifiers = modifiers
    this.repeat = repeat
  }
  override isInputEvent() { return true }
}

export class KeyUpEvent extends IEvent {
  readonly type = EventType.KeyUp
  readonly key: string
  readonly code: string
  readonly modifiers: ModifierKeys
  constructor(key: string, code: string, modifiers: ModifierKeys) {
    super()
    this.key = key
    this.code = code
    this.modifiers = modifiers
  }
  override isInputEvent() { return true }
}

// ─────────────────────────────── Window ───────────────────────────────────────

export class WindowResizeEvent extends IEvent {
  readonly type = EventType.WindowResize
  readonly width: number
  readonly height: number
  constructor(width: number, height: number) {
    super()
    this.width = width
    this.height = height
  }
}

// ─────────────────────────────── Render ───────────────────────────────────────

/** Dispatched by RenderLayer once per rendered frame. */
export class FrameRenderEvent extends IEvent {
  readonly type = EventType.FrameRender
  /** Time elapsed since last frame in seconds. */
  readonly deltaTime: number
  constructor(deltaTime: number) {
    super()
    this.deltaTime = deltaTime
  }
}

// ─────────────────────────────── ECS ──────────────────────────────────────────

/**
 * Dispatched whenever an entity's TransformComponent is mutated.
 * Any layer or system can subscribe to this to react to entity movement.
 */
export class TransformChangedEvent extends IEvent {
  readonly type = EventType.TransformChanged
  readonly entityId: string
  constructor(entityId: string) {
    super()
    this.entityId = entityId
  }
}
