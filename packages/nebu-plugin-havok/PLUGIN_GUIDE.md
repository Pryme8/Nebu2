# Nebu2 Plugin Development Guide

This guide explains how to create a fully integrated plugin for the Nebu2 editor.
The `@nebu/plugin-havok` package in this repository is the canonical reference
implementation — read its source alongside this guide.

---

## What is a Plugin?

A plugin is a TypeScript module that exports a `NebuPlugin` descriptor object.
It can contribute:

- **ECS Components** — new data attached to entities, with full Inspector UI
- **ECS Systems**    — per-frame logic that reads/writes components
- **Babylon setup**  — async initialisation code (e.g. loading a wasm module)

The plugin contract is defined in `src/types/plugin.ts`.

---

## The `NebuPlugin` Interface

```ts
export interface NebuPlugin {
  readonly id:          string              // 'com.mycompany.my-plugin'
  readonly displayName: string
  readonly description: string
  readonly version:     string              // SemVer
  readonly builtin:     boolean             // true = ships in monorepo
  readonly components:  PluginComponentDef[]
  onActivate?(ctx: PluginContext):   Promise<void>
  onDeactivate?(ctx: PluginContext): void
}
```

**`id`** — Use a reverse-DNS style string that is unique across all plugins.
This is persisted in the `.nebu` project manifest.

**`builtin`** — Set `true` for plugins inside this monorepo.  Set `false` for
npm-published external plugins; the Project Settings dialog shows an
`npm install` hint for those.

---

## Creating a Component

All components extend the abstract `Component` base class from
`@/core/ecs/Component`.

```ts
import { Component }           from '@/core/ecs/Component'
import type { InspectorSchema } from '@/types/inspector'

export class MyComponent extends Component {
  // ── 1. Unique type string (must match PluginComponentDef.type) ──────────
  readonly type = 'MyComponent'

  // ── 2. Data properties ──────────────────────────────────────────────────
  speed:  number  = 1.0
  active: boolean = true

  // ── 3. Inspector UI (declarative schema) ────────────────────────────────
  override onInspectorDraw(): InspectorSchema {
    return [
      {
        title: 'Settings',
        fields: [
          { key: 'speed',  label: 'Speed',  type: 'number', min: 0, step: 0.1 },
          { key: 'active', label: 'Active', type: 'boolean' },
        ],
      },
    ]
  }

  // ── 4. Serialisation ─────────────────────────────────────────────────────
  override serialize(): Record<string, unknown> {
    return { speed: this.speed, active: this.active }
  }

  static deserialize(data: Record<string, unknown>): MyComponent {
    const c = new MyComponent()
    if (typeof data.speed  === 'number')  c.speed  = data.speed
    if (typeof data.active === 'boolean') c.active = data.active
    return c
  }

  // ── 5. Babylon sync (optional) ───────────────────────────────────────────
  // Called by ComponentInspector after every inspector edit.
  override syncToBabylon(): void {
    // Push data to any live Babylon objects owned by this component
  }
}
```

### Inspector Field Types

| `type`        | Widget rendered              | Extra options                                |
|---------------|------------------------------|----------------------------------------------|
| `'number'`    | Numeric scrub input          | `min`, `max`, `step`                         |
| `'boolean'`   | Checkbox                     | —                                            |
| `'string'`    | Text input                   | —                                            |
| `'vec3'`      | Three numeric inputs (x/y/z) | `step`                                       |
| `'color3'`    | Color swatch + RGB inputs    | —                                            |
| `'color4'`    | Color swatch + RGBA inputs   | —                                            |
| `'enum'`      | Select dropdown              | `options: { label, value }[]`                |
| `'entity-ref'`| Entity drag-drop target      | —                                            |
| `'material-ref'`| Material picker            | —                                            |
| `'texture-ref'` | Texture thumbnail drop     | —                                            |

---

## Creating a System

Systems extend the abstract `System` base class from `@/core/ecs/System`.

```ts
import { System }    from '@/core/ecs/System'
import type { Scene } from '@babylonjs/core'

export class MySystem extends System {
  private readonly _scene: Scene

  constructor(scene: Scene) {
    super()
    this._scene = scene
  }

  override onStart(): void {
    // Called once when the system is added to the world.
    // Query initial entities:
    const targets = this.world.query('MyComponent')
  }

  override onUpdate(dt: number): void {
    // Called every frame.  dt = elapsed seconds.
    const targets = this.world.query('MyComponent')
    for (const entity of targets) {
      const comp = entity.getComponent<MyComponent>('MyComponent')!
      // ... update logic
    }
  }

  override onShutdown(): void {
    // Called when the plugin is deactivated.
    // Dispose all Babylon objects created by this system.
  }
}
```

### `world.query(...types)`

Returns all entities that have **every** listed component type.

```ts
// All entities with both a Collider and a RigidBody
const physics = this.world.query('Collider', 'RigidBody')
```

---

## The `PluginContext`

`onActivate` and `onDeactivate` both receive a `PluginContext`:

```ts
interface PluginContext {
  scene:  BABYLON.Scene   // live Babylon scene
  engine: BABYLON.Engine  // live engine
  world:  World           // ECS world for the active Nebu scene
}
```

Use `ctx.world.addSystem(mySystem)` to register your system.
Use `ctx.scene.enablePhysics(...)` or any Babylon API for scene-level setup.

---

## Registering Component Deserializers

Your plugin's `components` array must include a `deserialize` factory for
each type.  This is merged into `defaultComponentRegistry` by `pluginStore`
on activation, which allows `World.deserialize` to reconstruct your components
when a saved scene is loaded.

```ts
export const myPlugin: NebuPlugin = {
  id: 'com.example.my-plugin',
  // ...
  components: [
    {
      type:        'MyComponent',
      label:       'My Component',          // shown in Add Component menu
      factory:     () => new MyComponent(), // fresh default instance
      deserialize: (d) => MyComponent.deserialize(d),
    },
  ],
}
```

---

## Async Activation

`onActivate` is `async`.  Use it for:
- Loading wasm binaries (e.g. `await HavokPhysics()`)
- Fetching remote resources
- Any async initialisation

```ts
async onActivate(ctx) {
  const wasmInstance = await MyWasm()         // async wasm load
  const mySystem     = new MySystem(ctx.scene, wasmInstance)
  ctx.world.addSystem(mySystem)
  mySystem.onStart()
},
```

---

## Plugin Lifecycle Summary

```
App boot
  └─ pluginStore.registerPlugin(myPlugin)   // no side effects

User opens project (or enables plugin in settings)
  └─ pluginStore.activatePlugin(id, ctx)
       ├─ merge component types into defaultComponentRegistry
       └─ call plugin.onActivate(ctx)

User disables plugin / closes project
  └─ pluginStore.deactivatePlugin(id, ctx)
       ├─ call plugin.onDeactivate(ctx)
       └─ remove component types from defaultComponentRegistry
```

---

## Package Structure

Built-in plugins live in `packages/` at the monorepo root:

```
packages/
  my-plugin/
    package.json          { "name": "@nebu/my-plugin", "main": "src/index.ts" }
    src/
      index.ts            export const myPlugin: NebuPlugin = { ... }
      components/
        MyComponent.ts
      systems/
        MySystem.ts
```

Add a path alias in both `vite.config.ts` and `tsconfig.app.json`:

```ts
// vite.config.ts
alias: {
  '@nebu/my-plugin': resolve(__dirname, 'packages/my-plugin/src'),
}

// tsconfig.app.json
"paths": {
  "@nebu/my-plugin": ["packages/my-plugin/src/index.ts"]
}
```

Then register in `App.vue`:

```ts
import { myPlugin } from '@nebu/my-plugin'
pluginStore.registerPlugin(myPlugin)
```

---

## Publishing an External Plugin

An external plugin is an npm package that:

1. Has peer dependencies `@babylonjs/core` and optionally peer deps for any
   Nebu core types it uses.
2. Exports a named `NebuPlugin` export (no default exports — see project rules).
3. Compiles itself to ESM so Vite can tree-shake it.

Users install external plugins with `npm install my-nebu-plugin` and then
enable them in Project Settings → Plugins by typing the package id.

> Note: Type definitions for `NebuPlugin`, `Component`, `System`, and
> `PluginContext` will be published as `@nebu/core` once the project reaches
> stable release.  For now, external plugin authors can vendor-copy the
> relevant type files.

---

## Reference: `@nebu/plugin-havok`

| File | Purpose |
|---|---|
| `src/index.ts` | Plugin descriptor, `onActivate`, `onDeactivate` |
| `src/components/PhysicsWorldComponent.ts` | Scene-wide physics config |
| `src/components/ColliderComponent.ts` | Collision shape |
| `src/components/RigidBodyComponent.ts` | Rigid-body simulation |
| `src/systems/HavokPhysicsSystem.ts` | Bridge between ECS data and Babylon Havok |
