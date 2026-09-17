import type { EngineTarget } from '@/types/project'
import { ENGINE_PRIORITY }   from '@/types/project'

/**
 * Given:
 *  - `supported`  — engine back-ends detected as available on this machine
 *  - `allowed`    — engine back-ends the project permits (from NebuProjectMeta)
 *
 * Returns the highest-priority engine that satisfies both sets, or `null` when
 * no viable engine can be found.
 *
 * Priority order (best → fallback): webgpu > webgl2 > webgl1
 */
export function resolveActiveEngine(
  supported: EngineTarget[],
  allowed:   EngineTarget[],
): EngineTarget | null {
  for (const engine of ENGINE_PRIORITY) {
    if (supported.includes(engine) && allowed.includes(engine)) return engine
  }
  return null
}
