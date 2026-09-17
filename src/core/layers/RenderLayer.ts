import type { Engine, Scene } from '@babylonjs/core'
import { ILayer } from './ILayer'
import type { IEvent } from './IEvent'
import type { ILayerContext } from './LayerStack'
import { FrameRenderEvent } from './events'
import { EventType } from '@/types/layer'

/**
 * RenderLayer — drives the Babylon.js render loop and integrates it with the
 * LayerStack's update cycle.
 *
 * Responsibilities:
 *  - Owns the Babylon engine's render loop; stops it on detach.
 *  - Each frame: renders the scene, then dispatches a FrameRenderEvent so
 *    other layers (e.g., EditorLayer) can react post-render.
 *  - Handles WindowResizeEvent by calling engine.resize().
 *
 * Usage:
 *  The RenderLayer is pushed onto the LayerStack by BabylonViewport once the
 *  Engine and Scene are initialised. The LayerStack's onUpdate drives Babylon
 *  through this layer instead of a standalone runRenderLoop callback.
 */
export class RenderLayer extends ILayer {
  readonly name = 'RenderLayer'

  private readonly _engine: Engine
  private readonly _scene:  Scene
  private readonly _stack:  ILayerContext

  private _lastTime = performance.now()

  constructor(engine: Engine, scene: Scene, stack: ILayerContext) {
    super()
    this._engine = engine
    this._scene  = scene
    this._stack  = stack
  }

  override onAttach(): void {
    // Hook the LayerStack's update cycle into Babylon's render loop so that
    // onUpdate for ALL layers is called once per rendered frame.
    this._engine.runRenderLoop(this._tick)
  }

  override onDetach(): void {
    this._engine.stopRenderLoop(this._tick)
  }

  override onUpdate(dt: number): void {
    // Render the Babylon scene.
    this._scene.render()

    // Notify all layers (top → bottom) that a frame has just been rendered.
    const ev = new FrameRenderEvent(dt)
    this._stack.dispatchEvent(ev)
  }

  override onEvent(event: IEvent): void {
    if (event.type === EventType.WindowResize) {
      // Keep the canvas resolution in sync with the container.
      // The exact pixel dimensions in WindowResizeEvent are available for
      // other consumers; RenderLayer delegates sizing to Babylon's engine.
      this._engine.resize()
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** Arrow function preserves `this` when passed to runRenderLoop. */
  private _tick = (): void => {
    const now = performance.now()
    const dt  = (now - this._lastTime) / 1000   // seconds
    this._lastTime = now

    // Drive the full LayerStack for this frame (top → bottom).
    this._stack.onUpdate(dt)
  }
}
