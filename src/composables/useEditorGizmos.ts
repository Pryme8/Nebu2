/**
 * useEditorGizmos — wires custom transform gizmos to editorStore.
 *
 * Position (translate): CustomPositionGizmo
 * Rotation:             CustomRotationGizmo
 * Scale:                CustomScaleGizmo
 *
 * Bounding box: mesh.showBoundingBox = true on the selected entity's Babylon
 * mesh, styled via scene.getBoundingBoxRenderer().
 *
 * Undo/redo: SetPropertyCommand pushed per drag gesture (onDragEnd).
 */

import { watch, onUnmounted } from 'vue'
import type { ShallowRef }     from 'vue'

import { PointerEventTypes, Color3 } from '@babylonjs/core'
import type { Scene as BabylonScene, Observer, PointerInfo, AbstractMesh } from '@babylonjs/core'
import { CustomPositionGizmo } from '@/core/scene/gizmos/CustomPositionGizmo'
import { CustomRotationGizmo } from '@/core/scene/gizmos/CustomRotationGizmo'
import { CustomScaleGizmo }    from '@/core/scene/gizmos/CustomScaleGizmo'

import { useEditorStore }      from '@/stores/editorStore'
import { useSceneStore }       from '@/stores/sceneStore'
import { useCommandStore }     from '@/stores/commandStore'
import { TransformComponent }  from '@/core/ecs/components/TransformComponent'
import { MeshComponent }       from '@/core/ecs/components/MeshComponent'
import { SetPropertyCommand }  from '@/core/commands/component'
import type { Vec3 }           from '@/core/ecs/components/TransformComponent'

// Accent colour from style.css --color-accent
const ACCENT = Color3.FromHexString('#6366f1')

// ── Composable ────────────────────────────────────────────────────────────────

export function useEditorGizmos(sceneRef: ShallowRef<BabylonScene | null>): void {
  const editorStore  = useEditorStore()
  const sceneStore   = useSceneStore()
  const commandStore = useCommandStore()

  // ── Per-scene state ───────────────────────────────────────────────────────

  let posGizmo: CustomPositionGizmo | null = null
  let rotGizmo: CustomRotationGizmo | null = null
  let sclGizmo: CustomScaleGizmo    | null = null

  let _activeScene: BabylonScene | null = null
  let _pickObs:     Observer<PointerInfo> | null = null

  // Drag state — snapshotted at drag-start for undo
  let _dragStartValue: Vec3 | null = null

  // Bounding box tracking — meshes currently showing their bounding box
  const _bbMeshes = new Set<AbstractMesh>()

  // ── Entity / component helpers ────────────────────────────────────────────

  function getTransformNode(id: string | null) {
    if (!id) return null
    return sceneStore.activeScene
      ?.world.getEntity(id)
      ?.getComponent<TransformComponent>('Transform')
      ?.babylonNode ?? null
  }

  function getBabylonMesh(id: string): AbstractMesh | null {
    const m = sceneStore.activeScene
      ?.world.getEntity(id)
      ?.getComponent<MeshComponent>('Mesh')
      ?.babylonMesh
    return (m as AbstractMesh | null | undefined) ?? null
  }

  // ── Bounding-box highlight ────────────────────────────────────────────────

  function updateBoundingBoxes(): void {
    for (const m of _bbMeshes) m.showBoundingBox = false
    _bbMeshes.clear()
    if (editorStore.isPlaying) return

    for (const id of editorStore.selectedIds) {
      // Prefer the direct MeshComponent mesh; fall back to any child mesh
      const direct = getBabylonMesh(id)
      if (direct) {
        direct.showBoundingBox = true
        _bbMeshes.add(direct)
      } else {
        const node = getTransformNode(id)
        if (!node) continue
        for (const child of node.getChildMeshes(false)) {
          child.showBoundingBox = true
          _bbMeshes.add(child)
        }
      }
    }
  }

  // ── Drag sync (node → ECS component) ─────────────────────────────────────

  function syncFromNode(
    tf: TransformComponent,
    _prop: 'position' | 'rotation' | 'scale',
    clearQuat = false,
  ): void {
    const n = tf.babylonNode
    if (!n) return
    // The proxy keeps position/scale in sync automatically.  For rotation, the
    // proxy getter already reads from rotationQuaternion when set.  The only
    // action needed here is converting back to Euler at drag-end (clearQuat).
    if (clearQuat && n.rotationQuaternion) {
      const e = n.rotationQuaternion.toEulerAngles()
      n.rotationQuaternion = null
      n.rotation.set(e.x, e.y, e.z)
    }
    tf.notifyChanged()
  }

  // ── Drag subscriptions ────────────────────────────────────────────────────

  function subscribePosGizmo(gizmo: CustomPositionGizmo): () => void {
    const h0 = gizmo.onDragStartObservable.add(() => {
      const id = editorStore.primaryId
      if (!id) return
      const tf = sceneStore.activeScene?.world.getEntity(id)?.getComponent<TransformComponent>('Transform')
      if (tf) _dragStartValue = { ...tf.position }
    })
    const h1 = gizmo.onDragObservable.add(() => {
      const id = editorStore.primaryId
      if (!id) return
      const tf = sceneStore.activeScene?.world.getEntity(id)?.getComponent<TransformComponent>('Transform')
      if (tf) syncFromNode(tf, 'position', false)
    })
    const h2 = gizmo.onDragEndObservable.add(() => {
      const id = editorStore.primaryId
      const tf = id ? sceneStore.activeScene?.world.getEntity(id)?.getComponent<TransformComponent>('Transform') : null
      if (!tf || !_dragStartValue || !id) { _dragStartValue = null; return }
      syncFromNode(tf, 'position', false)
      const newVal: Vec3 = { ...tf.position }
      const gestureId = `gizmo-pos-${id}-${performance.now()}`
      commandStore.execute(new SetPropertyCommand(tf, 'position', _dragStartValue, newVal, gestureId))
      _dragStartValue = null
    })
    return () => {
      gizmo.onDragStartObservable.remove(h0)
      gizmo.onDragObservable.remove(h1)
      gizmo.onDragEndObservable.remove(h2)
    }
  }

  function subscribeRotGizmo(gizmo: CustomRotationGizmo): () => void {
    let _startQuat: { x: number; y: number; z: number } | null = null
    const h0 = gizmo.onDragStartObservable.add(() => {
      const id = editorStore.primaryId
      if (!id) return
      const tf = sceneStore.activeScene?.world.getEntity(id)?.getComponent<TransformComponent>('Transform')
      if (tf) _startQuat = { ...tf.rotation }
    })
    const h1 = gizmo.onDragObservable.add(() => {
      const id = editorStore.primaryId
      if (!id) return
      const tf = sceneStore.activeScene?.world.getEntity(id)?.getComponent<TransformComponent>('Transform')
      if (tf) syncFromNode(tf, 'rotation', false)
    })
    const h2 = gizmo.onDragEndObservable.add(() => {
      const id = editorStore.primaryId
      const tf = id ? sceneStore.activeScene?.world.getEntity(id)?.getComponent<TransformComponent>('Transform') : null
      if (!tf || !_startQuat || !id) { _startQuat = null; return }
      syncFromNode(tf, 'rotation', true)   // clearQuat=true: convert back to Euler
      const newVal: Vec3 = { ...tf.rotation }
      const gestureId = `gizmo-rot-${id}-${performance.now()}`
      commandStore.execute(new SetPropertyCommand(tf, 'rotation', _startQuat, newVal, gestureId))
      _startQuat = null
    })
    return () => {
      gizmo.onDragStartObservable.remove(h0)
      gizmo.onDragObservable.remove(h1)
      gizmo.onDragEndObservable.remove(h2)
    }
  }

  function subscribeSclGizmo(gizmo: CustomScaleGizmo): () => void {
    let _startScale: Vec3 | null = null
    const h0 = gizmo.onDragStartObservable.add(() => {
      const id = editorStore.primaryId
      if (!id) return
      const tf = sceneStore.activeScene?.world.getEntity(id)?.getComponent<TransformComponent>('Transform')
      if (tf) _startScale = { ...tf.scale }
    })
    const h1 = gizmo.onDragObservable.add(() => {
      const id = editorStore.primaryId
      if (!id) return
      const tf = sceneStore.activeScene?.world.getEntity(id)?.getComponent<TransformComponent>('Transform')
      if (tf) syncFromNode(tf, 'scale', false)
    })
    const h2 = gizmo.onDragEndObservable.add(() => {
      const id = editorStore.primaryId
      const tf = id ? sceneStore.activeScene?.world.getEntity(id)?.getComponent<TransformComponent>('Transform') : null
      if (!tf || !_startScale || !id) { _startScale = null; return }
      syncFromNode(tf, 'scale', false)
      const newVal: Vec3 = { ...tf.scale }
      const gestureId = `gizmo-scl-${id}-${performance.now()}`
      commandStore.execute(new SetPropertyCommand(tf, 'scale', _startScale, newVal, gestureId))
      _startScale = null
    })
    return () => {
      gizmo.onDragStartObservable.remove(h0)
      gizmo.onDragObservable.remove(h1)
      gizmo.onDragEndObservable.remove(h2)
    }
  }

  // ── Gizmo visibility / attachment ─────────────────────────────────────────

  function applySnap(): void {
    if (posGizmo) posGizmo.snapDistance  = editorStore.snapEnabled ? editorStore.snapTranslation : 0
    if (rotGizmo) rotGizmo.snapAngle     = editorStore.snapEnabled ? editorStore.snapRotation    : 0
    if (sclGizmo) sclGizmo.snapIncrement = editorStore.snapEnabled ? editorStore.snapScale        : 0
  }

  function applyGizmo(): void {
    const tool  = editorStore.activeTool
    const local = editorStore.gizmoSpace === 'local'
    const node  = editorStore.isPlaying ? null : getTransformNode(editorStore.primaryId)

    if (posGizmo) { posGizmo.localSpace = local; posGizmo.attachedNode = (tool === 'translate' ? node : null) }
    if (rotGizmo) { rotGizmo.localSpace = local; rotGizmo.attachedNode = (tool === 'rotate'    ? node : null) }
    if (sclGizmo) sclGizmo.attachedNode = (tool === 'scale' ? node : null)

    applySnap()
  }

  // ── Select-mode pick observer ─────────────────────────────────────────────

  let _downX = 0
  let _downY = 0

  /**
   * Walk up the Babylon node hierarchy to find the owning ECS entity.
   * TransformNodes: id = entityId (set by `new TransformNode(entity.id, scene)`).
   * Meshes: name = entityId (they're also named with the entityId).
   */
  function pickEntityId(
    node: { name: string; id?: string; parent: unknown } | null,
  ): string | null {
    const world = sceneStore.activeScene?.world
    if (!world) return null
    while (node) {
      if (node.id   && world.getEntity(node.id))   return node.id
      if (node.name && world.getEntity(node.name)) return node.name
      node = node.parent as typeof node | null
    }
    return null
  }

  function setupPickObserver(scene: BabylonScene | null): void {
    if (_activeScene && _pickObs) {
      _activeScene.onPointerObservable.remove(_pickObs)
      _pickObs = null
    }
    _activeScene = scene
    if (!scene) return

    _pickObs = scene.onPointerObservable.add((info: PointerInfo) => {
      if (editorStore.isPlaying) return

      if (info.type === PointerEventTypes.POINTERDOWN) {
        const e = info.event as PointerEvent
        _downX = e.clientX
        _downY = e.clientY
        return
      }

      if (info.type !== PointerEventTypes.POINTERUP) return
      const e = info.event as PointerEvent
      if (e.button !== 0) return
      if (editorStore.activeTool !== 'select') return

      // Ignore drags (camera orbit) — 6px threshold
      const dx = e.clientX - _downX
      const dy = e.clientY - _downY
      if (dx * dx + dy * dy > 36) return

      const multi = e.shiftKey
      const pick  = info.pickInfo
      if (!pick?.hit || !pick.pickedMesh) {
        if (!multi) editorStore.clearSelection()
        return
      }

      const entityId = pickEntityId(
        pick.pickedMesh as unknown as { name: string; id?: string; parent: unknown },
      )
      if (entityId) {
        editorStore.select(entityId, multi)
      } else if (!multi) {
        editorStore.clearSelection()
      }
    })
  }

  // ── Scene init / teardown ─────────────────────────────────────────────────

  let _unsubDrags: (() => void) | null = null

  function initScene(scene: BabylonScene | null): void {
    _unsubDrags?.(); _unsubDrags = null
    for (const m of _bbMeshes) m.showBoundingBox = false
    _bbMeshes.clear()

    posGizmo?.dispose(); posGizmo = null
    rotGizmo?.dispose(); rotGizmo = null
    sclGizmo?.dispose(); sclGizmo = null

    setupPickObserver(scene)
    if (!scene) return

    const bbr = scene.getBoundingBoxRenderer()
    bbr.frontColor    = ACCENT
    bbr.backColor     = ACCENT
    bbr.showBackLines = true

    posGizmo = new CustomPositionGizmo(scene)
    rotGizmo = new CustomRotationGizmo(scene)
    sclGizmo = new CustomScaleGizmo(scene)

    const unsubPos = subscribePosGizmo(posGizmo)
    const unsubRot = subscribeRotGizmo(rotGizmo)
    const unsubScl = subscribeSclGizmo(sclGizmo)
    _unsubDrags = () => { unsubPos(); unsubRot(); unsubScl() }

    applyGizmo()
    updateBoundingBoxes()
  }

  // ── Watchers ──────────────────────────────────────────────────────────────

  const stopSceneWatch = watch(sceneRef, initScene, { immediate: true })

  watch(() => editorStore.activeTool, applyGizmo)
  watch(() => editorStore.primaryId,  applyGizmo)
  watch(() => editorStore.gizmoSpace, applyGizmo)
  watch(() => sceneStore.entityList,  applyGizmo)

  watch(
    [() => editorStore.snapEnabled, () => editorStore.snapTranslation, () => editorStore.snapRotation, () => editorStore.snapScale],
    applySnap,
  )

  // Watch selectedIds — Vue 3 tracks Set mutations reactively
  watch(() => Array.from(editorStore.selectedIds), updateBoundingBoxes)

  watch(() => editorStore.isPlaying, () => {
    applyGizmo()
    updateBoundingBoxes()
  })

  onUnmounted(() => {
    stopSceneWatch()
    initScene(null)
  })
}

