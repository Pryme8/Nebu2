import type { EngineTarget } from './project'

// ── Export config (used by ExportDialog → exportStore) ───────────────────

/** One scene entry shown in the dialog's scene picker. */
export interface ExportSceneEntry {
  guid:    string
  name:    string
  /** Path relative to the project root, e.g. `scenes/Main Scene.scene` */
  relPath: string
}

/**
 * Controls how assets and data are packaged in the zip.
 *
 * - `'inline'`     — Everything is embedded in index.html (base-64 / JSON).
 *                    Works directly from file:// — no web server needed.
 * - `'file-based'` — Scenes, scripts, materials and assets are written as
 *                    separate files inside the zip. Requires a web server
 *                    (e.g. `npx serve`) to run; fetch() is blocked on file://.
 */
export type ExportMode = 'inline' | 'file-based'

/** Full configuration captured from the export dialog. */
export interface ExportConfig {
  /** Folder and zip base-name, e.g. `"MyGame"` → `MyGame.zip` */
  outputName:   string
  /** Project / page title embedded in the HTML document. */
  title:        string
  /** Ordered list of scenes to bundle. */
  scenes:       ExportSceneEntry[]
  /** ID of the built-in template to use, or `'custom'`. */
  templateId:   string
  /** Raw HTML override when `templateId === 'custom'`. */
  customHtml?:  string
  /** Engine back-end for the runtime. */
  engineTarget: EngineTarget
  /** Whether to inline all data into index.html or write separate files. */
  exportMode:   ExportMode
}

// ── Runtime manifest (embedded as window.__NEBU_MANIFEST in index.html) ──
//
// Supports both export modes:
//  inline     → data / dataUrl / code fields are populated (no fetch needed)
//  file-based → file fields are populated (runtime uses fetch — needs a server)

export interface RuntimeSceneRef {
  id:    string
  name:  string
  /** Inline mode: full SerializedScene data object. */
  data?: unknown
  /** File-based mode: path relative to the output root. */
  file?: string
}

export interface RuntimeAssetRef {
  type: 'mesh' | 'texture' | 'audio'
  /** Inline mode: base-64 data URL (`data:<mime>;base64,…`). */
  dataUrl?: string
  /** File-based mode: path relative to the output root. */
  file?:    string
}

export interface RuntimeScriptRef {
  name:  string
  /** Inline mode: transpiled JS source string. */
  code?: string
  /** File-based mode: path relative to the output root. */
  file?: string
}

/** JSON manifest embedded into every exported page. */
export interface NebuRuntimeManifest {
  version:      '1.0.0'
  title:        string
  engineTarget: EngineTarget
  /** `'inline'` or `'file-based'` — tells the runtime which fields to use. */
  exportMode:   ExportMode
  /** Ordered list of scenes; index 0 is the default/auto-loaded scene. */
  scenes:       RuntimeSceneRef[]
  /**
   * Map of assetGuid → asset reference.
   * Inline: `{ dataUrl }`. File-based: `{ file }`.
   */
  assets:       Record<string, RuntimeAssetRef>
  /**
   * Map of materialId → material data.
   * Inline: parsed object. File-based: relative path string.
   */
  materials:    Record<string, unknown>
  /** Map of scriptGuid → script reference. */
  scripts:      Record<string, RuntimeScriptRef>
}

// ── HTML templates ────────────────────────────────────────────────────────

/**
 * An HTML page template for the exported site.
 *
 * The builder replaces these placeholders before writing the zip:
 *  - `{{TITLE}}`            — HTML-escaped project title
 *  - `{{SCENE_SELECT_HTML}}` — ready-made `<select>` HTML if >1 scene,
 *                              empty string when only one scene is exported
 *  - `{{MANIFEST_JSON}}`    — JSON-stringified `NebuRuntimeManifest`
 */
export interface ExportTemplate {
  id:          string
  name:        string
  description: string
  html:        string
  isBuiltIn:   boolean
}
