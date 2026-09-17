import { describe, it, expect } from 'vitest'
import { defaultKeyframeValue } from '@/types/animation'
import { AnimationComponent } from '@/core/ecs/components/AnimationComponent'
import type { AnimationClipDef, AnimationTrackDef } from '@/types/animation'

function makeTrack(over: Partial<AnimationTrackDef> = {}): AnimationTrackDef {
  return {
    id:        'track-1',
    property:  'position.y',
    valueType: 'Float',
    keyframes: [],
    easing:    { type: 'None', mode: 'EaseInOut' },
    muted:     false,
    ...over,
  }
}

function makeClip(over: Partial<AnimationClipDef> = {}): AnimationClipDef {
  return {
    id:             'clip-1',
    name:           'New Clip',
    fps:            60,
    frameCount:     60,
    loopMode:       'Cycle',
    speedRatio:     1,
    enableBlending: false,
    blendingSpeed:  0.01,
    tracks:         [],
    ...over,
  }
}

describe('defaultKeyframeValue', () => {
  it('matches the arity of each animatable type', () => {
    expect(defaultKeyframeValue('Float')).toBe(0)
    expect(defaultKeyframeValue('Vector2')).toEqual([0, 0])
    expect(defaultKeyframeValue('Vector3')).toEqual([0, 0, 0])
    expect(defaultKeyframeValue('Color3')).toEqual([1, 1, 1])
    expect(defaultKeyframeValue('Color4')).toEqual([1, 1, 1, 1])
    expect(defaultKeyframeValue('Quaternion')).toEqual([0, 0, 0, 1])
    expect(defaultKeyframeValue('Matrix')).toHaveLength(16)
  })

  it('returns an identity matrix for Matrix', () => {
    expect(defaultKeyframeValue('Matrix')).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ])
  })
})

describe('AnimationComponent.syncToBabylon', () => {
  // Regression guard: a freshly added track has no keyframes, and Babylon's
  // AnimationGroup.normalize() dereferences keys[0] unconditionally. Passing it
  // a key-less Animation threw and aborted the sync, so the new track never
  // reached the timeline.
  it('does not throw for a clip whose tracks are all empty', () => {
    const c = new AnimationComponent()
    c.clips = [makeClip({ tracks: [makeTrack()] })]
    expect(() => c.syncToBabylon()).not.toThrow()
  })

  it('is a no-op before the scene and node are wired', () => {
    const c = new AnimationComponent()
    c.clips = [makeClip({ tracks: [makeTrack()] })]
    c.syncToBabylon()
    expect(c.babylonGroups.size).toBe(0)
  })

  it('serializes clips and restores them', () => {
    const c = new AnimationComponent()
    c.clips = [makeClip({
      tracks: [makeTrack({ keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 5 }] })],
    })]

    const restored = AnimationComponent.deserialize(c.serialize())
    expect(restored.clips).toHaveLength(1)
    expect(restored.clips[0]!.name).toBe('New Clip')
    expect(restored.clips[0]!.tracks[0]!.keyframes).toEqual([
      { frame: 0, value: 0 },
      { frame: 30, value: 5 },
    ])
  })

  it('reports clips through getClip', () => {
    const c = new AnimationComponent()
    c.clips = [makeClip()]
    expect(c.getClip('clip-1')?.name).toBe('New Clip')
    expect(c.getClip('missing')).toBeUndefined()
  })
})
