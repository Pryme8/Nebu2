---
applyTo: "**"
---

# Nebu2 — Design Rules & Copilot Instructions

## Stack

- **Framework:** Vue 3 Composition API + `<script setup>` (no Options API)
- **Build:** Vite 7 + `@tailwindcss/vite` plugin (Tailwind v4)
- **Styling:** Tailwind utility classes only — no scoped `<style>` blocks unless animations are needed
- **State:** Pinia stores (one per domain: `panelStore`, `editorStore`)
- **Types:** TypeScript strict mode — all public APIs must be typed
- **3D:** Babylon.js 8 (`@babylonjs/core`) — imported by name, tree-shaken

## Directory Layout

```
src/
  components/
    base/        ← Atoms: BaseButton, BaseIcon, BaseInput, BaseNumericInput, BaseSection
    panels/      ← Panel system: PanelWindow, PanelGroup, PanelManager, PanelResizeHandles
    editor/      ← Editor panels: HierarchyPanel, InspectorPanel, AssetsPanel, ConsolePanel
                   + BabylonViewport, EditorToolbar
  composables/   ← useDraggable, useResizable (behaviour-only, no rendering)
  stores/        ← panelStore, editorStore (Pinia)
  types/         ← panel.ts, editor.ts (interfaces/types only — no logic)
```

## Component Rules

### 1. One component per file, one responsibility

Each component does exactly ONE thing. Decompose freely.

### 2. Base atoms are NEVER duplicated

Before adding a new component, check `src/components/base/`.

- Need a button? → `BaseButton` (variant + size props)
- Need an icon? → `BaseIcon` (add SVG to the svgMap inside the component)
- Need text input? → `BaseInput`
- Need numeric scrub field? → `BaseNumericInput`
- Need a collapsible section? → `BaseSection`

### 3. Styling — CSS variables over arbitrary values

All theme colours come from CSS variables defined in `src/style.css`.
Use them in Tailwind as: `bg-[var(--color-bg-surface)]`, `text-[var(--color-accent)]`, etc.
**Never** hardcode hex values in components.

### 4. Panel registration — registry pattern only

To add a new editor panel:

1. Create `src/components/editor/MyPanel.vue`
2. Import it in `App.vue` and add it to `componentRegistry`
3. Call `panelStore.addPanel({ component: 'MyPanel', ... })`
   Never import panel components directly from other panels.

### 5. Store mutations are the single source of truth

Components **never** mutate panel rects or sizes directly.
All geometry changes go through `panelStore` actions.

### 6. Composables own all pointer event logic

Drag logic → `useDraggable`
Resize logic → `useResizable`
Do not inline `mousemove` / `mouseup` listeners in components.

### 7. No default exports from stores or composables

Always use named exports so tree-shaking and IDE navigation work properly.

### 8. TypeScript — prefer `interface` over `type` for object shapes

Use `type` for unions, aliases, and mapped types.

### 9. Babylon.js usage

- Import specific symbols: `import { Engine, Scene } from '@babylonjs/core'`
- The scene/engine live in `BabylonViewport.vue` and are exposed via `defineExpose`
- Never create global Babylon singletons; pass scene refs via props or a dedicated store

### 10. No magic strings — use typed enums/constants

Panel component keys, tool names, etc. must be typed (see `types/editor.ts`).

## ECS Component Architecture Rules

These rules govern the relationship between ECS components and their Babylon.js runtime objects.
Violations of these rules are a recurring bug source — enforce them strictly.

### 11. Components own their Babylon runtime refs — ALWAYS

Any live Babylon object created for an ECS component (`PhysicsBody`, `Light`, `Camera`,
`TransformNode`, `PhysicsShape`, `ShadowGenerator`, etc.) **must** live as a typed property
directly on that component.

```ts
// ✅ CORRECT — ref lives on the component
class RigidBodyComponent extends Component {
  physicsBody: PhysicsBody | null = null
}

// ❌ WRONG — ref hidden in a system's private map
class HavokPhysicsSystem extends System {
  private _containers = new Map<string, { body: PhysicsBody }>()
}
```

### 12. `syncToBabylon()` is the single sync point

All data → Babylon updates go through the component's own `syncToBabylon()`.
No store or system should read component properties and push them to Babylon independently.
If a structural change (type switch, full rebuild) is required, trigger it from inside
`syncToBabylon()` using a stored scene ref set in `onCreate()`.

```ts
// ✅ CORRECT
override syncToBabylon(): void {
  const body = this.physicsBody
  if (!body) return
  body.setMassProperties({ mass: this.mass })
  body.setLinearDamping(this.linearDamping)
}
```

### 13. `onDispose()` is the single cleanup point

A component disposes all Babylon objects it owns in its own `onDispose()`.
Systems and stores **must not** dispose Babylon objects that are properties of another component.
If a system creates a Babylon object and hands it to a component, it loses ownership at that point.

### 14. Systems coordinate order, not ownership

A System may orchestrate when components are initialised (e.g. "physics engine must be enabled
before physics bodies can be created") and may CALL into components to wire them up.
Once a Babylon object is created the system assigns the ref to the component and forgets it.
Systems keep only unsub/cleanup callbacks in their private tracking state.

```ts
// ✅ CORRECT — system creates, then hands off
const body = new PhysicsBody(node, motionType, startAsleep, scene)
rb.physicsBody = body // component owns it from here
rb.physicsContainerShape = containerShape

// ❌ WRONG — system caches the ref it already gave to the component
entry.body = body
this._containers.set(id, entry)
```

### 15. Store the Babylon scene ref in `onCreate()`, not via installed callbacks

If a component needs the Babylon `Scene` to rebuild itself (e.g. changing camera type, creating
a physics body), store the scene ref in `onCreate(scene, world)`:

```ts
private _scene: Scene | null = null
override onCreate(scene: unknown, _world: unknown): void {
  this._scene = scene as Scene
}
```

Do **not** install a `onRebuildNeeded` callback from a store/system as a workaround for not
having the scene ref. That moves the component's core behavior into an external system, violating
rule 11.

## Naming Conventions

| Thing          | Convention           | Example                |
| -------------- | -------------------- | ---------------------- |
| Components     | PascalCase.vue       | `HierarchyPanel.vue`   |
| Composables    | camelCase.ts         | `useDraggable.ts`      |
| Stores         | camelCase store      | `panelStore.ts`        |
| Types/ifaces   | PascalCase           | `PanelDef`, `EntityId` |
| CSS variables  | --color-_, --panel-_ | `--color-accent`       |
| Tailwind class | utility-first        | `flex items-center`    |

## What NOT to do

- ❌ Don't add `<style scoped>` with colour values — use CSS vars + Tailwind
- ❌ Don't create new base components without checking if an existing one covers it
- ❌ Don't put business logic in components — put it in stores or composables
- ❌ Don't use `v-html` with user-provided data (XSS risk)
- ❌ Don't install additional styling libraries (no Bootstrap, Vuetify, etc.)
- ❌ Don't use `any` in TypeScript — use `unknown` and narrow properly
