// ─────────────────────────────────────────────
// ECS — System base class
// ─────────────────────────────────────────────

import type { World } from './World'

/**
 * Base class for all ECS systems.
 * Override onStart / onUpdate / onShutdown as needed.
 * `world` is injected by World.addSystem().
 */
export abstract class System {
  world!: World

  onStart():               void {}
  onUpdate(_dt: number):   void {}
  onShutdown():            void {}
}
