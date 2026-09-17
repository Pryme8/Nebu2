# Nebu2 — Architecture

How the editor is put together, and the rules that keep it consistent.

**Contents**

- [Layer cake](#layer-cake)
- [ECS core](#ecs-core)
- [Component ownership rules](#component-ownership-rules)
- [The Inspector is schema-driven](#the-inspector-is-schema-driven)
- [Viewport widgets](#viewport-widgets)
- [Pinia stores](#pinia-stores)
- [Command pattern](#command-pattern)
- [Panel system](#panel-system)
- [Layer stack](#layer-stack)
- [Scripting pipeline](#scripting-pipeline)
- [Plugin system](#plugin-system)
- [Project file format](#project-file-format)
- [Serialization](#serialization)
- [Build configuration](#build-configuration)

---

## Layer cake

```
┌──────────────────────────────────────────────────────┐
│  Vue components   panels, inspector, dialogs         │  presentation only
├──────────────────────────────────────────────────────┤
│  Pinia stores     scene, project, asset, command, …  │  application state
├──────────────────────────────────────────────────────┤
│  Commands         undoable ICommand objects          │  every mutation
├──────────────────────────────────────────────────────┤
│  ECS core         World / Entity / Component / System│  scene model
├──────────────────────────────────────────────────────┤
│  Babylon.js       Scene, meshes, lights, cameras     │  rendering
└──────────────────────────────────────────────────────┘
```

Components hold no business logic. Stores own state. Commands own mutations. ECS components own
their Babylon objects.

---

## ECS core

`src/core/ecs/`

**`Entity`** — an id, a name, `parentId`, `tags`, `active`, `sortOrder`, a `persistent` flag, and a
typed `Map<string, Component>`. Hierarchy is stored as a parent id on the child, not as a nested tree.

**`Component`** — abstract base with a unique `type` string. It provides:

| Member | Role |
|---|---|
| `serialize()` | Plain-object snapshot for JSON |
| `onInspectorDraw()` | Declarative `InspectorSchema` for the Inspector |
| `onWidgetDraw()` | Declarative `WidgetSchema` for editor-only viewport helpers |
| `onCreate(scene, world)` | Receives the live Babylon scene — store it here if you need it later |
| `syncToBabylon()` | The single place data is pushed to Babylon objects |
| `onRemove()` / `onDispose()` | Cleanup and cascade |
| `onChange(fn)` / `notifyChanged()` | Change subscription for reactive UI |
| `persistent` | `false` for runtime-only components |
| `showWidget` | Per-component widget visibility |

**`System`** — `onStart` / `onUpdate(dt)` / `onShutdown`, with `world` injected by `World.addSystem()`.

**`World`** — owns entities and systems. Every entity created through `World.createEntity()`
automatically gets four components: `Name`, `Tag`, `Active`, `Transform`. It provides a
`query(...types)` helper, lifecycle fan-out, and `serialize()` / `deserialize()`.

Deserialization takes a **factory lookup function** rather than a fixed map, which is what lets
plugin components and the dynamic `Script:${guid}` component types round-trip without any
per-type wiring in `World`:

```ts
world.deserialize(data, getComponentFactory)
```

Built-in components: `Transform`, `Name`, `Tag`, `Active`, `Mesh`, `Light`, `Camera`, `Animation`,
`Script`, `PrefabInstance`.

---

## Component ownership rules

These are enforced across the codebase (see [`.github/copilot-instructions.md`](../.github/copilot-instructions.md))
because violating them has been a recurring source of bugs.

1. **Components own their Babylon refs.** A live `PhysicsBody`, `Light`, `Camera`, `ShadowGenerator`
   etc. lives as a typed property on the component — never hidden in a system's private map.

   ```ts
   // ✅
   class RigidBodyComponent extends Component {
     physicsBody: PhysicsBody | null = null
   }

   // ❌
   class HavokPhysicsSystem extends System {
     private _containers = new Map<string, { body: PhysicsBody }>()
   }
   ```

2. **`syncToBabylon()` is the single sync point.** No store or system reads component properties and
   pushes them to Babylon independently. Structural rebuilds are triggered from inside
   `syncToBabylon()` using the scene ref stored in `onCreate()`.

3. **`onDispose()` is the single cleanup point.** A component disposes what it owns. Systems must not
   dispose Babylon objects belonging to another component.

4. **Systems coordinate order, not ownership.** A system may sequence initialisation and create an
   object, but the moment it hands that object to a component it loses ownership and keeps only
   unsubscribe callbacks.

5. **Get the scene in `onCreate()`**, not through a callback installed by a store — installing an
   `onRebuildNeeded` hook to work around a missing scene ref moves component behaviour into an
   external system and breaks rule 1.

---

## The Inspector is schema-driven

A component describes its UI; it does not build it.

```ts
override onInspectorDraw(): InspectorSchema {
  return [{
    label: 'Light',
    fields: [
      { key: 'lightType', label: 'Type', type: 'enum', options: [
        { label: 'Hemispheric', value: 'Hemispheric' },
        { label: 'Directional', value: 'Directional' },
      ]},
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, step: 0.1 },
      { key: 'diffuse',   label: 'Diffuse',   type: 'color3' },
    ],
  }]
}
```

`ComponentInspector.vue` renders the widgets and calls `syncToBabylon()` after each edit. Field
types live in `types/inspector.ts`: `number`, `boolean`, `string`, `vec3`, `color3`, `color4`,
`enum`, `entity-ref`, `material-ref`, `texture-ref`, `model-ref`, `animation-clip-list`.

Adding a property to a component is a one-line schema change — no Vue code.

---

## Viewport widgets

`onWidgetDraw()` returns a `WidgetSchema` — a declarative set of line segments — which
`core/scene/ViewportWidgets.ts` renders as a Babylon `LineSystem`. Widgets are editor-only and are
hidden in play mode. `lib/widgetShapes.ts` provides shape builders (circles, cones, frustums).

This is how light ranges, spot cones and camera frustums are visualised without any component
touching the renderer directly.

---

## Pinia stores

One store per domain, all using the setup syntax with named exports.

| Store | Responsibility |
|---|---|
| `sceneStore` | Active scene, the ECS `World`, entity/component CRUD, Babylon node mapping |
| `projectStore` | Project folder handle, `.nebu` manifest, scene/script/material/prefab files |
| `assetStore` | Imported asset registry, model/texture import, `.meta` sidecars |
| `materialStore` | Material assets and their live Babylon materials |
| `textureStore` | Texture assets and thumbnails |
| `scriptStore` | Compiled script class registry and exposed-prop reconciliation |
| `animationStore` | Timeline state — active clip, playhead, zoom, snapping |
| `commandStore` | Undo/redo stack |
| `panelStore` | Panel rects, groups, z-order, viewport bounds |
| `editorStore` | Selection, active tool, gizmo space, snapping, dialog visibility, prefs |
| `layerStore` | `LayerStack` ownership and session save/restore |
| `pluginStore` | Plugin registration and per-project activation |
| `exportStore` | Export configuration and build invocation |
| `notificationStore` | Toast queue |
| `statusStore` | Status-bar text |

`sceneStore` (~1.8k lines) and `projectStore` (~1.1k lines) are the two heavyweights.

---

## Command pattern

Every reversible mutation is an `ICommand` with `execute()`, `undo()`, a `description`, and optional
`silent`, `mergeKey` and `tryMerge`.

```ts
commandStore.execute(new CreateEntityCommand('Crate', parentId))
```

`commandStore.execute()` runs the command, pushes it on the undo stack, clears redo, and raises a
toast unless `silent`. Consecutive commands sharing a `mergeKey` are coalesced through `tryMerge` —
this is what turns a continuous numeric scrub or gizmo drag into a single undo step.

Command families live in `core/commands/`: `entity.ts`, `component.ts`, `animation.ts`.

The stack is cleared on scene change so commands can never hold stale component references.

---

## Panel system

`panelStore` is the single source of truth for panel geometry; components never mutate rects directly.

- Rects are **normalized** to the editor viewport (`0–1`), so layouts survive window resizes.
- `PanelManager` renders from a **component registry** — a `Record<string, Component>` passed from
  `App.vue`. Panels reference their component by a string key, never by importing each other.
- `PanelWindow` is a single floating window; `PanelGroup` is a tab group; `PanelResizeHandles`
  provides the eight drag handles.
- Pointer logic lives in composables: `useDraggable`, `useResizable`. No inline `mousemove`
  listeners in components.

Adding a panel:

1. Create `src/components/editor/MyPanel.vue`
2. Register it in `componentRegistry` in `App.vue`
3. `panelStore.addPanel({ component: 'MyPanel', … })`

---

## Layer stack

`core/layers/` implements an ordered stack of `ILayer` objects — a pattern borrowed from engine
architectures like Hazel.

- `pushLayer` appends to the top and calls `onAttach`; `popLayer` calls `onDetach`.
- `onUpdate` runs **top → bottom**.
- `dispatchEvent` propagates **top → bottom** and stops as soon as a layer calls `event.consume()`.
- Layers opting in with `persistent = true` get `serializeState()` / `deserializeState()` called by
  `SessionSerializer`.

`EditorLayer` captures DOM input; `RenderLayer` is pushed by `BabylonViewport` once the engine exists.
`layerStore` owns the stack and is initialised early in `App.vue` so input capture starts before the
viewport mounts.

---

## Scripting pipeline

`core/scripting/ScriptEngine.ts` compiles a `.ts` file into a live class:

1. **Strip types** with [Sucrase](https://github.com/alangpierce/sucrase) — pure JS, runs in the browser.
2. **Rewrite bare imports.** Blob-URL ES modules have no resolver, so
   `import { Vector3 } from '@babylonjs/core'` becomes a `globalThis.__NEBU_BABYLON__` destructure.
3. **Prepend a banner** binding `NebuScript` from `globalThis.__NEBU_SCRIPT__`, so user code can
   `extend NebuScript` with no import.
4. **Import via Blob URL** — real dynamic `import()`, not `eval`, so class syntax and decorators work.
5. **Validate** the default export is a `NebuScript` subclass.
6. **Compute `ScriptHookFlags`** by comparing each prototype method against `NebuScript.prototype`.

Step 6 is the performance trick: a hook the user did not override is flagged `false`, and
`ScriptRuntimeSystem` never registers the corresponding Babylon observable. Scripts pay only for the
lifecycle hooks they actually implement.

Compile errors go to both the Console panel and a toast, and the offending `ScriptComponent` is
marked disabled with a ⚠ badge.

`ScriptEditorSystem` drives editor-time hooks; `ScriptRuntimeSystem` drives play-mode hooks.
`ScriptWatcher` polls files on disk for hot reload.

See [SCRIPTING.md](SCRIPTING.md).

---

## Plugin system

`types/plugin.ts` defines the contract:

```ts
interface NebuPlugin {
  readonly id: string             // 'com.nebu.physics-havok'
  readonly displayName: string
  readonly description: string
  readonly version: string
  readonly builtin: boolean
  readonly components: PluginComponentDef[]
  readonly ambientTypes?: string  // injected into Monaco
  onActivate?(ctx: PluginContext): Promise<void>
  onDeactivate?(ctx: PluginContext): void
  onWorldChanged?(oldWorld: World, newWorld: World): void
}
```

Lifecycle:

- **register** — at app boot in `App.vue`; no side effects, just makes the plugin visible in
  Project Settings.
- **activate** — per project. `onActivate` is awaited (so it can load WASM), systems are added, and
  component types are merged into the ECS registry.
- **deactivate** — `onDeactivate` disposes what it created; registry entries are removed.
- **world change** — `onWorldChanged` moves systems when the active scene is swapped.

The active set is persisted in `.nebu` as `activePlugins`.

---

## Project file format

A Nebu2 project is an ordinary folder:

```
MyProject/
  .nebu                 ← JSON manifest (NebuProjectMeta)
  scenes/
    Main Scene.scene
    Main Scene.scene.meta
  assets/
    models/knight.glb
    models/knight.glb.meta
    models/materials/textures/diffuse.png
  scripts/
    Rotator.ts
    Rotator.ts.meta
  materials/
    Brick.mat
  prefabs/
    Enemy.prefab
```

`.nebu` (`NebuProjectMeta`) holds `version`, `name`, `description`, `author`, `created`,
`lastModified`, `lastSceneId`, `engineTargets` and `activePlugins`. Its presence is what makes a
folder a project — `Open Project…` rejects folders without it.

Every tracked file gets a `.meta` sidecar carrying a **stable GUID**, its kind, the data file's
relative path, a timestamp, and optionally a base-64 thumbnail. GUIDs are what references point at,
so files can be renamed or moved without breaking scenes.

All file access goes through `lib/fs/FileSystemService.ts`, a thin wrapper over the File System
Access API with `readJson` / `writeJson` / `readText` / `writeText` / `readBinary` / `writeBinary` /
`listDir` / `ensureDir` / `deleteFile`, all taking paths relative to the project root handle.

---

## Serialization

| Serializer | Scope |
|---|---|
| `World.serialize()` | Entities and components → `.scene` file |
| `PrefabSerializer` | An entity subtree → `.prefab` file |
| `SessionSerializer` | Editor prefs + panel layout → `localStorage` |

Entities with `persistent = false` (editor grids, gizmo proxies, preview objects) and components
with `persistent = false` are skipped, so editor scaffolding never leaks into saved scenes.

Sessions carry a `SESSION_VERSION`; a mismatch discards the saved session rather than restoring
something incompatible.

---

## Build configuration

[`vite.config.ts`](../vite.config.ts) carries three non-obvious pieces:

**`bundlePackageTypes`** — walks `@babylonjs/core` and `@babylonjs/havok` in `node_modules`, collects
every `.d.ts` plus a minimal `package.json` stub, and exposes them as the virtual module
`virtual:package-types`. Monaco's TypeScript service loads this so user scripts get real IntelliSense
for bare-specifier Babylon imports. It's routed into the lazy `monaco` chunk.

**`havokWasm`** — serves `HavokPhysics.wasm` with `application/wasm` in dev middleware and emits it
into `dist/` at build time.

**`optimizeDeps.exclude`** — `@babylonjs/core`, `@babylonjs/havok` and `monaco-editor` are excluded
from pre-bundling:

- Babylon lazily imports shader modules (e.g. `depthBoxBlur.fragment`) the first time a feature like
  a shadow generator activates. Pre-bundling turns those into chunks that weren't in the initial
  scan, producing "Outdated Optimize Dep" 504s at runtime.
- Havok and Monaco both use module-level `import.meta.url` to locate their WASM and worker files,
  which esbuild's pre-bundler rewrites incorrectly.

Path aliases: `@` → `src/`, `@nebu/plugin-havok` → `packages/nebu-plugin-havok/src`.
