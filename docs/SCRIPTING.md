# Nebu2 — Scripting

Nebu2 scripts are TypeScript classes that extend `NebuScript`. They live as `.ts` files in your
project's `scripts/` folder, are compiled in the browser, and attach to entities through a
**Script** component slot.

---

## A first script

```ts
import { Vector3 } from '@babylonjs/core'

export default class Rotator extends NebuScript {
  static readonly exposedProps = [
    { key: 'speed',  type: 'number',     label: 'Speed',  default: 1, min: 0, step: 0.1 },
    { key: 'axis',   type: 'vec3',       label: 'Axis',   default: { x: 0, y: 1, z: 0 } },
    { key: 'target', type: 'entity-ref', label: 'Look At', default: null },
  ]

  speed!: number
  axis!:  { x: number; y: number; z: number }

  onStart(): void {
    console.log(`${this.entity.name} is ready`)
  }

  onUpdate(dt: number): void {
    this.transform.rotation.y += this.speed * dt
  }
}
```

Three things to note:

- **No import for `NebuScript`.** It is injected into module scope by the compiler.
- **`export default`** is required — the engine validates that the default export subclasses
  `NebuScript`.
- **`import { … } from '@babylonjs/core'` works.** The compiler rewrites it to a global lookup, and
  Monaco has the real Babylon `.d.ts` files loaded so you get full IntelliSense.

Attach it: select an entity → **Add Component → Script** → assign the file. The `exposedProps`
render as editable inspector fields.

---

## Lifecycle

`NebuScript` splits its hooks into editor-time and runtime. Every hook has an empty default, so you
only override what you need.

### Editor-time

These run in the editor **even when Play is not active** — useful for procedural helpers and
previews.

| Hook | When |
|---|---|
| `onEditorAwake()` | Once, when the script is first compiled or reloaded in the editor |
| `onEditorUpdate(dt)` | Every editor frame |
| `onEditorDestroy()` | When the component is removed or the scene closes |

### Runtime (play mode only)

| Hook | When |
|---|---|
| `onAwake()` | Immediately when Play starts, before the first frame. **All** scripts get `onAwake` before any gets `onStart` |
| `onStart()` | On the first frame, after every script has had `onAwake` — use when your setup depends on another script being ready |
| `onEnable()` | Whenever the entity or component becomes active |
| `onDisable()` | Whenever it becomes inactive |
| `onUpdate(dt)` | Every rendered frame; `dt` in seconds |
| `onLateUpdate(dt)` | After **all** scripts have had `onUpdate` this frame |
| `onFixedUpdate(dt)` | On the physics fixed timestep — only fires when the scene has an active physics engine |
| `onDestroy()` | Immediately before the entity is destroyed — clean up subscriptions and timers here |

### Only what you override costs anything

At class-load time the engine compares every prototype method against `NebuScript.prototype` and
records a `ScriptHookFlags` set. A hook you didn't override is flagged `false` and the corresponding
Babylon observable is **never registered**. An empty `onUpdate` costs nothing because it is never
wired up.

---

## Injected members

Set by `ScriptRuntimeSystem` before any lifecycle call:

| Member | Type | What it is |
|---|---|---|
| `this.entity` | `Entity` | The entity this script instance is attached to |
| `this.world` | `World` | The ECS world of the active scene |
| `this.scene` | `Scene` | The live Babylon.js scene |

## Helpers

```ts
// The entity's TransformComponent
this.transform

// Any component on this entity, by type string
this.getComponent<MeshComponent>('Mesh')

// First entity in the world with this name
this.findEntity('Player')

// All entities carrying a tag
this.findEntitiesWithTag('enemy')

// Resolve an 'entity-ref' prop (stored as an id) to the live Entity, or null
this.resolveRef('target')
```

---

## Exposed properties

`static readonly exposedProps` declares serializable, inspector-visible fields. Each entry is a
`PropField` plus a `default` applied when the component is first attached.

```ts
static readonly exposedProps = [
  { key: 'speed',    type: 'number',       label: 'Speed', default: 5, min: 0, max: 20, step: 0.5 },
  { key: 'enabled',  type: 'boolean',      label: 'Enabled',  default: true },
  { key: 'title',    type: 'string',       label: 'Title',    default: '' },
  { key: 'offset',   type: 'vec3',         label: 'Offset',   default: { x: 0, y: 0, z: 0 } },
  { key: 'tint',     type: 'color3',       label: 'Tint',     default: { r: 1, g: 1, b: 1 } },
  { key: 'mode',     type: 'enum',         label: 'Mode',     default: 'idle',
    options: [{ label: 'Idle', value: 'idle' }, { label: 'Chase', value: 'chase' }] },
  { key: 'target',   type: 'entity-ref',   label: 'Target',   default: null },
  { key: 'material', type: 'material-ref', label: 'Material', default: null },
  { key: 'texture',  type: 'texture-ref',  label: 'Texture',  default: null },
]
```

Values set in the Inspector are stored per-slot in the `.scene` file as `propValues`, keyed by
`key`. Editing `exposedProps` and saving reconciles existing components — values for keys that still
exist are kept, new keys take their default.

`entity-ref` props store an entity **id**; use `this.resolveRef('key')` to get the live entity, which
returns `null` when the reference is unset or the target has been deleted.

---

## Execution order

Each Script component slot carries an `executionOrder`:

- **Higher numbers run first.**
- When it is `0` (the default), the entity's `sortOrder` decides.

This applies within each hook phase — every script's `onUpdate` runs in order before any
`onLateUpdate` runs.

---

## The compile pipeline

`core/scripting/ScriptEngine.ts` turns a `.ts` file into a live class:

1. **Sucrase** strips TypeScript syntax (browser-native, no `tsc`).
2. **Import rewriting** converts known bare specifiers into global lookups, because Blob-URL ES
   modules have no module resolver:

   ```ts
   import { Vector3, Color3 } from '@babylonjs/core'
   // becomes
   const { Vector3, Color3 } = globalThis.__NEBU_BABYLON__
   ```

3. **Banner injection** binds `NebuScript` from `globalThis.__NEBU_SCRIPT__`.
4. **Blob-URL dynamic import** — a real `import()`, not `eval`, so full class syntax works.
5. **Validation** that the default export subclasses `NebuScript`.
6. **Hook detection** produces the `ScriptHookFlags` described above.

The compiled class is registered in `scriptStore` as a `ScriptClassEntry` (`cls`, `name`, `hooks`,
`relPath`).

**Errors** are forwarded to the browser console, the editor Console panel, and a toast. The
affected component is marked disabled and badged ⚠ in the Inspector.

**Hot reload** — `lib/fs/ScriptWatcher.ts` polls script files and recompiles on change.

---

## Editor support

The Monaco editor is fed three sources of type information:

1. **Babylon declarations.** The `bundlePackageTypes` Vite plugin collects every `.d.ts` from
   `@babylonjs/core` and `@babylonjs/havok` into a virtual module that Monaco's TypeScript service
   consumes, so Babylon imports resolve properly.
2. **Nebu globals.** `lib/nebuScriptTypes.ts` declares `NebuScript`, `Entity`, `World`, `Component`
   and the built-in component classes as ambient types.
3. **Plugin types.** Each active plugin's `ambientTypes` string is registered as an additional global
   lib — this is how `RigidBodyComponent` and friends get IntelliSense without an import when the
   Havok plugin is on.

Open scripts from the Files panel, either in the docked Script Editor panel or a fullscreen dialog.

---

## Exported builds

`ExportBuilder` runs scripts through the **same** Sucrase pipeline and the same import rewriting, so
what runs in the editor is what ships. In self-contained mode the transpiled JS is embedded as a
string in the manifest; in file-based mode it is written to `scripts/*.js` and fetched at runtime.

> The export dialog flags that materials and scripts are applied at runtime in "V2" — verify an
> exported bundle before relying on it.
