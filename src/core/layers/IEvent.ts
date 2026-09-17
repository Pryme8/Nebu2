import { EventType } from '@/types/layer'

/**
 * Base class for all events dispatched through the LayerStack.
 * Layers can call consume() to stop the event from propagating
 * further down the stack.
 */
export abstract class IEvent {
  abstract readonly type: EventType

  private _consumed = false

  consume(): void    { this._consumed = true }
  isConsumed(): boolean { return this._consumed }

  /** Override to return true for mouse/keyboard input events. */
  isInputEvent(): boolean { return false }
}
