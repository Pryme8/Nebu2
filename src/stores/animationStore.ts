// ─────────────────────────────────────────────
// Animation Store — editor timeline state
// ─────────────────────────────────────────────
//
// This store owns ALL transient animation-editor state: which entity/clip is
// being edited, the scrubber position, zoom, selection, and preview playback.
// Nothing here is serialized — it is purely session memory.
//
// The store communicates with AnimationComponent's Babylon groups via the
// sceneStore to drive live viewport preview (goToFrame, play, stop).

import { defineStore }    from 'pinia'
import { ref, computed, watch } from 'vue'
import { useSceneStore }  from '@/stores/sceneStore'
import { useCommandStore } from '@/stores/commandStore'
import { InsertKeyframeCommand } from '@/core/commands/animation'
import type { AnimationClipDef, AnimationTrackDef, KeyframeDef, AnimatableValueType } from '@/types/animation'
import { generateGuid }  from '@/lib/guid'
import { defaultKeyframeValue } from '@/types/animation'

export const useAnimationStore = defineStore('animation', () => {

  // ── Active context ──────────────────────────────────────────
  const activeEntityId = ref<string | null>(null)
  const activeClipId   = ref<string | null>(null)

  // ── Timeline state ──────────────────────────────────────────
  const currentFrame    = ref(0)
  const isPlaying       = ref(false)
  const previewSpeed    = ref(1)
  /** How many frames are visible in the timeline viewport (zoom). */
  const zoomFrames      = ref(120)
  /** Horizontal scroll offset in frames. */
  const scrollOffset    = ref(0)
  const snapToFrame     = ref(true)
  const showTangents    = ref(false)

  /** Selected keyframe keys = `${trackId}:${frame}` */
  const selectedKeyframes = ref(new Set<string>())
  const selectedTrackIds  = ref(new Set<string>())

  // ── Frame observer (RAF loop while playing) ─────────────────
  let _rafId: number | null = null

  // ── Reactivity bridge: subscribe to AnimationComponent.onChange ──────────
  // AnimationComponent is a plain class — Vue can't track mutations to its
  // clip/track arrays directly.  We bump `_compRev` every time the component
  // fires notifyChanged() so that `activeClip` (and any template that reads it)
  // re-evaluates automatically.
  const _compRev = ref(0)
  let   _compUnsub: (() => void) | null = null

  function _resubscribe(): void {
    _compUnsub?.()
    _compUnsub = null
    const eid = activeEntityId.value
    if (!eid) return
    const entity = useSceneStore().activeScene?.world.getEntity(eid)
    const comp   = entity?.getComponent('Animation') as
      import('@/core/ecs/components/AnimationComponent').AnimationComponent | undefined
    if (comp) {
      _compUnsub = comp.onChange(() => { _compRev.value++ })
    }
  }

  watch([activeEntityId, activeClipId], _resubscribe, { flush: 'sync' })

  // ── Derived ─────────────────────────────────────────────────

  const activeClip = computed<AnimationClipDef | null>(() => {
    _compRev.value  // reactive dependency — re-runs when notifyChanged() fires
    if (!activeEntityId.value || !activeClipId.value) return null
    const entity = useSceneStore().activeScene?.world.getEntity(activeEntityId.value)
    const animComp = entity?.getComponent('Animation') as import('@/core/ecs/components/AnimationComponent').AnimationComponent | undefined
    const clip = animComp?.getClip(activeClipId.value)
    if (!clip) return null
    // Return shallow clones so Vue detects reference changes after in-place mutations.
    // - Spread the clip so the computed returns a new object reference each time.
    // - Spread each track + its keyframes array so AnimationTrackRow re-renders
    //   when keyframes are added/removed without a full track-list rebuild.
    return {
      ...clip,
      tracks: clip.tracks.map(t => ({ ...t, keyframes: [...t.keyframes] })),
    }
  })

  /** Pixel-to-frame ratio helper used by timeline components. */
  const frameCount = computed(() => activeClip.value?.frameCount ?? 60)

  // ── Context ─────────────────────────────────────────────────

  /**
   * Open a clip for editing in the timeline.
   * Called from the AnimationComponent inspector "Edit" button.
   */
  function editClip(entityId: string, clipId: string): void {
    if (activeEntityId.value !== entityId || activeClipId.value !== clipId) {
      _stopPreview()
      activeEntityId.value = entityId
      activeClipId.value   = clipId
      currentFrame.value   = 0
      selectedKeyframes.value.clear()
      selectedTrackIds.value.clear()
    }
    // Switch to the AnimationPanel tab (or bring to front if floating)
    import('@/stores/panelStore').then(({ usePanelStore }) => {
      const ps = usePanelStore()
      const found = [...ps.panels.values()].find(p => p.component === 'AnimationPanel')
      if (!found) return
      if (found.groupId) {
        ps.setActiveTab(found.groupId, found.id)
        ps.bringToFront(found.groupId)
      } else {
        ps.bringToFront(found.id)
      }
    })
  }

  // ── Seek / Scrub ─────────────────────────────────────────────

  function seekTo(frame: number): void {
    const clip = activeClip.value
    const clamped = clip ? Math.max(0, Math.min(frame, clip.frameCount)) : Math.max(0, frame)
    currentFrame.value = snapToFrame.value ? Math.round(clamped) : clamped
    _pushFrameToGroup(currentFrame.value)
  }

  function _pushFrameToGroup(frame: number): void {
    const eid = activeEntityId.value
    const cid = activeClipId.value
    if (!eid || !cid) return
    const entity = useSceneStore().activeScene?.world.getEntity(eid)
    const animComp = entity?.getComponent('Animation') as import('@/core/ecs/components/AnimationComponent').AnimationComponent | undefined
    animComp?.goToFrame(cid, frame)
  }

  // ── Preview Playback ─────────────────────────────────────────

  function play(): void {
    if (isPlaying.value) return
    const eid = activeEntityId.value
    const cid = activeClipId.value
    const clip = activeClip.value
    if (!eid || !cid || !clip) return

    const entity = useSceneStore().activeScene?.world.getEntity(eid)
    const animComp = entity?.getComponent('Animation') as import('@/core/ecs/components/AnimationComponent').AnimationComponent | undefined
    const group = animComp?.babylonGroups.get(cid)
    if (!group) return

    isPlaying.value = true
    const loop = clip.loopMode !== 'Constant'
    group.start(loop, previewSpeed.value, currentFrame.value, clip.frameCount, false)

    // Poll current frame via RAF
    const poll = (): void => {
      const animatable = group.animatables[0]
      if (animatable) {
        currentFrame.value = Math.round(animatable.masterFrame ?? 0)
      }
      if (isPlaying.value) {
        _rafId = requestAnimationFrame(poll)
      }
    }
    _rafId = requestAnimationFrame(poll)
  }

  function pause(): void {
    if (!isPlaying.value) return
    isPlaying.value = false
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null }
    const eid = activeEntityId.value
    const cid = activeClipId.value
    if (!eid || !cid) return
    const entity = useSceneStore().activeScene?.world.getEntity(eid)
    const animComp = entity?.getComponent('Animation') as import('@/core/ecs/components/AnimationComponent').AnimationComponent | undefined
    animComp?.pauseClip(cid)
  }

  function stop(): void {
    _stopPreview()
    seekTo(0)
  }

  function _stopPreview(): void {
    if (!isPlaying.value) return
    isPlaying.value = false
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null }
    const eid = activeEntityId.value
    const cid = activeClipId.value
    if (eid && cid) {
      const entity = useSceneStore().activeScene?.world.getEntity(eid)
      const animComp = entity?.getComponent('Animation') as import('@/core/ecs/components/AnimationComponent').AnimationComponent | undefined
      animComp?.stopClip(cid)
    }
  }

  function togglePlay(): void {
    isPlaying.value ? pause() : play()
  }

  // ── Keyframe selection ────────────────────────────────────────

  function selectKeyframe(trackId: string, frame: number, addToSelection = false): void {
    const key = `${trackId}:${frame}`
    if (!addToSelection) selectedKeyframes.value.clear()
    selectedKeyframes.value.add(key)
  }

  function deselectKeyframe(trackId: string, frame: number): void {
    selectedKeyframes.value.delete(`${trackId}:${frame}`)
  }

  function clearKeyframeSelection(): void {
    selectedKeyframes.value.clear()
  }

  function isKeyframeSelected(trackId: string, frame: number): boolean {
    return selectedKeyframes.value.has(`${trackId}:${frame}`)
  }

  // ── Keyframe insertion — samples live Babylon value ───────────

  /**
   * Insert a keyframe at currentFrame for a track, sampling the live value
   * from the Babylon node if possible.
   * Delegates to command system for undo support.
   */
  function insertKeyframeAtCurrentFrame(trackId: string): void {
    const clip = activeClip.value
    const eid  = activeEntityId.value
    if (!clip || !eid) return

    const track = clip.tracks.find(t => t.id === trackId)
    if (!track) return

    // Sample live value from the Babylon node
    const entity = useSceneStore().activeScene?.world.getEntity(eid)
    const animComp = entity?.getComponent('Animation') as import('@/core/ecs/components/AnimationComponent').AnimationComponent | undefined
    const node = animComp?._node

    let sampledValue: number | number[] = defaultKeyframeValue(track.valueType)
    if (node) {
      const raw = _readNodeProperty(node, track.property)
      if (raw !== undefined) sampledValue = _serializePropertyValue(raw, track.valueType)
    }

    const frame = Math.round(currentFrame.value)
    useCommandStore().execute(
      new InsertKeyframeCommand(eid, activeClipId.value!, trackId, frame, sampledValue)
    )
    // Select the new keyframe immediately so the footer editor appears
    selectKeyframe(trackId, frame)
  }

  // ── Zoom / scroll ─────────────────────────────────────────────

  function setZoom(frames: number): void {
    zoomFrames.value = Math.max(10, Math.min(frames, 1000))
  }

  function zoomIn(): void  { setZoom(Math.max(10,  Math.round(zoomFrames.value * 0.75))) }
  function zoomOut(): void { setZoom(Math.min(1000, Math.round(zoomFrames.value * 1.333))) }

  function setScrollOffset(offset: number): void {
    scrollOffset.value = Math.max(0, offset)
  }

  // ── Helpers ───────────────────────────────────────────────────

  function _readNodeProperty(node: unknown, propPath: string): unknown {
    const parts = propPath.split('.')
    let cur: unknown = node
    for (const p of parts) {
      if (cur === null || cur === undefined) return undefined
      cur = (cur as Record<string, unknown>)[p]
    }
    return cur
  }

  function _serializePropertyValue(val: unknown, vt: AnimatableValueType): number | number[] {
    if (typeof val === 'number') return val
    if (val && typeof val === 'object') {
      const v = val as Record<string, number>
      switch (vt) {
        case 'Vector2':    return [v.x ?? 0, v.y ?? 0]
        case 'Vector3':    return [v.x ?? 0, v.y ?? 0, v.z ?? 0]
        case 'Quaternion': return [v.x ?? 0, v.y ?? 0, v.z ?? 0, v.w ?? 1]
        case 'Color3':     return [v.r ?? 1, v.g ?? 1, v.b ?? 1]
        case 'Color4':     return [v.r ?? 1, v.g ?? 1, v.b ?? 1, v.a ?? 1]
      }
    }
    return defaultKeyframeValue(vt)
  }

  return {
    // State
    activeEntityId,
    activeClipId,
    currentFrame,
    isPlaying,
    previewSpeed,
    zoomFrames,
    scrollOffset,
    snapToFrame,
    showTangents,
    selectedKeyframes,
    selectedTrackIds,
    // Derived
    activeClip,
    frameCount,
    // Actions
    editClip,
    seekTo,
    play,
    pause,
    stop,
    togglePlay,
    selectKeyframe,
    deselectKeyframe,
    clearKeyframeSelection,
    isKeyframeSelected,
    insertKeyframeAtCurrentFrame,
    setZoom,
    zoomIn,
    zoomOut,
    setScrollOffset,
  }
})
