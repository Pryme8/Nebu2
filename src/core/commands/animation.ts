// ─────────────────────────────────────────────
// Commands — Animation operations
// ─────────────────────────────────────────────

import type { ICommand }           from '@/types/command'
import type { AnimationClipDef, AnimationTrackDef, KeyframeDef, EasingDef, AnimatableValueType } from '@/types/animation'
import { defaultKeyframeValue }    from '@/types/animation'
import { generateGuid }            from '@/lib/guid'
import { useSceneStore }           from '@/stores/sceneStore'
import type { AnimationComponent } from '@/core/ecs/components/AnimationComponent'

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAnimComp(entityId: string): AnimationComponent | undefined {
  const entity = useSceneStore().activeScene?.world.getEntity(entityId)
  return entity?.getComponent<AnimationComponent>('Animation')
}

function syncAndNotify(comp: AnimationComponent): void {
  comp.syncToBabylon()
  comp.notifyChanged()
}

// ── AddAnimationClip ─────────────────────────────────────────────────────────

export class AddAnimationClipCommand implements ICommand {
  readonly description = 'Add Animation Clip'
  readonly silent      = false
  private _entityId:  string
  private _addedId:   string | null = null
  private _clipName:  string

  constructor(entityId: string, name = 'New Clip') {
    this._entityId = entityId
    this._clipName = name
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    if (!comp) return
    const clip   = comp.createClip(this._clipName)
    this._addedId = clip.id
    syncAndNotify(comp)
  }

  undo(): void {
    if (!this._addedId) return
    const comp = getAnimComp(this._entityId)
    if (!comp) return
    const idx = comp.clips.findIndex(c => c.id === this._addedId)
    if (idx !== -1) comp.clips.splice(idx, 1)
    syncAndNotify(comp)
  }
}

// ── DeleteAnimationClip ──────────────────────────────────────────────────────

export class DeleteAnimationClipCommand implements ICommand {
  readonly description: string
  readonly silent      = false
  private _entityId: string
  private _clipId:   string
  private _snapshot: AnimationClipDef | null = null
  private _idx = -1

  constructor(entityId: string, clipId: string) {
    this._entityId = entityId
    this._clipId   = clipId
    this.description = 'Delete Animation Clip'
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    if (!comp) return
    this._idx = comp.clips.findIndex(c => c.id === this._clipId)
    if (this._idx === -1) return
    this._snapshot = JSON.parse(JSON.stringify(comp.clips[this._idx])) as AnimationClipDef
    comp.clips.splice(this._idx, 1)
    syncAndNotify(comp)
  }

  undo(): void {
    if (!this._snapshot) return
    const comp = getAnimComp(this._entityId)
    if (!comp) return
    comp.clips.splice(Math.min(this._idx, comp.clips.length), 0, this._snapshot)
    syncAndNotify(comp)
  }
}

// ── RenameAnimationClip ──────────────────────────────────────────────────────

export class RenameAnimationClipCommand implements ICommand {
  readonly description = 'Rename Animation Clip'
  readonly silent      = true
  private _entityId: string
  private _clipId:   string
  private _newName:  string
  private _oldName = ''

  constructor(entityId: string, clipId: string, newName: string) {
    this._entityId = entityId
    this._clipId   = clipId
    this._newName  = newName
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return
    this._oldName = clip.name
    clip.name = this._newName
    syncAndNotify(comp!)
  }

  undo(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return
    clip.name = this._oldName
    syncAndNotify(comp!)
  }
}

// ── SetClipProperty ──────────────────────────────────────────────────────────

export class SetClipPropertyCommand implements ICommand {
  readonly description = 'Set Clip Property'
  readonly silent      = true
  private _entityId: string
  private _clipId:   string
  private _key:      keyof AnimationClipDef
  private _newVal:   unknown
  private _oldVal:   unknown

  constructor(entityId: string, clipId: string, key: keyof AnimationClipDef, value: unknown) {
    this._entityId = entityId
    this._clipId   = clipId
    this._key      = key
    this._newVal   = value
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return
    this._oldVal = clip[this._key]
    ;(clip as unknown as Record<string, unknown>)[this._key as string] = this._newVal
    syncAndNotify(comp!)
  }

  undo(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return
    ;(clip as unknown as Record<string, unknown>)[this._key as string] = this._oldVal
    syncAndNotify(comp!)
  }
}

// ── AddAnimationTrack ────────────────────────────────────────────────────────

export class AddAnimationTrackCommand implements ICommand {
  readonly description = 'Add Animation Track'
  readonly silent      = false
  private _entityId:  string
  private _clipId:    string
  private _property:  string
  private _valueType: AnimatableValueType
  private _addedId:   string | null = null

  constructor(entityId: string, clipId: string, property: string, valueType: AnimatableValueType) {
    this._entityId  = entityId
    this._clipId    = clipId
    this._property  = property
    this._valueType = valueType
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return
    const track: AnimationTrackDef = {
      id:        generateGuid(),
      property:  this._property,
      valueType: this._valueType,
      keyframes: [],
      easing:    { type: 'None', mode: 'EaseInOut' },
      muted:     false,
    }
    this._addedId = track.id
    clip.tracks.push(track)
    syncAndNotify(comp!)
  }

  undo(): void {
    if (!this._addedId) return
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return
    const idx = clip.tracks.findIndex(t => t.id === this._addedId)
    if (idx !== -1) clip.tracks.splice(idx, 1)
    syncAndNotify(comp!)
  }
}

// ── RemoveAnimationTrack ─────────────────────────────────────────────────────

export class RemoveAnimationTrackCommand implements ICommand {
  readonly description = 'Remove Animation Track'
  readonly silent      = false
  private _entityId: string
  private _clipId:   string
  private _trackId:  string
  private _snapshot: AnimationTrackDef | null = null
  private _idx = -1

  constructor(entityId: string, clipId: string, trackId: string) {
    this._entityId = entityId
    this._clipId   = clipId
    this._trackId  = trackId
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return
    this._idx = clip.tracks.findIndex(t => t.id === this._trackId)
    if (this._idx === -1) return
    this._snapshot = JSON.parse(JSON.stringify(clip.tracks[this._idx])) as AnimationTrackDef
    clip.tracks.splice(this._idx, 1)
    syncAndNotify(comp!)
  }

  undo(): void {
    if (!this._snapshot) return
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return
    clip.tracks.splice(Math.min(this._idx, clip.tracks.length), 0, this._snapshot)
    syncAndNotify(comp!)
  }
}

// ── InsertKeyframeCommand ────────────────────────────────────────────────────

/**
 * Insert a keyframe at a given frame on a track.
 * If a keyframe already exists at that frame, its value is replaced.
 */
export class InsertKeyframeCommand implements ICommand {
  readonly description = 'Insert Keyframe'
  readonly silent      = true
  private _entityId: string
  private _clipId:   string
  private _trackId:  string
  private _frame:    number
  /** `null` means "use the track value type's default" — resolved in execute(). */
  private _value:    number | number[] | null
  private _prevKf:   KeyframeDef | null = null
  private _wasInsert = false

  constructor(entityId: string, clipId: string, trackId: string, frame: number, value: number | number[] | null) {
    this._entityId = entityId
    this._clipId   = clipId
    this._trackId  = trackId
    this._frame    = frame
    this._value    = value
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    const track = clip?.tracks.find(t => t.id === this._trackId)
    if (!track) return

    // Callers that just want "a key here" pass null rather than inventing a value.
    const value = this._value ?? defaultKeyframeValue(track.valueType)

    const existing = track.keyframes.find(k => k.frame === this._frame)
    if (existing) {
      this._prevKf   = { ...existing }
      this._wasInsert = false
      existing.value = value
    } else {
      this._wasInsert = true
      this._prevKf    = null
      const kf: KeyframeDef = { frame: this._frame, value }
      track.keyframes.push(kf)
      track.keyframes.sort((a, b) => a.frame - b.frame)
    }

    syncAndNotify(comp!)
  }

  undo(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    const track = clip?.tracks.find(t => t.id === this._trackId)
    if (!track) return

    if (this._wasInsert) {
      const idx = track.keyframes.findIndex(k => k.frame === this._frame)
      if (idx !== -1) track.keyframes.splice(idx, 1)
    } else if (this._prevKf) {
      const existing = track.keyframes.find(k => k.frame === this._frame)
      if (existing) existing.value = this._prevKf.value
    }

    syncAndNotify(comp!)
  }
}

// ── DeleteKeyframesCommand ───────────────────────────────────────────────────

export class DeleteKeyframesCommand implements ICommand {
  readonly description = 'Delete Keyframes'
  readonly silent      = false
  private _entityId: string
  private _clipId:   string
  /** Array of { trackId, frame } pairs to delete. */
  private _targets:  Array<{ trackId: string; frame: number }>
  private _snapshots: Array<{ trackId: string; kf: KeyframeDef; idx: number }> = []

  constructor(entityId: string, clipId: string, targets: Array<{ trackId: string; frame: number }>) {
    this._entityId = entityId
    this._clipId   = clipId
    this._targets  = targets
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return
    this._snapshots = []

    for (const { trackId, frame } of this._targets) {
      const track = clip.tracks.find(t => t.id === trackId)
      if (!track) continue
      const idx = track.keyframes.findIndex(k => k.frame === frame)
      const kf  = idx === -1 ? undefined : track.keyframes[idx]
      if (!kf) continue
      this._snapshots.push({ trackId, kf: { ...kf }, idx })
      track.keyframes.splice(idx, 1)
    }

    syncAndNotify(comp!)
  }

  undo(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return

    // Restore in reverse order to preserve original indices
    for (const { trackId, kf, idx } of [...this._snapshots].reverse()) {
      const track = clip.tracks.find(t => t.id === trackId)
      if (!track) continue
      track.keyframes.splice(Math.min(idx, track.keyframes.length), 0, kf)
    }
    // Re-sort
    for (const track of clip.tracks) {
      track.keyframes.sort((a, b) => a.frame - b.frame)
    }

    syncAndNotify(comp!)
  }
}

// ── MoveKeyframesCommand ─────────────────────────────────────────────────────

export class MoveKeyframesCommand implements ICommand {
  readonly description = 'Move Keyframes'
  readonly silent      = true
  private _entityId: string
  private _clipId:   string
  private _targets:  Array<{ trackId: string; frame: number }>
  private _delta:    number

  constructor(
    entityId: string,
    clipId: string,
    targets: Array<{ trackId: string; frame: number }>,
    delta: number,
  ) {
    this._entityId = entityId
    this._clipId   = clipId
    this._targets  = targets
    this._delta    = delta
  }

  execute(): void  { this._shift(this._delta) }
  undo(): void     { this._shift(-this._delta) }

  private _shift(delta: number): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    if (!clip) return

    for (const { trackId, frame } of this._targets) {
      const track = clip.tracks.find(t => t.id === trackId)
      if (!track) continue
      const kf = track.keyframes.find(k => k.frame === frame)
      if (kf) kf.frame = Math.max(0, kf.frame + delta)
    }
    // Re-sort after shift
    for (const track of clip.tracks) {
      track.keyframes.sort((a, b) => a.frame - b.frame)
    }

    syncAndNotify(comp!)
  }
}

// ── SetKeyframeEasingCommand ─────────────────────────────────────────────────

export class SetKeyframeEasingCommand implements ICommand {
  readonly description = 'Set Keyframe Easing'
  readonly silent      = true
  private _entityId: string
  private _clipId:   string
  private _trackId:  string
  private _frame:    number
  private _newEasing: EasingDef
  private _oldEasing: EasingDef | null = null

  constructor(entityId: string, clipId: string, trackId: string, frame: number, easing: EasingDef) {
    this._entityId  = entityId
    this._clipId    = clipId
    this._trackId   = trackId
    this._frame     = frame
    this._newEasing = easing
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    const track = clip?.tracks.find(t => t.id === this._trackId)
    if (!track) return
    const kf = track.keyframes.find(k => k.frame === this._frame)
    if (!kf) return
    this._oldEasing = kf.easing ? { ...kf.easing } : null
    kf.easing = this._newEasing
    syncAndNotify(comp!)
  }

  undo(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    const track = clip?.tracks.find(t => t.id === this._trackId)
    if (!track) return
    const kf = track.keyframes.find(k => k.frame === this._frame)
    if (!kf) return
    if (this._oldEasing) kf.easing = this._oldEasing
    else delete kf.easing
    syncAndNotify(comp!)
  }
}

// ── SetTrackEasingCommand ────────────────────────────────────────────────────

export class SetTrackEasingCommand implements ICommand {
  readonly description = 'Set Track Easing'
  readonly silent      = true
  private _entityId: string
  private _clipId:   string
  private _trackId:  string
  private _newEasing: EasingDef
  private _oldEasing: EasingDef | null = null

  constructor(entityId: string, clipId: string, trackId: string, easing: EasingDef) {
    this._entityId  = entityId
    this._clipId    = clipId
    this._trackId   = trackId
    this._newEasing = easing
  }

  execute(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    const track = clip?.tracks.find(t => t.id === this._trackId)
    if (!track) return
    this._oldEasing = { ...track.easing }
    track.easing = this._newEasing
    syncAndNotify(comp!)
  }

  undo(): void {
    const comp = getAnimComp(this._entityId)
    const clip = comp?.getClip(this._clipId)
    const track = clip?.tracks.find(t => t.id === this._trackId)
    if (!track || !this._oldEasing) return
    track.easing = this._oldEasing
    syncAndNotify(comp!)
  }
}
