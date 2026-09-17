# Babylon.js Animation System — Implementation Plan

## Overview

Add a full property animation system to Nebu2: an ECS `AnimationComponent` that owns Babylon `Animation` / `AnimationGroup` runtime refs, a serializable data model for clips and keyframes, an NLE-style **AnimationPanel** with a timeline scrubber, and an `AnimationSystem` for play-mode orchestration.

**Out of scope (phase 2):** skeleton/bone animations, `.glb` animation decoding, skeleton gizmo rendering.

---

## 1. Type Definitions

**File:** `src/types/animation.ts`

### 1.1 Enums / Constants

```ts
// Maps directly to BABYLON.Animation.ANIMATIONTYPE_*
export type AnimatableValueType =
  | 'Float'
  | 'Vector3'
  | 'Vector2'
  | 'Quaternion'
  | 'Color3'
  | 'Color4'
  | 'Matrix'

// Maps directly to BABYLON.Animation.ANIMATIONLOOPMODE_*
export type AnimationLoopMode =
  | 'Cycle'
  | 'Constant'
  | 'Relative'
  | 'Yoyo'

// Easing function family (Babylon built-ins)
export type EasingType =
  | 'None'
  | 'Linear'
  | 'Circle'
  | 'Back'
  | 'Bounce'
  | 'Cubic'
  | 'Elastic'
  | 'Exponential'
  | 'Power'
  | 'Quadratic'
  | 'Quartic'
  | 'Quintic'
  | 'Sine'
  | 'Bezier'

export type EasingMode = 'EaseIn' | 'EaseOut' | 'EaseInOut'
```

### 1.2 Keyframe

```ts
export interface KeyframeDef {
  /** Frame number (integer, relative to clip FPS). */
  frame: number
  /** Value at this keyframe — shape depends on AnimatableValueType. */
  value: number | number[]
  /** Optional per-keyframe easing override. */
  easing?: {
    type: EasingType
    mode: EasingMode
    /** Bezier control points [x1, y1, x2, y2] — only when type === 'Bezier'. */
    bezier?: [number, number, number, number]
  }
}
```

### 1.3 Animation Track (one property)

```ts
export interface AnimationTrackDef {
  /** Unique ID within the clip. */
  id: string
  /**
   * Dot-path property on the target, e.g. "position.x", "intensity",
   * "diffuse.r", "rotation" (full Quaternion/Vector3).
   */
  property: string
  /** The data type Babylon will interpolate. */
  valueType: AnimatableValueType
  /** Ordered keyframes for this track. */
  keyframes: KeyframeDef[]
  /** Default easing applied to all keyframes that don't override. */
  easing: {
    type: EasingType
    mode: EasingMode
    bezier?: [number, number, number, number]
  }
}
```

### 1.4 Animation Clip (one named animation)

```ts
export interface AnimationClipDef {
  /** Stable GUID for serialization cross-referencing. */
  id: string
  /** Human-readable name shown in the panel, e.g. "Idle Bob". */
  name: string
  /** Frames per second (Babylon `Animation` fps parameter). */
  fps: number
  /** Total frame count (determines clip length). */
  frameCount: number
  /** Loop behavior when played. */
  loopMode: AnimationLoopMode
  /** Property tracks in this clip. */
  tracks: AnimationTrackDef[]
  /** Play speed multiplier (default 1). */
  speedRatio: number
  /** Start playing automatically when scene loads at runtime. */
  autoPlay: boolean
  /** Enable animation blending for smooth transitions. */
  enableBlending: boolean
  /** Blend speed (frames). Only used when enableBlending is true. */
  blendingSpeed: number
}
```

### 1.5 Animation Event

```ts
export interface AnimationEventDef {
  /** Frame at which the event fires. */
  frame: number
  /** Script function name to invoke (matched against ScriptComponent methods). */
  handler: string
}
```

### 1.6 Editor-only Timeline State

```ts
/** Transient state for the animation panel — never serialized. */
export interface AnimationTimelineState {
  /** Currently edited clip ID (null = nothing open). */
  activeClipId: string | null
  /** Current scrubber position in frames. */
  currentFrame: number
  /** Whether the editor preview is playing. */
  isPlaying: boolean
  /** Editor preview speed ratio. */
  previewSpeed: number
  /** Zoom level (frames visible in viewport width). */
  zoomFrames: number
  /** Horizontal scroll offset in frames. */
  scrollOffset: number
  /** Selected keyframe IDs (track.id + frame) for multi-select. */
  selectedKeyframes: Set<string>
  /** Selected track IDs for bulk operations. */
  selectedTrackIds: Set<string>
  /** Snap-to-frame when dragging keyframes. */
  snapToFrame: boolean
  /** Show tangent handles for Bezier easing. */
  showTangents: boolean
}
```

---

## 2. ECS Component — `AnimationComponent`

**File:** `src/core/ecs/components/AnimationComponent.ts`

### 2.1 Responsibilities

| Concern | Owner |
|---|---|
| Serializable clip data (`AnimationClipDef[]`) | Component property |
| Animation event definitions | Component property |
| Live `BABYLON.Animation[]` per track | Component runtime ref |
| Live `BABYLON.AnimationGroup` per clip | Component runtime ref |
| Live `BABYLON.Animatable` (playback handle) | Component runtime ref |
| Scene ref for rebuilds | Stored in `onCreate()` |
| Dispose all Babylon animation objects | `onDispose()` |
| Push data → Babylon | `syncToBabylon()` |

### 2.2 Class Skeleton

```ts
import { Component } from '../Component'
import type {
  AnimationClipDef,
  AnimationEventDef,
} from '@/types/animation'
import type { InspectorSchema } from '@/types/inspector'
import type {
  Animation as BabylonAnimation,
  AnimationGroup,
  Animatable,
  Scene,
  TransformNode,
} from '@babylonjs/core'

export class AnimationComponent extends Component {
  readonly type = 'Animation'

  // ── Serializable data ──────────────────────────────────────
  clips: AnimationClipDef[] = []
  events: AnimationEventDef[] = []

  // ── Babylon runtime refs (owned, never serialized) ─────────
  /** One BJS Animation object per track, keyed by trackId. */
  babylonAnimations = new Map<string, BabylonAnimation>()
  /** One AnimationGroup per clip, keyed by clipId. */
  babylonGroups = new Map<string, AnimationGroup>()
  /** Active playback handles, keyed by clipId. */
  babylonAnimatables = new Map<string, Animatable>()

  // ── Private scene ref (Rule 15) ────────────────────────────
  private _scene: Scene | null = null
  private _node: TransformNode | null = null

  // ── Lifecycle (Rules 11-15) ────────────────────────────────
  override onCreate(scene: unknown, _world: unknown): void {
    this._scene = scene as Scene
  }

  override syncToBabylon(): void {
    // Rebuild all BJS Animation objects from clip data
    // Rebuild AnimationGroups
    // Re-attach to target node
  }

  override onDispose(): void {
    // Stop all animatables
    // Dispose all groups
    // Dispose all animations
    // Clear maps
  }

  override onRemove(): void {
    this.onDispose()
  }

  // ── Serialization ──────────────────────────────────────────
  override serialize(): Record<string, unknown> {
    return {
      clips: this.clips,
      events: this.events,
    }
  }

  static deserialize(data: Record<string, unknown>): AnimationComponent {
    const c = new AnimationComponent()
    if (Array.isArray(data.clips)) c.clips = data.clips as AnimationClipDef[]
    if (Array.isArray(data.events)) c.events = data.events as AnimationEventDef[]
    return c
  }

  // ── Inspector UI ───────────────────────────────────────────
  override onInspectorDraw(): InspectorSchema {
    // Show list of clips with name, fps, frameCount, loopMode, autoPlay
    // "Edit in Timeline" button opens the AnimationPanel
    // "Add Clip" button
  }
}
```

### 2.3 Registration

Add to `src/core/ecs/componentRegistry.ts`:

```ts
import { AnimationComponent } from './components/AnimationComponent'

// In the defaultComponentRegistry map:
['Animation', d => AnimationComponent.deserialize(d)]
```

### 2.4 Key `syncToBabylon()` Logic

```
for each clip in this.clips:
  1. Stop + dispose existing AnimationGroup for this clipId (if any)
  2. Create a new AnimationGroup(clip.name, scene)
  3. For each track in clip.tracks:
     a. Create new BABYLON.Animation(name, track.property, clip.fps, toAnimationType(track.valueType), toLoopMode(clip.loopMode))
     b. Set keyframes from track.keyframes → Animation.setKeys()
     c. Set easing function from track.easing → Animation.setEasingFunction()
     d. group.addTargetedAnimation(animation, this._node)
     e. Store in babylonAnimations map
  4. group.normalize(0, clip.frameCount)
  5. group.speedRatio = clip.speedRatio
  6. Store in babylonGroups map
```

### 2.5 Target Node Resolution

The component needs the entity's `TransformNode` to target animations. Two approaches:

- **Option A (preferred):** `sceneStore` passes the node when wiring the component (same pattern as lights/cameras). Store as `this._node`.
- **Option B:** Query the `TransformComponent.babylonNode` on the same entity from within `syncToBabylon()`.

Recommend **Option A** — sceneStore assigns `animComp._node = transformNode` during the animation wiring pass.

---

## 3. sceneStore Integration

### 3.1 Wiring Pass

In `_wireBabylonForScene()`, add a **Pass 5 — Animations** after parent-child links:

```
Pass 5: Animations
  for each entity with AnimationComponent:
    const node = TransformComponent.babylonNode
    animComp._node = node
    animComp.onCreate(babylonScene, world)
    animComp.syncToBabylon()
    if (isPlayMode && clip.autoPlay) animComp.playClip(clipId)
```

### 3.2 `addComponentToEntity` Handling

When an `AnimationComponent` is added to a live entity:

```ts
case 'Animation': {
  const node = entity.getComponent<TransformComponent>('Transform')?.babylonNode
  if (node) component._node = node
  component.onCreate(babylonScene.value, world)
  component.syncToBabylon()
  break
}
```

### 3.3 Disposal

Already handled by `AnimationComponent.onDispose()` — sceneStore calls `component.onDispose()` on entity destruction (existing pattern).

---

## 4. AnimationSystem (Runtime Play Mode)

**File:** `src/core/ecs/systems/AnimationSystem.ts`

An ECS `System` that manages animation playback during play mode. Follows Rule 14: coordinates order, doesn't own objects.

```ts
import { System } from '../System'
import type { AnimationComponent } from '../components/AnimationComponent'

export class AnimationSystem extends System {
  override onStart(): void {
    // Query all entities with AnimationComponent
    // For each clip with autoPlay = true, call component.playClip(clipId)
  }

  override onUpdate(_dt: number): void {
    // Optional: handle animation events
    // Check each active animatable's current frame against event defs
    // Fire script callbacks via ScriptComponent integration
  }

  override onShutdown(): void {
    // Stop all active animations via component.stopAll()
  }
}
```

This system is registered in `sceneStore` (not a plugin) since animations are a core feature:

```ts
world.addSystem(new AnimationSystem())
```

---

## 5. Animation Store (Editor State)

**File:** `src/stores/animationStore.ts`

Manages the transient editor-side animation state (timeline, scrubber, preview playback). Not serialized.

```ts
export const useAnimationStore = defineStore('animation', () => {
  // ── State ──────────────────────────────────────────────────
  const activeEntityId = ref<string | null>(null)
  const activeClipId   = ref<string | null>(null)
  const currentFrame   = ref(0)
  const isPlaying      = ref(false)
  const previewSpeed   = ref(1)
  const zoomFrames     = ref(100)     // frames visible in panel width
  const scrollOffset   = ref(0)       // horizontal scroll in frames
  const snapToFrame    = ref(true)
  const showTangents   = ref(false)
  const selectedKeyframes = ref(new Set<string>())
  const selectedTrackIds  = ref(new Set<string>())

  // ── Derived ────────────────────────────────────────────────
  const activeClip = computed(() => { /* resolve from entity's AnimationComponent */ })
  const frameToPx  = computed(() => { /* panel width / zoomFrames */ })

  // ── Actions ────────────────────────────────────────────────

  /** Open a clip for editing — called from inspector "Edit in Timeline" */
  function editClip(entityId: string, clipId: string): void

  /** Scrub to a specific frame (clamp to clip range). */
  function seekTo(frame: number): void

  /** Start editor preview playback. */
  function play(): void

  /** Pause preview. */
  function pause(): void

  /** Stop preview and reset to frame 0. */
  function stop(): void

  // ── Keyframe CRUD ──────────────────────────────────────────

  /** Add a keyframe at currentFrame for the given track, sampling current value. */
  function addKeyframe(trackId: string): void

  /** Delete selected keyframes. */
  function deleteSelectedKeyframes(): void

  /** Move selected keyframes by deltaFrames. */
  function moveKeyframes(deltaFrames: number): void

  // ── Track CRUD ─────────────────────────────────────────────

  /** Add a new property track to the active clip. */
  function addTrack(property: string, valueType: AnimatableValueType): void

  /** Remove a track from the active clip. */
  function removeTrack(trackId: string): void

  // ── Clip CRUD ──────────────────────────────────────────────

  /** Create a new empty clip on the active entity. */
  function createClip(name: string): void

  /** Duplicate an existing clip. */
  function duplicateClip(clipId: string): void

  /** Delete a clip. */
  function deleteClip(clipId: string): void

  /** Rename a clip. */
  function renameClip(clipId: string, name: string): void

  return { /* all state + actions */ }
})
```

### 5.1 Editor Preview Playback

The store drives preview by calling into the `AnimationComponent`'s Babylon groups:

```ts
function play(): void {
  const group = component.babylonGroups.get(activeClipId.value)
  if (!group) return
  group.start(false, previewSpeed.value, currentFrame.value)
  // Register per-frame observer to sync currentFrame from group.animatables[0].masterFrame
  isPlaying.value = true
}

function seekTo(frame: number): void {
  currentFrame.value = clamp(frame, 0, clip.frameCount)
  // group.goToFrame(frame) for visual preview without playing
  const group = component.babylonGroups.get(activeClipId.value)
  group?.goToFrame(frame)
}
```

---

## 6. Animation Panel (NLE Timeline Editor)

**File:** `src/components/editor/AnimationPanel.vue`

### 6.1 Panel Registration

In `App.vue`:
```ts
import AnimationPanel from '@/components/editor/AnimationPanel.vue'

const componentRegistry = {
  // ...existing...
  AnimationPanel,
}

// Add to bottom panel group (alongside Console)
panelStore.addPanel({
  title: 'Animation',
  component: 'AnimationPanel',
  icon: 'play',           // add to BaseIcon svgMap
  closable: true,
  state: 'floating',
  requiresScene: true,
  rect: { x: 0.15, y: 0.75, width: 0.7, height: 0.25 },
  minSize: { width: 400, height: 150 },
})
```

### 6.2 Panel Layout (Top → Bottom)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ TOOLBAR ROW                                                             │
│ [Clip ▼ dropdown] [+ New Clip] │ [◀◀] [▶ Play] [■ Stop] [⏩]          │
│ Speed: [1.0x ▼]  Frame: [___]  │ [🔒 Snap] [Loop ▼] [⚙ Settings]     │
├────────────┬────────────────────────────────────────────────────────────┤
│ TRACK LIST │ TIMELINE RULER (frame numbers, major/minor ticks)         │
│            │ ▼ scrubber head (draggable red line)                      │
├────────────┼────────────────────────────────────────────────────────────┤
│ ▸ position │ ◆·····◆···············◆·····◆                             │
│   .x       │    ◆·········◆                                           │
│   .y       │ ◆·····················◆                                   │
│   .z       │ ◆···◆·····◆···◆                                          │
├────────────┼────────────────────────────────────────────────────────────┤
│ ▸ rotation │ ◆···············◆                                        │
│   .x       │ ◆···········◆                                            │
│   .y       │ ◆·····◆                                                  │
├────────────┼────────────────────────────────────────────────────────────┤
│ ▸ intensity│ ◆·················◆····◆                                  │
├────────────┼────────────────────────────────────────────────────────────┤
│ [+ Add Property Track]                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Sub-components

Break the panel into focused child components following Rule 1:

| Component | File | Responsibility |
|---|---|---|
| `AnimationPanel.vue` | `editor/` | Top-level layout, clip selector, toolbar |
| `AnimationToolbar.vue` | `editor/` | Playback controls, speed, frame input, settings |
| `AnimationTimeline.vue` | `editor/` | Ruler + scrubber + tracks container (scrollable) |
| `AnimationTrackRow.vue` | `editor/` | Single track: label + keyframe diamonds |
| `AnimationTrackGroup.vue` | `editor/` | Collapsible group header for multi-component properties (position → x/y/z) |
| `AnimationKeyframe.vue` | `editor/` | Single keyframe diamond (drag, select, context menu) |
| `AnimationRuler.vue` | `editor/` | Frame number ruler with major/minor tick marks |
| `AnimationScrubber.vue` | `editor/` | Draggable red playhead line spanning all tracks |
| `AnimationCurveEditor.vue` | `editor/` | (Phase 1.5) Curve view for easing visualization |

### 6.4 Interaction Model

| Gesture | Action |
|---|---|
| Click empty timeline area | Seek scrubber to that frame |
| Drag scrubber head | Scrub through animation (live preview) |
| Click keyframe diamond | Select keyframe (shows value in mini-inspector) |
| Ctrl+Click keyframe | Toggle add/remove from multi-selection |
| Drag selected keyframes | Retime (move along timeline) |
| Double-click keyframe | Open value editor popup |
| Right-click keyframe | Context menu: Delete, Set Easing, Copy, Paste |
| Right-click track label | Context menu: Remove Track, Mute |
| `I` key (or toolbar button) | Insert keyframe at current frame, sampling live value |
| Delete key | Delete selected keyframes |
| Mouse wheel on timeline | Zoom in/out (adjust `zoomFrames`) |
| Middle-drag on timeline | Pan horizontally |
| Ctrl+Z / Ctrl+Y | Undo / redo (via commandStore) |

### 6.5 Scrubber / Frame Preview

When the scrubber moves (drag or click), `animationStore.seekTo(frame)` calls `AnimationGroup.goToFrame(frame)` on the active clip's Babylon group. This provides **instant visual feedback** in the viewport without playing.

During `play()`, a per-frame observer reads back the current frame from the Animatable and updates `animationStore.currentFrame` so the scrubber tracks playback.

### 6.6 Value Sampling for Keyframe Insertion

When the user presses "Add Keyframe" on a track:
1. Read the current value of the track's property from the target Babylon node
2. Create a `KeyframeDef` at `currentFrame` with that value
3. Insert into `track.keyframes` (sorted by frame)
4. Call `syncToBabylon()` to rebuild the Babylon Animation

---

## 7. "Add Property" Track Picker

When the user clicks **[+ Add Property Track]**, show a searchable list of animatable properties:

### 7.1 Common Animatable Properties

| Category | Properties | ValueType |
|---|---|---|
| Transform | `position`, `position.x/y/z`, `rotation`, `rotation.x/y/z`, `scaling`, `scaling.x/y/z` | Vector3 / Float |
| Transform (Quat) | `rotationQuaternion` | Quaternion |
| Light | `intensity`, `diffuse`, `specular`, `direction` | Float / Color3 / Vector3 |
| Camera | `fov`, `minZ`, `maxZ` | Float |
| Material | `alpha`, `diffuseColor`, `emissiveColor` | Float / Color3 |
| Mesh | `visibility` | Float |

### 7.2 Dynamic Discovery

For an entity's additional component types (Script with exposed float props, material properties), the track picker can enumerate animatable properties at runtime by inspecting the target node and its material.

---

## 8. Command Integration (Undo/Redo)

All keyframe and track mutations go through `commandStore` so they are undoable:

### 8.1 New Command Types

**File:** `src/core/commands/animation.ts`

| Command | Do | Undo |
|---|---|---|
| `AddAnimationClip` | Push new clip to component | Splice clip from array |
| `DeleteAnimationClip` | Splice clip | Re-insert at original index |
| `RenameAnimationClip` | Set new name | Restore old name |
| `AddAnimationTrack` | Push track to clip | Splice track |
| `RemoveAnimationTrack` | Splice track | Re-insert track |
| `AddKeyframe` | Insert keyframe into track | Remove keyframe |
| `DeleteKeyframes` | Remove keyframes | Re-insert them |
| `MoveKeyframes` | Offset frame numbers | Reverse offset |
| `SetKeyframeValue` | Set value at frame | Restore previous value |
| `SetKeyframeEasing` | Set easing on keyframe | Restore previous easing |
| `SetClipProperty` | Change fps/loopMode/speed/etc | Restore previous value |

All commands call `animComp.syncToBabylon()` + `animComp.notifyChanged()` in both do and undo.

---

## 9. Serialization

### 9.1 Component Serialization

`AnimationComponent.serialize()` outputs:

```json
{
  "clips": [
    {
      "id": "guid-1",
      "name": "Idle Bob",
      "fps": 30,
      "frameCount": 60,
      "loopMode": "Cycle",
      "speedRatio": 1,
      "autoPlay": true,
      "enableBlending": false,
      "blendingSpeed": 0.01,
      "tracks": [
        {
          "id": "track-1",
          "property": "position.y",
          "valueType": "Float",
          "keyframes": [
            { "frame": 0,  "value": 0 },
            { "frame": 30, "value": 1.5 },
            { "frame": 60, "value": 0 }
          ],
          "easing": { "type": "Sine", "mode": "EaseInOut" }
        }
      ]
    }
  ],
  "events": [
    { "frame": 30, "handler": "onApex" }
  ]
}
```

### 9.2 World Serialization

No changes needed — `World.serialize()` already iterates `entity.components` and calls `component.serialize()`. `AnimationComponent` is just another component.

### 9.3 Deserialization

`AnimationComponent.deserialize(data)` reconstructs the component from the JSON data. The component registry factory handles this:

```ts
['Animation', d => AnimationComponent.deserialize(d)]
```

---

## 10. Inspector Integration

### 10.1 AnimationComponent Inspector Schema

The inspector for `AnimationComponent` shows a **summary view** (not the full timeline — that's in the panel):

```ts
onInspectorDraw(): InspectorSchema {
  return [
    {
      title: 'Animation',
      fields: [
        // Per-clip summary rows (read-only in inspector, edit in panel)
        // Each clip: Name | Frames | FPS | Loop | AutoPlay toggle
      ]
    }
  ]
}
```

### 10.2 Custom Inspector Rendering

Because the clip list needs non-standard UI (list of clips with "Edit" buttons), we need a new inspector field type:

```ts
// In types/inspector.ts
export interface AnimationClipListField extends BasePropField {
  type: 'animation-clip-list'
}
```

`ComponentInspector.vue` renders this as a list of clip rows, each with:
- Clip name (editable)
- `[Edit ▸]` button → opens AnimationPanel + sets `animationStore.editClip(entityId, clipId)`
- `[✕]` button → delete clip (via command)
- `[+ Add Clip]` button at the bottom

---

## 11. BaseIcon Additions

Add new SVG icons to `BaseIcon.vue` svgMap:

| Icon Key | Usage |
|---|---|
| `play` | Play button, panel tab icon |
| `pause` | Pause button |
| `stop` | Stop button |
| `skipBack` | Jump to frame 0 |
| `skipForward` | Jump to last frame |
| `keyframe` | Diamond shape for keyframe indicator |
| `addKeyframe` | Diamond + plus for insert keyframe |
| `curve` | Bezier curve icon for easing |

---

## 12. Implementation Phases

### Phase 1 — Foundation (Core)
1. Create `src/types/animation.ts` — all type definitions
2. Create `AnimationComponent.ts` — full ECS component with serialize/deserialize
3. Register in `componentRegistry.ts`
4. Add sceneStore wiring (Pass 5 for animations)
5. Add `AnimationComponent` to the "Add Component" menu in InspectorPanel

### Phase 2 — Animation Store + Basic Panel
6. Create `src/stores/animationStore.ts`
7. Create `AnimationPanel.vue` (shell with toolbar)
8. Register panel in `App.vue` componentRegistry
9. Create `AnimationToolbar.vue` — clip selector dropdown, playback buttons, frame input
10. Wire toolbar actions to animationStore

### Phase 3 — Timeline Implementation
11. Create `AnimationRuler.vue` — frame tick marks with zoom support
12. Create `AnimationScrubber.vue` — draggable red playhead
13. Create `AnimationTrackRow.vue` — keyframe diamonds per track
14. Create `AnimationTrackGroup.vue` — collapsible property groups
15. Create `AnimationTimeline.vue` — scrollable container for ruler + tracks
16. Wire scrubber drag → `animationStore.seekTo()` → `AnimationGroup.goToFrame()`

### Phase 4 — Keyframe Editing
17. Create `AnimationKeyframe.vue` — selectable, draggable diamond
18. Implement keyframe insertion (sample current value)
19. Implement keyframe deletion, multi-select, drag-to-retime
20. Create `src/core/commands/animation.ts` — all undo/redo commands
21. Wire Ctrl+Z / Ctrl+Y through commandStore

### Phase 5 — Property Track Management
22. "Add Property Track" picker with common properties
23. Remove track context menu
24. Dynamic property discovery from entity components

### Phase 6 — Easing & Curves
25. Easing function selector per keyframe / per track
26. Create `AnimationCurveEditor.vue` — visual curve graph (optional alternate view)
27. Bezier handle editing for custom curves

### Phase 7 — Runtime System
28. Create `AnimationSystem.ts` — ECS System for play mode
29. AutoPlay handling on scene load
30. Animation event firing → ScriptComponent callback dispatch
31. Play/pause/stop API exposed to user scripts via `nebuScriptTypes`

### Phase 8 — Inspector Polish
32. New `animation-clip-list` inspector field type
33. "Edit in Timeline" button wiring
34. Clip property editing (fps, loop mode, speed) from inspector

### Phase 9 — Animation Blending & Groups (Advanced)
35. Animation weight/blending support in the component
36. Multi-clip blending UI in the panel
37. Animation state machine concept (future: Animator Controller)

---

## 13. File Summary

| File | Type | Description |
|---|---|---|
| `src/types/animation.ts` | Types | All animation type definitions |
| `src/core/ecs/components/AnimationComponent.ts` | ECS Component | Owns BJS Animation/Group refs |
| `src/core/ecs/systems/AnimationSystem.ts` | ECS System | Runtime play orchestration |
| `src/core/commands/animation.ts` | Commands | Undo/redo for all animation edits |
| `src/stores/animationStore.ts` | Pinia Store | Editor timeline state |
| `src/components/editor/AnimationPanel.vue` | Panel | Top-level NLE layout |
| `src/components/editor/AnimationToolbar.vue` | Component | Playback controls + clip selector |
| `src/components/editor/AnimationTimeline.vue` | Component | Scrollable track + ruler container |
| `src/components/editor/AnimationRuler.vue` | Component | Frame number tick ruler |
| `src/components/editor/AnimationScrubber.vue` | Component | Draggable red playhead |
| `src/components/editor/AnimationTrackRow.vue` | Component | One track's keyframe lane |
| `src/components/editor/AnimationTrackGroup.vue` | Component | Collapsible group (position → x/y/z) |
| `src/components/editor/AnimationKeyframe.vue` | Component | Selectable/draggable diamond |
| `src/components/editor/AnimationCurveEditor.vue` | Component | Easing curve visualization |

---

## 14. Babylon.js API Mapping

| Nebu Concept | Babylon.js API |
|---|---|
| `AnimationClipDef` | `new Animation(name, property, fps, type, loopMode)` |
| `AnimationTrackDef` | One `Animation` object per track |
| `KeyframeDef[]` | `animation.setKeys([{ frame, value }])` |
| `AnimationClipDef` (group) | `new AnimationGroup(name, scene)` |
| Track → group | `group.addTargetedAnimation(animation, targetNode)` |
| Editor scrub | `group.goToFrame(frame)` |
| Play | `group.start(loop, speedRatio, from, to)` / `group.play(loop)` |
| Pause | `group.pause()` |
| Stop | `group.stop(); group.goToFrame(0)` |
| Speed | `group.speedRatio = n` |
| Easing | `animation.setEasingFunction(new SineEase())` etc. |
| Blending | `group.enableBlending = true; group.blendingSpeed = n` |
| Events | `animation.addEvent(new AnimationEvent(frame, () => {}))` |

---

## 15. Design Decisions & Rationale

### Why AnimationGroups instead of raw `scene.beginAnimation`?

AnimationGroups give us:
- `goToFrame()` for scrubbing without playing
- `normalize()` to align multi-track timelines
- `speedRatio` at the group level
- `pause()` / `play()` toggle
- Proper cleanup via `dispose()`

### Why one component per entity (not a global animation manager)?

Follows ECS Rule 11: the component owns its Babylon refs. Each entity's animations are self-contained, serialized with the entity, and disposed with the entity. No global state to go stale.

### Why a separate animationStore instead of putting timeline state on the component?

Timeline state (scrubber position, zoom, selected keyframes) is editor-only and transient. It doesn't belong on the serializable ECS component. The store also coordinates between the panel UI and the inspector.

### Why not use Babylon's Animation Curve Editor (ACE)?

ACE is tightly coupled to the Babylon Inspector. We need an editor-native panel that integrates with our panel system, undo/redo stack, ECS model, and theming. We will follow ACE's UX patterns where they make sense.
