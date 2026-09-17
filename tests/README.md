# Tests

Two suites, split by what they can realistically catch.

```bash
npm test          # unit — fast, no browser
npm run test:e2e  # end-to-end — drives the real editor (needs `npm run dev` running)
```

## Unit (`tests/unit`, Vitest)

Pure logic with no Babylon scene and no Vue rendering: the ECS world, component
serialization round-trips, the transform value helpers, the animation data model,
and the shortcut focus guard.

Runs under `happy-dom` because Babylon's math types and the focus helpers both
expect a DOM. Config lives in [`vitest.config.ts`](../vitest.config.ts), kept
separate from `vite.config.ts` so the suite doesn't pay for the plugins that walk
`node_modules` for `.d.ts` files and read the Havok wasm.

## End-to-end (`tests/e2e`)

Drives the running editor in a real browser. This exists because the bugs worth
catching in this codebase only appear once Babylon, Vue reactivity and the DOM
are all live — an `AnimationGroup` that throws on a track with no keys, a menu
that re-opens on hover, a keyboard shortcut that fires inside a text field. None
of those are reachable from a unit test.

Start the dev server first:

```bash
npm run dev
```

then in another terminal:

```bash
npm run test:e2e
```

| Variable | Purpose |
|---|---|
| `NEBU_E2E_URL` | Target a different origin (default `http://localhost:5173`) |
| `NEBU_E2E_HEADED=1` | Watch the run instead of going headless |
| `NEBU_E2E_BROWSER` | Path to a Chromium binary, if auto-detection fails |

Uses `playwright-core` against a Chrome or Edge already installed on the machine,
so `npm install` never downloads a browser. Rendering goes through SwiftShader,
so it works on machines and CI runners without a GPU.

### How elements are driven

The harness dispatches events straight at DOM nodes instead of synthesising real
pointer input. The editor is dense with overlapping absolutely-positioned panels,
dropdowns and toasts, and pointer-actionability checks spend their time fighting
that rather than testing behaviour. Where the interaction itself is under test —
hover-opened submenus — real mouse input is used.

Two selector notes that cost time to discover:

- The hierarchy's inline rename box and its search box are both `input.flex-1`.
  They differ only by height (`h-5` vs `h-6`); targeting the wrong one types the
  new name into the search field and filters the tree to nothing.
- `span.flex-1.font-medium.truncate` matches panel **title bars** as well as the
  scene row, and title bars come first in the DOM. Match on the scene name.

### Adding a scenario

```js
await scenario('Thing I broke once', async () => {
  await newNamedEntity('Subject')
  check('it behaves', (await treeNames()).includes('Subject'))
})
```

`check(name, passed, detail?)` records a result, `scenario` catches throws so one
broken step doesn't abort the run, and `summary()` sets the exit code.
