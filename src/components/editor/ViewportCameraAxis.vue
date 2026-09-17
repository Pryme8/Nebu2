<template>
  <!-- Camera-axis orientation gizmo rendered into a small 2-D canvas overlay -->
  <canvas
    ref="canvasRef"
    :width="SIZE"
    :height="SIZE"
    class="absolute bottom-3 right-3 rounded-full cursor-pointer pointer-events-auto select-none"
    :style="{ width: `${SIZE}px`, height: `${SIZE}px` }"
    title="Camera orientation — click an axis to snap view"
    @click="onCanvasClick"
  />
</template>

<script setup lang="ts">
/**
 * ViewportCameraAxis — draws a mini orientation gizmo in the viewport corner.
 *
 * Each animation frame it reads the active camera's view matrix, projects the
 * three world-space axis vectors into 2-D gizmo space, and paints them onto an
 * off-screen canvas.  Clicking near any axis tip snaps the ArcRotateCamera to
 * the corresponding orthographic view.
 *
 * Coordinate maths
 * ──────────────────
 * Babylon.js uses a row-vector / DX convention:  v_clip = v_world × M_view
 * The upper-left 3×3 of M_view in Matrix.m (stored row-major):
 *   row 0 → m[0..2],  row 1 → m[4..6],  row 2 → m[8..10]
 * So for a world direction (wx, wy, wz) its camera-space coords are:
 *   cx = wx·m[0] + wy·m[1] + wz·m[2]
 *   cy = wx·m[4] + wy·m[5] + wz·m[6]
 *   cz = wx·m[8] + wy·m[9] + wz·m[10]
 * We map cx → screen-right, cy → screen-up (−cy in canvas y), cz → depth.
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { ArcRotateCamera, Vector3 } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'

const props = defineProps<{ scene: Scene }>()

// ── Constants ─────────────────────────────────────────────────────────────────

const SIZE        = 80
const CENTER      = SIZE / 2
const ARM_SCALE   = SIZE * 0.33   // radius for axis tips
const TIP_RADIUS  = 5             // hit-test / drawn circle radius
const LABEL_SCALE = 1.30          // how far past the tip to draw the letter

// Axis definitions: positive and negative ends
interface AxisDef {
  wx: number; wy: number; wz: number     // world direction (unit vector)
  color: string                          // CSS color string
  label: string                          // character to draw at tip
  snapAlpha: number                      // ArcRotateCamera.alpha for snap
  snapBeta:  number                      // ArcRotateCamera.beta  for snap
  positive:  boolean                     // draw full line (true) or ghost (false)
}

const AXES: AxisDef[] = [
  // +X  red
  { wx:  1, wy: 0, wz: 0, color: '#e05252', label: 'X',  snapAlpha: 0,            snapBeta: Math.PI / 2,  positive: true  },
  // -X  red (dimmed)
  { wx: -1, wy: 0, wz: 0, color: '#e05252', label: '-X', snapAlpha: Math.PI,       snapBeta: Math.PI / 2,  positive: false },
  // +Y  green
  { wx: 0, wy:  1, wz: 0, color: '#52e052', label: 'Y',  snapAlpha: -Math.PI / 2, snapBeta: 0.01,          positive: true  },
  // -Y  green (dimmed)
  { wx: 0, wy: -1, wz: 0, color: '#52e052', label: '-Y', snapAlpha: -Math.PI / 2, snapBeta: Math.PI - 0.01, positive: false },
  // +Z  blue
  { wx: 0, wy: 0, wz:  1, color: '#5285e0', label: 'Z',  snapAlpha: Math.PI / 2,  snapBeta: Math.PI / 2,  positive: true  },
  // -Z  blue (dimmed)
  { wx: 0, wy: 0, wz: -1, color: '#5285e0', label: '-Z', snapAlpha: -Math.PI / 2, snapBeta: Math.PI / 2,  positive: false },
]

// ── Refs ──────────────────────────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null)

/** Last-drawn projected tips — kept for hit-testing on click. */
let lastProjected: Array<{ sx: number; sy: number; axis: AxisDef }> = []

let rafId = 0

// ── Draw ──────────────────────────────────────────────────────────────────────

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const scene = props.scene
  if (!scene?.activeCamera) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Use Vector3.TransformNormal to project world-space axis directions into
  // camera space — avoids typed-array index-access strictness issues.
  const viewMatrix = scene.activeCamera.getViewMatrix()

  // Project each axis and attach depth for painter's-algorithm sorting
  const projected = AXES.map(axis => {
    const camDir = Vector3.TransformNormal(
      new Vector3(axis.wx, axis.wy, axis.wz),
      viewMatrix,
    )
    return {
      sx:    CENTER + camDir.x * ARM_SCALE,
      sy:    CENTER - camDir.y * ARM_SCALE,  // canvas y is inverted
      depth: camDir.z,
      axis,
    }
  })

  // Sort back-to-front so far axes render below near ones
  projected.sort((a, b) => a.depth - b.depth)
  lastProjected = projected.map(p => ({ sx: p.sx, sy: p.sy, axis: p.axis }))

  ctx.clearRect(0, 0, SIZE, SIZE)

  // Background circle
  ctx.beginPath()
  ctx.arc(CENTER, CENTER, CENTER - 1, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(14, 14, 20, 0.60)'
  ctx.fill()

  // Draw axes back-to-front
  for (const p of projected) {
    const { sx, sy, axis } = p
    const alpha = axis.positive ? 1.0 : 0.35

    ctx.globalAlpha = alpha

    if (axis.positive) {
      // Line from center to tip
      ctx.beginPath()
      ctx.moveTo(CENTER, CENTER)
      ctx.lineTo(sx, sy)
      ctx.strokeStyle = axis.color
      ctx.lineWidth   = 1.8
      ctx.stroke()
    }

    // Tip circle
    ctx.beginPath()
    ctx.arc(sx, sy, axis.positive ? TIP_RADIUS : TIP_RADIUS * 0.7, 0, Math.PI * 2)
    ctx.fillStyle = axis.color
    ctx.fill()

    // Label — only for positive axes
    if (axis.positive) {
      const lx = CENTER + (sx - CENTER) * LABEL_SCALE
      const ly = CENTER + (sy - CENTER) * LABEL_SCALE
      ctx.font      = 'bold 8px monospace'
      ctx.fillStyle = axis.color
      ctx.textAlign      = 'center'
      ctx.textBaseline   = 'middle'
      ctx.fillText(axis.label, lx, ly)
    }
  }

  ctx.globalAlpha = 1
}

function loop(): void {
  draw()
  rafId = requestAnimationFrame(loop)
}

// ── Snap on click ─────────────────────────────────────────────────────────────

function onCanvasClick(e: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const scene = props.scene
  if (!scene?.activeCamera) return

  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  // Find the nearest axis tip within TIP_RADIUS * 2 px
  let bestDist = TIP_RADIUS * 2.5
  let bestAxis: AxisDef | null = null

  for (const p of lastProjected) {
    const dx = mx - p.sx
    const dy = my - p.sy
    const d  = Math.sqrt(dx * dx + dy * dy)
    if (d < bestDist) {
      bestDist = d
      bestAxis = p.axis
    }
  }

  if (!bestAxis) return

  const cam = scene.activeCamera
  if (!(cam instanceof ArcRotateCamera)) return

  cam.alpha = bestAxis.snapAlpha
  cam.beta  = bestAxis.snapBeta
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => { loop() })
onUnmounted(() => { cancelAnimationFrame(rafId) })
</script>
