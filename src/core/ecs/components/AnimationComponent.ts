// ─────────────────────────────────────────────
// ECS — AnimationComponent
// ─────────────────────────────────────────────

import { Component } from '../Component'
import type { InspectorSchema } from '@/types/inspector'
import type {
  AnimationClipDef,
  AnimationEventDef,
  AnimatableValueType,
  EasingDef,
} from '@/types/animation'
import { generateGuid } from '@/lib/guid'
import {
  Animation as BabylonAnimation,
  AnimationGroup,
  CircleEase, BackEase, BounceEase, CubicEase, ElasticEase, ExponentialEase,
  PowerEase, QuadraticEase, QuarticEase, QuinticEase, SineEase, BezierCurveEase,
  EasingFunction,
  type IEasingFunction,
  type Scene,
  type TransformNode,
} from '@babylonjs/core'

// ── Babylon constant helpers ──────────────────────────────────────────────────

function toBabylonAnimationType(vt: AnimatableValueType): number {
  switch (vt) {
    case 'Float':      return BabylonAnimation.ANIMATIONTYPE_FLOAT
    case 'Vector3':    return BabylonAnimation.ANIMATIONTYPE_VECTOR3
    case 'Quaternion': return BabylonAnimation.ANIMATIONTYPE_QUATERNION
    case 'Matrix':     return BabylonAnimation.ANIMATIONTYPE_MATRIX
    case 'Color3':     return BabylonAnimation.ANIMATIONTYPE_COLOR3
    case 'Vector2':    return BabylonAnimation.ANIMATIONTYPE_VECTOR2
    case 'Color4':     return BabylonAnimation.ANIMATIONTYPE_COLOR4
  }
}

function toBabylonLoopMode(lm: AnimationClipDef['loopMode']): number {
  switch (lm) {
    case 'Cycle':    return BabylonAnimation.ANIMATIONLOOPMODE_CYCLE
    case 'Constant': return BabylonAnimation.ANIMATIONLOOPMODE_CONSTANT
    case 'Relative': return BabylonAnimation.ANIMATIONLOOPMODE_RELATIVE
    case 'Yoyo':     return BabylonAnimation.ANIMATIONLOOPMODE_YOYO
  }
}

function makeEasingFunction(easing: EasingDef): IEasingFunction | null {
  if (easing.type === 'None') return null

  let fn: IEasingFunction | null = null
  switch (easing.type) {
    case 'Circle':      fn = new CircleEase();      break
    case 'Back':        fn = new BackEase();         break
    case 'Bounce':      fn = new BounceEase();       break
    case 'Cubic':       fn = new CubicEase();        break
    case 'Elastic':     fn = new ElasticEase();      break
    case 'Exponential': fn = new ExponentialEase();  break
    case 'Power':       fn = new PowerEase();        break
    case 'Quadratic':   fn = new QuadraticEase();    break
    case 'Quartic':     fn = new QuarticEase();      break
    case 'Quintic':     fn = new QuinticEase();      break
    case 'Sine':        fn = new SineEase();         break
    case 'Bezier':
      if (easing.bezier) fn = new BezierCurveEase(...easing.bezier)
      break
    default: return null
  }
  if (!fn) return null

  const modeMap = {
    EaseIn:    EasingFunction.EASINGMODE_EASEIN,
    EaseOut:   EasingFunction.EASINGMODE_EASEOUT,
    EaseInOut: EasingFunction.EASINGMODE_EASEINOUT,
  } as const
  const efn = fn as EasingFunction
  efn.setEasingMode(modeMap[easing.mode])
  return fn
}

// ── AnimationComponent ────────────────────────────────────────────────────────

/**
 * AnimationComponent — ECS component that owns Babylon.js animations for an entity.
 *
 * Each clip maps to a BABYLON.AnimationGroup.  Each track within a clip maps to
 * a BABYLON.Animation.  All Babylon runtime refs live here (Rules 11–13).
 *
 * The target node is supplied by sceneStore during wiring via `_node`.
 * syncToBabylon() rebuilds all AnimationGroups from the serializable clip data.
 * onDispose() stops and disposes everything owned by this component.
 */
export class AnimationComponent extends Component {
  readonly type = 'Animation'

  // ── Serializable data ──────────────────────────────────────
  clips:  AnimationClipDef[]  = []
  events: AnimationEventDef[] = []

  // ── Babylon runtime refs (owned, never serialized) ─────────
  /** One AnimationGroup per clip, keyed by clip.id */
  babylonGroups = new Map<string, AnimationGroup>()

  // ── Private context (Rule 15) ──────────────────────────────
  private _scene: Scene | null = null
  /** Set by sceneStore during wiring — the entity's TransformNode. */
  _node: TransformNode | null = null

  // ── Lifecycle ──────────────────────────────────────────────

  override onCreate(scene: unknown, _world: unknown): void {
    this._scene = scene as Scene
    this.syncToBabylon()
  }

  override syncToBabylon(): void {
    const scene = this._scene
    const node  = this._node
    if (!scene || !node) return

    const existingIds = new Set(this.babylonGroups.keys())

    for (const clip of this.clips) {
      existingIds.delete(clip.id)

      // Rebuild the group for this clip
      const old = this.babylonGroups.get(clip.id)
      if (old) { old.stop(); old.dispose(false) }

      if (clip.tracks.length === 0) {
        this.babylonGroups.delete(clip.id)
        continue
      }

      const group = new AnimationGroup(clip.name, scene)
      group.speedRatio     = clip.speedRatio
      group.enableBlending = clip.enableBlending
      group.blendingSpeed  = clip.blendingSpeed

      for (const track of clip.tracks) {
        if (track.muted) continue
        // A track with no keyframes yet (freshly added from the timeline's
        // "Add Track" menu) has nothing to drive.  Babylon's
        // AnimationGroup.normalize() dereferences keys[0] unconditionally, so
        // handing it a key-less Animation throws and aborts the whole sync.
        if (track.keyframes.length === 0) continue

        const anim = new BabylonAnimation(
          `${clip.id}__${track.id}`,
          track.property,
          clip.fps,
          toBabylonAnimationType(track.valueType),
          toBabylonLoopMode(clip.loopMode),
        )

        const sortedKfs = [...track.keyframes].sort((a, b) => a.frame - b.frame)
        anim.setKeys(sortedKfs.map(kf => ({ frame: kf.frame, value: kf.value })))

        const eFn = makeEasingFunction(track.easing)
        if (eFn) anim.setEasingFunction(eFn)

        group.addTargetedAnimation(anim, node)
      }

      // Every track was muted or still empty — keep no group for this clip.
      if (group.targetedAnimations.length === 0) {
        group.dispose(false)
        this.babylonGroups.delete(clip.id)
        continue
      }

      group.normalize(0, clip.frameCount)
      this.babylonGroups.set(clip.id, group)
    }

    // Dispose groups for clips that were removed
    for (const removedId of existingIds) {
      const g = this.babylonGroups.get(removedId)
      if (g) { g.stop(); g.dispose(false) }
      this.babylonGroups.delete(removedId)
    }
  }

  override onDispose(): void {
    for (const group of this.babylonGroups.values()) {
      group.stop()
      group.dispose(false)
    }
    this.babylonGroups.clear()
    this._scene = null
    this._node  = null
  }

  override onRemove(): void {
    this.onDispose()
  }

  // ── Playback helpers ───────────────────────────────────────

  playClip(clipId: string, loop?: boolean): void {
    const clip  = this.clips.find(c => c.id === clipId)
    const group = this.babylonGroups.get(clipId)
    if (!group || !clip) return
    const shouldLoop = loop ?? (clip.loopMode !== 'Constant')
    group.start(shouldLoop, clip.speedRatio, 0, clip.frameCount, false)
  }

  pauseClip(clipId: string): void {
    this.babylonGroups.get(clipId)?.pause()
  }

  stopClip(clipId: string): void {
    const group = this.babylonGroups.get(clipId)
    if (!group) return
    group.stop()
    group.goToFrame(0)
  }

  stopAll(): void {
    for (const group of this.babylonGroups.values()) group.stop()
  }

  goToFrame(clipId: string, frame: number): void {
    this.babylonGroups.get(clipId)?.goToFrame(frame)
  }

  // ── Clip management helpers ────────────────────────────────

  createClip(name = 'New Clip'): AnimationClipDef {
    const clip: AnimationClipDef = {
      id:             generateGuid(),
      name,
      fps:            30,
      frameCount:     60,
      loopMode:       'Cycle',
      tracks:         [],
      speedRatio:     1,
      autoPlay:       false,
      enableBlending: false,
      blendingSpeed:  0.01,
    }
    this.clips.push(clip)
    return clip
  }

  getClip(clipId: string): AnimationClipDef | undefined {
    return this.clips.find(c => c.id === clipId)
  }

  // ── Serialization ──────────────────────────────────────────

  override serialize(): Record<string, unknown> {
    return { clips: this.clips, events: this.events }
  }

  static deserialize(data: Record<string, unknown>): AnimationComponent {
    const c = new AnimationComponent()
    if (Array.isArray(data.clips))  c.clips  = data.clips  as AnimationClipDef[]
    if (Array.isArray(data.events)) c.events = data.events as AnimationEventDef[]
    return c
  }

  // ── Inspector ──────────────────────────────────────────────

  override onInspectorDraw(): InspectorSchema {
    return [
      {
        title: 'Animation',
        fields: [
          // Custom renderer — ComponentInspector handles 'animation-clip-list'
          { key: 'clips', label: 'Clips', type: 'animation-clip-list' as const },
        ],
      },
    ]
  }
}
