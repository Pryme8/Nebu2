import type { IEvent } from './IEvent'

/**
 * Abstract base for all layers pushed onto the LayerStack.
 *
 * Lifecycle:
 *   onAttach         — called immediately when the layer is pushed onto the stack.
 *   onDetach         — called immediately before the layer is popped off the stack.
 *   onUpdate         — called once per frame, from top of stack to bottom.
 *   onEvent          — called when an event is dispatched, top to bottom.
 *                       Call event.consume() to stop propagation.
 *   serializeState   — return a plain-object snapshot of this layer's persistent state.
 *   deserializeState — restore state from a previously serialized snapshot.
 *
 * Persistence:
 *   Only layers with `persistent === true` have their state captured by
 *   SessionSerializer.  Override `serializeState` / `deserializeState` to
 *   opt into session restore for layer-specific settings.
 */
export abstract class ILayer {
  /** Display name for debugging / DevTools. */
  abstract readonly name: string

  /**
   * Whether this layer's state is saved as part of the editor session.
   * Default `false` — layers must explicitly opt in by overriding this
   * and implementing serializeState / deserializeState.
   */
  persistent: boolean = false

  onAttach(): void {}
  onDetach(): void {}
  onUpdate(_dt: number): void {}
  onEvent(_event: IEvent): void {}

  /**
   * Return a snapshot of this layer's persistent state.
   * Called by SessionSerializer on save — only invoked when `persistent === true`.
   */
  serializeState(): Record<string, unknown> { return {} }

  /**
   * Restore this layer's state from a previously serialized snapshot.
   * Called by SessionSerializer on load — only invoked when `persistent === true`.
   */
  deserializeState(_data: Record<string, unknown>): void {}
}
