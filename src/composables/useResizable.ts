/**
 * useResizable — attach resize handles to a panel.
 * Supports 8-directional resize (edges + corners).
 */
import { ref, onUnmounted } from 'vue'
import { usePanelStore } from '@/stores/panelStore'
import type { PanelId } from '@/types/panel'

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const CURSORS: Record<ResizeEdge, string> = {
  n:  'ns-resize',
  s:  'ns-resize',
  e:  'ew-resize',
  w:  'ew-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
}

export function useResizable(panelId: PanelId) {
  const store = usePanelStore()
  const isResizing = ref(false)
  const activeEdge = ref<ResizeEdge | null>(null)

  let startX = 0, startY = 0
  let startW = 0, startH = 0
  let startPX = 0, startPY = 0

  function onHandleMouseDown(e: MouseEvent, edge: ResizeEdge) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const panel = store.panels.get(panelId)
    const group = store.groups.get(panelId)
    const target = panel ?? group
    if (!target) return

    isResizing.value = true
    activeEdge.value = edge
    startX  = e.clientX
    startY  = e.clientY
    startW  = target.rect.width
    startH  = target.rect.height
    startPX = target.rect.x
    startPY = target.rect.y

    document.body.style.cursor = CURSORS[edge]
    store.bringToFront(panelId)

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
  }

  function onMouseMove(e: MouseEvent) {
    if (!isResizing.value || !activeEdge.value) return

    const panel = store.panels.get(panelId)
    const group = store.groups.get(panelId)
    const target = panel ?? group
    if (!target) return

    const vp = store.viewport
    const dx   = (e.clientX - startX) / vp.width
    const dy   = (e.clientY - startY) / vp.height

    // Min sizes in normalized units
    const minW = (panel?.minSize.width  ?? 120) / vp.width
    const minH = (panel?.minSize.height ??  80) / vp.height

    let nx = startPX, ny = startPY, nw = startW, nh = startH

    const edge = activeEdge.value
    if (edge.includes('e')) nw = Math.max(minW, Math.min(startW + dx, 1 - startPX))
    if (edge.includes('s')) nh = Math.max(minH, Math.min(startH + dy, 1 - startPY))
    if (edge.includes('w')) {
      nw = Math.max(minW, Math.min(startW - dx, 1))
      nx = Math.max(0, startPX + (startW - nw))
    }
    if (edge.includes('n')) {
      nh = Math.max(minH, Math.min(startH - dy, 1))
      ny = Math.max(0, startPY + (startH - nh))
    }

    // Snap the moving edge(s) to nearby panel/group/container edges
    const snapped = store.snapResizeRect(panelId, { x: nx, y: ny, width: nw, height: nh }, edge)

    // Re-apply min-size after snapping so we never shrink below the minimum
    nw = Math.max(minW, snapped.width)
    nh = Math.max(minH, snapped.height)
    nx = snapped.x
    ny = snapped.y
    // If snapping the west/north edge pushed the panel past minSize, pin the edge
    if (edge.includes('w')) nx = Math.min(nx, startPX + startW - minW)
    if (edge.includes('n')) ny = Math.min(ny, startPY + startH - minH)

    target.rect.x      = nx
    target.rect.y      = ny
    target.rect.width  = nw
    target.rect.height = nh
  }

  function onMouseUp() {
    isResizing.value = false
    activeEdge.value = null
    document.body.style.cursor = ''
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup',   onMouseUp)
  }

  onUnmounted(() => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup',   onMouseUp)
  })

  return { isResizing, activeEdge, onHandleMouseDown }
}
