// ─────────────────────────────────────────────
// ScriptEngine — compiles TypeScript script files into live NebuScript classes
//
// Pipeline per file:
//   1. Strip TypeScript syntax with sucrase (pure-JS, browser-compatible)
//   2. Prepend banner that injects NebuScript into the module scope
//   3. Load via Blob URL dynamic import (no eval, full class syntax)
//   4. Validate default export is a NebuScript subclass
//   5. Compute ScriptHookFlags by comparing each prototype method
//      to NebuScript.prototype — any unimplemented hook gets flagged `false`
//      so ScriptRuntimeSystem never registers the corresponding observable.
//
// Error handling:
//   Compile errors are forwarded to the browser console AND to the
//   notificationStore so they appear in the editor's Console panel and
//   as a toast notification.  The affected ScriptComponent is marked
//   _disabled = true so it shows an ⚠ badge in the inspector.
// ─────────────────────────────────────────────

import { transform }    from 'sucrase'
import { NebuScript }   from './NebuScript'
import * as _babylonCore from '@babylonjs/core'
import type { ScriptClassEntry, ScriptHookFlags } from '@/types/script'

// ── Global injection ─────────────────────────────────────────────────────────
// Make NebuScript available to compiled script modules via globalThis so scripts
// can extend it without any import statement.
;(globalThis as Record<string, unknown>).__NEBU_SCRIPT__  = NebuScript
// Expose all @babylonjs/core exports so scripts can write
//   import { Vector3, Color3 } from "@babylonjs/core"
// and the ScriptEngine rewrites it to a globalThis lookup at compile time.
;(globalThis as Record<string, unknown>).__NEBU_BABYLON__ = _babylonCore

/**
 * Banner prepended to every compiled module.
 * Binds NebuScript from globalThis so user code can write
 *   `export default class Foo extends NebuScript { ... }`
 * without any import.
 */
const SCRIPT_BANNER = `
const NebuScript = globalThis.__NEBU_SCRIPT__;
`

// ── Package import rewriter ───────────────────────────────────────────────────
// Blob-URL ESM modules can't resolve bare npm specifiers (no module resolver).
// Before creating the Blob URL we rewrite known package imports to globalThis
// lookups so `import { Vector3 } from "@babylonjs/core"` actually works at
// runtime in compiled user scripts.

const PACKAGE_GLOBALS: Record<string, string> = {
  '@babylonjs/core': '__NEBU_BABYLON__',
}

/**
 * Rewrite bare-specifier imports from known packages into globalThis lookups.
 *
 * Examples (applied after Sucrase has stripped TypeScript):
 *   import { Vector3, Color3 } from "@babylonjs/core"
 *   → const { Vector3, Color3 } = globalThis.__NEBU_BABYLON__;
 *
 *   import * as BABYLON from "@babylonjs/core"
 *   → const BABYLON = globalThis.__NEBU_BABYLON__;
 *
 *   import type { Mesh } from "@babylonjs/core"  (already stripped by Sucrase)
 */
function _rewritePackageImports(js: string): string {
  for (const [pkg, globalKey] of Object.entries(PACKAGE_GLOBALS)) {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // import { A, B as C } from "pkg"  →  const { A, B: C } = globalThis.KEY
    js = js.replace(
      new RegExp(`^import\\s+\\{([^}]*)\\}\\s+from\\s+["']${escaped}["']\\s*;?`, 'gm'),
      (_, named: string) => {
        const trimmed = named.trim()
        if (!trimmed) return '' // empty `{}` — type-only import already stripped
        // import { Foo as Bar } → const { Foo: Bar }
        const destructured = trimmed.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')
        return `const { ${destructured} } = globalThis.${globalKey};`
      },
    )

    // import * as NS from "pkg"  →  const NS = globalThis.KEY
    js = js.replace(
      new RegExp(`^import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+["']${escaped}["']\\s*;?`, 'gm'),
      (_, ns: string) => `const ${ns} = globalThis.${globalKey};`,
    )

    // Side-effect only: import "pkg"  →  (remove)
    js = js.replace(
      new RegExp(`^import\\s+["']${escaped}["']\\s*;?`, 'gm'),
      '',
    )
  }
  return js
}

// ── Hook detection ────────────────────────────────────────────────────────────

const HOOK_NAMES = [
  'onEditorAwake', 'onEditorUpdate', 'onEditorDestroy',
  'onAwake', 'onStart', 'onEnable', 'onDisable',
  'onUpdate', 'onLateUpdate', 'onFixedUpdate', 'onDestroy',
] as const

type HookName = (typeof HOOK_NAMES)[number]

/**
 * Compare each lifecycle method on the class prototype against NebuScript.prototype.
 * A method different from the base no-op means the script author overrode it.
 * This check happens ONCE at class-load time; the result is stored in
 * ScriptClassEntry.hooks and consulted by ScriptRuntimeSystem and
 * ScriptEditorSystem to decide which observables to register.
 */
function _computeHookFlags(cls: new () => NebuScript): ScriptHookFlags {
  const proto = cls.prototype as unknown as Record<string, unknown>
  const base  = NebuScript.prototype as unknown as Record<string, unknown>
  const flags: Partial<ScriptHookFlags> = {}
  for (const name of HOOK_NAMES) {
    flags[name as HookName] = proto[name] !== base[name]
  }
  return flags as ScriptHookFlags
}

// ── Compile ───────────────────────────────────────────────────────────────────

/**
 * Compile a TypeScript source string into a `ScriptClassEntry`.
 *
 * @param source      Raw TypeScript source of the script file.
 * @param scriptName  Display name used in error messages (filename without path).
 * @returns           A `ScriptClassEntry` on success, `null` on any error.
 *
 * Errors are automatically pushed to the console and notificationStore.
 */
export async function compileScript(
  source:     string,
  scriptName: string,
): Promise<ScriptClassEntry | null> {
  // ── Step 1: TypeScript → JS via sucrase ──────────────────────────────────
  let js: string
  try {
    const result = transform(source, {
      transforms:          ['typescript'],
      // Keep ESM export syntax so the blob-URL dynamic import receives a
      // proper ES module with `export default`.
      disableESTransforms: true,
    })
    js = result.code
  } catch (err) {
    return _reportError(
      `[Script] Transpile error in "${scriptName}":\n${_errorMessage(err)}`,
    )
  }

  // ── Step 1b: rewrite package imports ──────────────────────────────────────
  // Blob-URL modules can't resolve bare npm specifiers, so convert them to
  // globalThis lookups that reference pre-injected package objects.
  js = _rewritePackageImports(js)

  // ── Step 2: inject NebuScript binding ───────────────────────────────────
  const moduleSource = SCRIPT_BANNER + js

  // ── Step 3: Blob URL dynamic import ─────────────────────────────────────
  // Using a Blob URL instead of eval: the browser's JS engine optimises it
  // properly and source maps work.
  let mod: { default?: unknown }
  const blobUrl = URL.createObjectURL(
    new Blob([moduleSource], { type: 'text/javascript' }),
  )
  try {
    mod = await import(/* @vite-ignore */ blobUrl)
  } catch (err) {
    return _reportError(
      `[Script] Runtime load error in "${scriptName}":\n${_errorMessage(err)}`,
    )
  } finally {
    URL.revokeObjectURL(blobUrl)
  }

  // ── Step 4: validate default export ─────────────────────────────────────
  const cls = mod.default
  if (typeof cls !== 'function') {
    return _reportError(
      `[Script] "${scriptName}" must export a default class (export default class Foo extends NebuScript).`,
    )
  }
  if (!(cls.prototype instanceof NebuScript)) {
    return _reportError(
      `[Script] "${scriptName}" default export must extend NebuScript.`,
    )
  }

  const ScriptCls = cls as new () => NebuScript

  // ── Step 5: compute lifecycle hook presence ──────────────────────────────
  // Only methods explicitly overridden on the subclass prototype differ from
  // the NebuScript.prototype no-ops.  Any method returning `false` here will
  // NEVER be wired to a Babylon observable — no per-frame overhead at all.
  const hooks = _computeHookFlags(ScriptCls)

  return {
    cls:   ScriptCls,
    name:  scriptName,
    hooks,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Report a script error to the console and to the notification toast.
 * Always returns null so callers can `return _reportError(...)`.
 */
function _reportError(message: string): null {
  console.error(message)
  // Lazy import avoids circular dep; duration=0 keeps the toast until dismissed.
  import('@/stores/notificationStore').then(({ useNotificationStore }) => {
    useNotificationStore().error(message, 0)
  })
  return null
}
