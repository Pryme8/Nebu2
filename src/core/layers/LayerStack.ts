import type { ILayer } from './ILayer'
import type { IEvent } from './IEvent'

/**
 * Minimal interface for objects that need to drive updates and dispatch events
 * without holding a reference to the concrete LayerStack class.
 * Useful when passing the stack through Pinia stores (which erase private fields).
 */
export interface ILayerContext {
  onUpdate(dt: number): void
  dispatchEvent(event: IEvent): void
}

/**
 * Manages an ordered collection of ILayer instances.
 *
 * - Layers are stored bottom → top (index 0 = bottom, last = top).
 * - pushLayer appends to the top; the layer's onAttach is called immediately.
 * - popLayer searches from the top; the layer's onDetach is called before removal.
 * - onUpdate iterates top → bottom so the topmost layer updates first.
 * - dispatchEvent propagates top → bottom and stops early if the event is consumed.
 */
export class LayerStack {
  private _layers: ILayer[] = []

  /** Push a layer onto the top of the stack and call its onAttach. */
  pushLayer(layer: ILayer): void {
    this._layers.push(layer)
    layer.onAttach()
  }

  /** Remove a layer from the stack (searching top-down) and call its onDetach. */
  popLayer(layer: ILayer): void {
    // Search from the top so we always detach the topmost matching instance.
    for (let i = this._layers.length - 1; i >= 0; i--) {
      if (this._layers[i] === layer) {
        layer.onDetach()
        this._layers.splice(i, 1)
        return
      }
    }
  }

  /**
   * Update all layers for this frame, top → bottom.
   * @param dt Elapsed time in seconds since the last frame.
   */
  onUpdate(dt: number): void {
    for (let i = this._layers.length - 1; i >= 0; i--) {
      this._layers[i]?.onUpdate(dt)
    }
  }

  /**
   * Dispatch an event through the stack, top → bottom.
   * Propagation stops once event.isConsumed() returns true.
   */
  dispatchEvent(event: IEvent): void {
    for (let i = this._layers.length - 1; i >= 0; i--) {
      if (event.isConsumed()) break
      this._layers[i]?.onEvent(event)
    }
  }

  /** Read-only view of all layers (bottom → top). */
  get layers(): readonly ILayer[] {
    return this._layers
  }

  get size(): number {
    return this._layers.length
  }
}
