import { ref, readonly } from 'vue'
import type { EngineTarget } from '@/types/project'

// ── Detection (runs once, result cached) ────────────────────────────────────

const _supported = ref<EngineTarget[]>([])
let _detected = false

async function _detect(): Promise<void> {
  if (_detected) return
  _detected = true

  const result: EngineTarget[] = []

  const canvas = document.createElement('canvas')
  if (canvas.getContext('webgl'))  result.push('webgl1')
  if (canvas.getContext('webgl2')) result.push('webgl2')

  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter()
      if (adapter) result.push('webgpu')
    } catch {
      // WebGPU not available
    }
  }

  _supported.value = result
}

// Kick off detection immediately so the result is ready by the time any
// component reads it.  The return value of this module-level call is ignored.
_detect()

// ── Public composable ────────────────────────────────────────────────────────

export function useEngineCapabilities() {
  return {
    /** Reactively updated list of supported engine targets on this machine. */
    supported: readonly(_supported),
    /** Re-run detection (e.g. after a permission change). Returns the result. */
    detect: _detect,
  }
}
