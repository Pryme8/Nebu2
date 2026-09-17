import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PanelDef, PanelGroup, PanelId, PanelRect, SnapTarget, PanelSize, PanelState } from '@/types/panel'
import type { SerializedPanelLayout, SerializedPanelEntry, SerializedGroupEntry } from '@/types/session'

// Snap threshold in normalized units (~12px at 1080p width)
const SNAP_THRESHOLD_PX = 12
const BASE_Z            = 100

let _zCounter = BASE_Z
function nextZ() { return ++_zCounter }

function uid(): PanelId {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}


export const usePanelStore = defineStore('panel', () => {
  const panels = ref<Map<PanelId, PanelDef>>(new Map())
  const groups = ref<Map<PanelId, PanelGroup>>(new Map())
  const dragState = ref<{ panelId: PanelId; snap: SnapTarget | null } | null>(null)
  const topZ     = ref(BASE_Z)

  // ── viewport — set by PanelManager via ResizeObserver ───────────
  // All rect values are normalized fractions (0-1) of this container.
  const viewport = ref({ x: 0, y: 0, width: 800, height: 600 })

  function setViewport(x: number, y: number, width: number, height: number) {
    viewport.value = { x, y, width, height }
  }

  // Clamp a rect so the panel stays fully inside the container
  function _clamp(rect: PanelRect, minSize: PanelSize): PanelRect {
    const vw = viewport.value.width  || 1
    const vh = viewport.value.height || 1
    const minW = Math.max(minSize.width  / vw, 0.05)
    const minH = Math.max(minSize.height / vh, 0.03)
    const w = Math.max(minW, Math.min(rect.width,  1))
    const h = Math.max(minH, Math.min(rect.height, 1))
    const x = Math.max(0, Math.min(rect.x, 1 - w))
    const y = Math.max(0, Math.min(rect.y, 1 - h))
    return { x, y, width: w, height: h }
  }

  // ── derived ──────────────────────────────────────────────────────
  const floatingPanels = computed(() =>
    [...panels.value.values()].filter(p => !p.groupId)
  )
  const allGroups = computed(() => [...groups.value.values()])

  // ── mutations ────────────────────────────────────────────────────
  function addPanel(def: Omit<PanelDef, 'id' | 'zIndex'>): PanelId {
    const id = uid()
    panels.value.set(id, { ...def, id, zIndex: nextZ() })
    return id
  }

  function removePanel(id: PanelId) {
    const panel = panels.value.get(id)
    if (!panel) return
    // detach from group before removing
    if (panel.groupId) detachFromGroup(id)
    panels.value.delete(id)
  }

  function bringToFront(id: PanelId) {
    const panel = panels.value.get(id)
    if (panel) { panel.zIndex = nextZ(); topZ.value = panel.zIndex }
    const group = groups.value.get(id)
    if (group) { group.zIndex = nextZ(); topZ.value = group.zIndex }
  }

  function movePanel(id: PanelId, pos: { x: number; y: number }) {
    const panel = panels.value.get(id)
    if (!panel) return
    const c = _clamp({ ...panel.rect, x: pos.x, y: pos.y }, panel.minSize)
    panel.rect.x = c.x
    panel.rect.y = c.y
  }

  function resizePanel(id: PanelId, size: { width: number; height: number }) {
    const panel = panels.value.get(id)
    if (!panel) return
    const c = _clamp({ ...panel.rect, width: size.width, height: size.height }, panel.minSize)
    panel.rect.width  = c.width
    panel.rect.height = c.height
  }

  function setPanelState(id: PanelId, state: PanelState) {
    const panel = panels.value.get(id)
    if (panel) panel.state = state
  }

  // ── groups ───────────────────────────────────────────────────────
  function createGroup(panelIds: PanelId[], rect: PanelRect): PanelId {
    const id: PanelId = uid()
    const group: PanelGroup = {
      id,
      activeTabId: panelIds[0]!,
      tabOrder:    [...panelIds],
      rect,
      state: 'floating',
      zIndex: nextZ(),
    }
    groups.value.set(id, group)
    panelIds.forEach(pid => {
      const p = panels.value.get(pid)
      if (p) p.groupId = id
    })
    return id
  }

  function detachFromGroup(panelId: PanelId) {
    const panel = panels.value.get(panelId)
    if (!panel?.groupId) return

    const group = groups.value.get(panel.groupId)
    if (group) {
      group.tabOrder = group.tabOrder.filter(id => id !== panelId)
      if (group.activeTabId === panelId) {
        group.activeTabId = group.tabOrder[0]!
      }
      if (group.tabOrder.length === 0) {
        groups.value.delete(group.id)
      }
    }
    panel.groupId = undefined
    panel.zIndex  = nextZ()
  }

  function setActiveTab(groupId: PanelId, panelId: PanelId) {
    const group = groups.value.get(groupId)
    if (group) group.activeTabId = panelId
  }

  function moveGroupRect(groupId: PanelId, pos: { x: number; y: number }) {
    const group = groups.value.get(groupId)
    if (!group) return
    const w = group.rect.width
    const h = group.rect.height
    group.rect.x = Math.max(0, Math.min(pos.x, 1 - w))
    group.rect.y = Math.max(0, Math.min(pos.y, 1 - h))
  }

  function resizeGroup(groupId: PanelId, size: PanelSize) {
    const group = groups.value.get(groupId)
    if (group) { group.rect.width = size.width; group.rect.height = size.height }
  }

  // ── drag / snap ──────────────────────────────────────────────────
  function startDrag(panelId: PanelId) {
    dragState.value = { panelId, snap: null }
    bringToFront(panelId)
  }

  /**
   * Compute an edge-snapped rect for the dragging panel.
   * Each axis is independently snapped: if any edge of `freeRect` falls within
   * SNAP_THRESHOLD_PX of another panel/group/container edge, the panel is nudged
   * so its nearest edge aligns exactly with that target edge.
   */
  function snapRect(draggingId: PanelId, freeRect: PanelRect): PanelRect {
    const vw = viewport.value.width  || 1
    const vh = viewport.value.height || 1
    const threshX = SNAP_THRESHOLD_PX / vw
    const threshY = SNAP_THRESHOLD_PX / vh

    let snapX: number | null = null
    let snapY: number | null = null
    let bestDistX = threshX
    let bestDistY = threshY

    const dL = freeRect.x
    const dR = freeRect.x + freeRect.width
    const dT = freeRect.y
    const dB = freeRect.y + freeRect.height

    function tryX(draggingEdge: number, targetEdge: number, isLeftEdge: boolean) {
      const dist = Math.abs(draggingEdge - targetEdge)
      if (dist < bestDistX) {
        bestDistX = dist
        snapX = isLeftEdge ? targetEdge : targetEdge - freeRect.width
      }
    }
    function tryY(draggingEdge: number, targetEdge: number, isTopEdge: boolean) {
      const dist = Math.abs(draggingEdge - targetEdge)
      if (dist < bestDistY) {
        bestDistY = dist
        snapY = isTopEdge ? targetEdge : targetEdge - freeRect.height
      }
    }

    // Container walls
    tryX(dL, 0, true);  tryX(dR, 1, false)
    tryY(dT, 0, true);  tryY(dB, 1, false)

    // Other panels and groups
    for (const p of panels.value.values()) {
      if (p.id === draggingId || p.groupId) continue
      const { x, y, width, height } = p.rect
      const tL = x, tR = x + width, tT = y, tB = y + height
      tryX(dL, tL, true);  tryX(dL, tR, true)
      tryX(dR, tL, false); tryX(dR, tR, false)
      tryY(dT, tT, true);  tryY(dT, tB, true)
      tryY(dB, tT, false); tryY(dB, tB, false)
    }
    for (const g of groups.value.values()) {
      const { x, y, width, height } = g.rect
      const tL = x, tR = x + width, tT = y, tB = y + height
      tryX(dL, tL, true);  tryX(dL, tR, true)
      tryX(dR, tL, false); tryX(dR, tR, false)
      tryY(dT, tT, true);  tryY(dT, tB, true)
      tryY(dB, tT, false); tryY(dB, tB, false)
    }

    return {
      x:      snapX ?? freeRect.x,
      y:      snapY ?? freeRect.y,
      width:  freeRect.width,
      height: freeRect.height,
    }
  }

  function commitSnap(_draggingId: PanelId) {
    endDrag()
  }

  /**
   * Snap only the edge(s) that are actively moving during a resize.
   * The opposite edges remain fixed; only the dragged edge is nudged to
   * align with the nearest panel/group/container edge within the threshold.
   */
  function snapResizeRect(draggingId: PanelId, freeRect: PanelRect, edge: string): PanelRect {
    const vw = viewport.value.width  || 1
    const vh = viewport.value.height || 1
    const threshX = SNAP_THRESHOLD_PX / vw
    const threshY = SNAP_THRESHOLD_PX / vh

    // Collect target edges from container walls + every other panel/group
    const txs: number[] = [0, 1]
    const tys: number[] = [0, 1]
    for (const p of panels.value.values()) {
      if (p.id === draggingId || p.groupId) continue
      txs.push(p.rect.x, p.rect.x + p.rect.width)
      tys.push(p.rect.y, p.rect.y + p.rect.height)
    }
    for (const g of groups.value.values()) {
      txs.push(g.rect.x, g.rect.x + g.rect.width)
      tys.push(g.rect.y, g.rect.y + g.rect.height)
    }

    function nearestX(val: number): number | null {
      let best: number | null = null, bestD = threshX
      for (const t of txs) { const d = Math.abs(val - t); if (d < bestD) { bestD = d; best = t } }
      return best
    }
    function nearestY(val: number): number | null {
      let best: number | null = null, bestD = threshY
      for (const t of tys) { const d = Math.abs(val - t); if (d < bestD) { bestD = d; best = t } }
      return best
    }

    let { x, y, width, height } = freeRect

    if (edge.includes('e')) { const s = nearestX(x + width); if (s !== null) width  = s - x }
    if (edge.includes('w')) { const s = nearestX(x);         if (s !== null) { width = width + (x - s); x = s } }
    if (edge.includes('s')) { const s = nearestY(y + height); if (s !== null) height = s - y }
    if (edge.includes('n')) { const s = nearestY(y);          if (s !== null) { height = height + (y - s); y = s } }

    return { x, y, width, height }
  }

  function endDrag() {
    dragState.value = null
  }

  // ── Layout serialization ─────────────────────────────────────────

  /**
   * Capture the current panel layout for session storage.
   * Panels are identified by their `component` name (stable across restarts).
   * Panels with `persistent === false` are excluded.
   */
  function serializeLayout(): SerializedPanelLayout {
    const savedPanels: SerializedPanelEntry[] = []
    // Collect ungrouped panels
    for (const p of panels.value.values()) {
      if (p.persistent === false || p.groupId) continue
      savedPanels.push({
        component: p.component,
        title:     p.title,
        state:     p.state,
        rect:      { ...p.rect },
      })
    }

    const savedGroups: SerializedGroupEntry[] = []
    for (const g of groups.value.values()) {
      const members: string[]  = []
      let   activeComp         = ''
      for (const pid of g.tabOrder) {
        const panel = panels.value.get(pid)
        if (panel && panel.persistent !== false) {
          members.push(panel.component)
          if (pid === g.activeTabId) activeComp = panel.component
        }
      }
      if (members.length === 0) continue
      savedGroups.push({
        members,
        activeComponent: activeComp || (members[0] ?? ''),
        state:           g.state,
        rect:            { ...g.rect },
      })
    }

    return { panels: savedPanels, groups: savedGroups }
  }

  /**
   * Apply a previously serialized layout to the current panel set.
   * Panels are matched by `component` name.
   * Groups are rebuilt from the saved member lists.
   */
  function loadLayout(data: SerializedPanelLayout): void {
    // Helper: find a panel by component name
    const byComp = (component: string): PanelDef | undefined =>
      [...panels.value.values()].find(p => p.component === component)

    // 1. Detach all panels from their existing groups so we start fresh
    for (const panel of panels.value.values()) {
      if (panel.groupId) detachFromGroup(panel.id)
    }
    // Remove any leftover empty groups
    for (const gid of [...groups.value.keys()]) {
      groups.value.delete(gid)
    }

    // 2. Restore ungrouped panel rects
    for (const saved of data.panels) {
      const panel = byComp(saved.component)
      if (!panel) continue
      panel.rect  = { ...saved.rect }
      panel.state = saved.state
    }

    // 3. Rebuild groups
    for (const savedGroup of data.groups) {
      const memberPanels = savedGroup.members
        .map(c => byComp(c))
        .filter((p): p is PanelDef => p !== undefined)

      if (memberPanels.length < 2) {
        // Single panel that was grouped — just restore its rect
        if (memberPanels[0]) {
          memberPanels[0].rect  = { ...savedGroup.rect }
          memberPanels[0].state = savedGroup.state
        }
        continue
      }

      const newGroupId = createGroup(
        memberPanels.map(p => p.id),
        { ...savedGroup.rect },
      )
      const group = groups.value.get(newGroupId)
      if (group) {
        group.state = savedGroup.state
        const activePanel = byComp(savedGroup.activeComponent)
        if (activePanel) group.activeTabId = activePanel.id
      }
    }
  }

  return {
    panels, groups,
    floatingPanels, allGroups,
    dragState, topZ, viewport,
    setViewport,
    addPanel, removePanel, bringToFront,
    movePanel, resizePanel, setPanelState,
    createGroup, detachFromGroup, setActiveTab,
    moveGroupRect, resizeGroup,
    startDrag, snapRect, snapResizeRect, commitSnap, endDrag,
    serializeLayout, loadLayout,
  }
})
