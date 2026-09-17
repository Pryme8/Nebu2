// ─────────────────────────────────────────────
// ECS — AnimationSystem
// ─────────────────────────────────────────────
//
// Drives autoPlay animations at play-mode start and stops all groups at
// shutdown.  Unlike HavokPhysicsSystem, this system is lightweight: it
// coordinates WHEN to start clips but does NOT own any Babylon refs.
// All Babylon objects stay on their AnimationComponent instances (Rule 14).

import { System }            from '../System'
import type { AnimationComponent } from '../components/AnimationComponent'

export class AnimationSystem extends System {

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override onStart(): void {
    const entities = this.world.query('Animation')
    for (const entity of entities) {
      const comp = entity.getComponent<AnimationComponent>('Animation')
      if (!comp) continue
      for (const clip of comp.clips) {
        if (clip.autoPlay) {
          comp.playClip(clip.id)
        }
      }
    }
  }

  override onShutdown(): void {
    const entities = this.world.query('Animation')
    for (const entity of entities) {
      const comp = entity.getComponent<AnimationComponent>('Animation')
      comp?.stopAll()
    }
  }
}
