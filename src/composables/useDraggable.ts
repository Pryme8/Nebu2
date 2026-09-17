/**
 * useDraggable — makes a panel header draggable, updating its rect in the store.
 * Fires onSnap callback with live snap preview info while dragging.
 */
import { ref, onUnmounted } from 'vue'
import type { Ref } from 'vue'
import { usePanelStore } from '@/stores/panelStore'
import type { PanelId } from '@/types/panel'

export function useDraggable(
  panelId: PanelId,
  _containerRef: Ref<HTMLElement | null>,
  options?: {
    onDragEnd?: () => void
  }
) {
  const store = usePanelStore()
  const isDragging = ref(false)

  let startMouseX = 0
  let startMouseY = 0
  let startPanelX = 0
  let startPanelY = 0

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const panel   = store.panels.get(panelId)
    const group   = store.groups.get(panelId)
    const target  = panel ?? group
    if (!target) return

    isDragging.value = true
    startMouseX = e.clientX
    startMouseY = e.clientY
    startPanelX = target.rect.x
    startPanelY = target.rect.y

    store.startDrag(panelId)
    store.bringToFront(panelId)

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging.value) return

    const vp = store.viewport
    const dx = (e.clientX - startMouseX) / vp.width
    const dy = (e.clientY - startMouseY) / vp.height
    const nx = startPanelX + dx
    const ny = startPanelY + dy

    const panel = store.panels.get(panelId)
    const group = store.groups.get(panelId)
    const target = panel ?? group
    if (!target) return

    // Compute edge-snapped position and apply it directly so the panel
    // visually "sticks" to nearby edges while dragging.
    const snapped = store.snapRect(panelId, {
      x: nx, y: ny,
      width:  target.rect.width,
      height: target.rect.height,
    })

    if (store.panels.has(panelId)) {
      store.movePanel(panelId, { x: snapped.x, y: snapped.y })
    } else {
      store.moveGroupRect(panelId, { x: snapped.x, y: snapped.y })
    }
  }

  function onMouseUp(_e: MouseEvent) {
    isDragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup',   onMouseUp)

    store.commitSnap(panelId)
    options?.onDragEnd?.()
  }

  onUnmounted(() => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup',   onMouseUp)
  })

  return { isDragging, onMouseDown }
}
