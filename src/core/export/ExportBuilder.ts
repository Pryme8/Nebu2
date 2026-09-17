/**
 * ExportBuilder — collects all project data and produces a zip bundle.
 *
 * Two export modes:
 *
 *  'inline' (default)
 *    Everything is baked into a single self-contained index.html.
 *    Binary assets → base-64 data: URLs.  Scenes / materials → JSON objects.
 *    Scripts → transpiled JS source strings.
 *    Works from file:// with no web server.
 *
 *  'file-based'
 *    index.html + separate files for scenes, materials, scripts, assets.
 *    The runtime uses fetch() to load them at startup — requires a web server
 *    (e.g. `npx serve MyGame/`) because fetch() is blocked on file://.
 *
 *   <outputName>/
 *     index.html
 *     scenes/   ← .scene.json  (file-based only)
 *     assets/   ← binary files (file-based only)
 *     materials/← .mat.json    (file-based only)
 *     scripts/  ← .js          (file-based only)
 *
 * Genericity note:
 *   New ECS component types require NO changes here — their data is already
 *   serialised into the scene JSON via the World/Entity serialisation layer.
 *   Only new *asset categories* (data stored as separate project files, like
 *   materials or scripts) would need additional collection logic below.
 *   The runtime JS (BuiltInTemplates.ts) is the only place that needs new
 *   reconstruction code for each Babylon.js feature.
 */

import { zip, strToU8 }                from 'fflate'
import { transform as sucraseTransform } from 'sucrase'
import { fileSystemService }            from '@/lib/fs/FileSystemService'
import type { AssetEntry }              from '@/types/asset'
import type { ExportConfig, NebuRuntimeManifest, ExportTemplate, ExportSceneEntry } from '@/types/export'
import { BUILT_IN_TEMPLATES }           from './BuiltInTemplates'

// ── Script transpile helpers (mirrors ScriptEngine.ts pipeline) ───────────

const SCRIPT_BANNER = `const NebuScript = globalThis.__NEBU_SCRIPT__;\n`

const PACKAGE_GLOBALS: Record<string, string> = {
  '@babylonjs/core': '__NEBU_BABYLON__',
}

/** Rewrite bare-specifier imports to globalThis lookups (same as ScriptEngine). */
function _rewritePackageImports(js: string): string {
  for (const [pkg, globalKey] of Object.entries(PACKAGE_GLOBALS)) {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    js = js.replace(
      new RegExp(`^import\\s+\\{([^}]*)\\}\\s+from\\s+["']${escaped}["']\\s*;?`, 'gm'),
      (_, named: string) => {
        const trimmed = named.trim()
        if (!trimmed) return ''
        const destructured = trimmed.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')
        return `const { ${destructured} } = globalThis.${globalKey};`
      },
    )

    js = js.replace(
      new RegExp(`^import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+["']${escaped}["']\\s*;?`, 'gm'),
      (_, ns: string) => `const ${ns} = globalThis.${globalKey};`,
    )

    js = js.replace(
      new RegExp(`^import\\s+["']${escaped}["']\\s*;?`, 'gm'),
      '',
    )
  }
  return js
}

/** Full script transpile: TypeScript → JS, rewrite imports, prepend banner. */
function transpileScript(ts: string): string {
  const { code: js } = sucraseTransform(ts, {
    transforms:          ['typescript'],
    disableESTransforms: true,
  })
  return SCRIPT_BANNER + _rewritePackageImports(js)
}

// ── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildSceneSelectHtml(scenes: ExportSceneEntry[]): string {
  if (scenes.length <= 1) return ''
  const options = scenes
    .map((s, i) => `<option value="${i}">${escapeHtml(s.name)}</option>`)
    .join('\n        ')
  return `<select id="nebu-scene-select">\n        ${options}\n      </select>`
}

function applyTemplate(template: ExportTemplate, customHtml: string | undefined, vars: {
  title:          string
  sceneSelectHtml: string
  manifestJson:   string
}): string {
  const html = template.id === 'custom' && customHtml ? customHtml : template.html
  return html
    .replace(/\{\{TITLE\}\}/g,             vars.title)
    .replace(/\{\{SCENE_SELECT_HTML\}\}/g, vars.sceneSelectHtml)
    .replace(/\{\{MANIFEST_JSON\}\}/g,     vars.manifestJson)
}

/** Convert an ArrayBuffer to a base-64 data URL suitable for Babylon loaders. */
function toDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes  = new Uint8Array(buffer)
  const chunks: string[] = []
  const CHUNK  = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)))
  }
  return `data:${mimeType};base64,${btoa(chunks.join(''))}`
}

function getMimeType(relativePath: string): string {
  const ext = relativePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    glb:     'model/gltf-binary',
    gltf:    'model/gltf+json',
    obj:     'text/plain',
    fbx:     'application/octet-stream',
    babylon: 'application/octet-stream',
    png:     'image/png',
    jpg:     'image/jpeg',
    jpeg:    'image/jpeg',
    webp:    'image/webp',
    ktx:     'image/ktx',
    ktx2:    'image/ktx2',
    mp3:     'audio/mpeg',
    ogg:     'audio/ogg',
    wav:     'audio/wav',
  }
  return map[ext] ?? 'application/octet-stream'
}

// ── Script / material meta ────────────────────────────────────────────────

export interface ScriptMeta {
  guid:    string
  name:    string
  relPath: string
}

export interface MaterialMeta {
  id:      string
  relPath: string
}

// ── Main export function ──────────────────────────────────────────────────

export async function buildExport(
  config:        ExportConfig,
  dirHandle:     FileSystemDirectoryHandle,
  assets:        AssetEntry[],
  scriptMetas:   ScriptMeta[],
  materialMetas: MaterialMeta[],
  onProgress?:   (p: number) => void,
): Promise<Uint8Array> {

  return config.exportMode === 'file-based'
    ? _buildFileBased(config, dirHandle, assets, scriptMetas, materialMetas, onProgress)
    : _buildInline(config, dirHandle, assets, scriptMetas, materialMetas, onProgress)
}

// ── Inline mode ───────────────────────────────────────────────────────────

async function _buildInline(
  config:        ExportConfig,
  dirHandle:     FileSystemDirectoryHandle,
  assets:        AssetEntry[],
  scriptMetas:   ScriptMeta[],
  materialMetas: MaterialMeta[],
  onProgress?:   (p: number) => void,
): Promise<Uint8Array> {

  const report = (p: number) => onProgress?.(p)
  const manifest: NebuRuntimeManifest = {
    version: '1.0.0', title: config.title, engineTarget: config.engineTarget,
    exportMode: 'inline', scenes: [], assets: {}, materials: {}, scripts: {},
  }
  const total = config.scenes.length + assets.length + materialMetas.length + scriptMetas.length + 1
  let step = 0

  for (const scene of config.scenes) {
    try {
      const json = await fileSystemService.readText(dirHandle, scene.relPath)
      manifest.scenes.push({ id: scene.guid, name: scene.name, data: JSON.parse(json) })
    } catch { console.warn(`[ExportBuilder] Could not read scene: ${scene.relPath}`) }
    report(++step / total)
  }

  for (const asset of assets) {
    const t = asset.meta.type
    if (t === 'mesh' || t === 'texture' || t === 'audio') {
      try {
        const buf  = await fileSystemService.readBinary(dirHandle, `assets/${asset.relativePath}`)
        manifest.assets[asset.meta.guid] = { type: t, dataUrl: toDataUrl(buf, getMimeType(asset.relativePath)) }
      } catch { /* skip missing */ }
    }
    report(++step / total)
  }

  for (const mat of materialMetas) {
    try {
      const json   = await fileSystemService.readText(dirHandle, mat.relPath)
      const parsed = JSON.parse(json) as { id?: string }
      manifest.materials[parsed.id ?? mat.id] = parsed
    } catch { /* skip */ }
    report(++step / total)
  }

  for (const script of scriptMetas) {
    try {
      const ts   = await fileSystemService.readText(dirHandle, script.relPath)
      const code = transpileScript(ts)
      manifest.scripts[script.guid] = { name: script.name, code }
    } catch (e) { console.warn(`[ExportBuilder] Script transpile failed: ${script.relPath}`, e) }
    report(++step / total)
  }

  const html = _renderHtml(config, manifest)
  const files: Record<string, Uint8Array> = {
    [`${config.outputName}/index.html`]: strToU8(html),
  }
  report(++step / total)
  return _zipAsync(files)
}

// ── File-based mode ───────────────────────────────────────────────────────

async function _buildFileBased(
  config:        ExportConfig,
  dirHandle:     FileSystemDirectoryHandle,
  assets:        AssetEntry[],
  scriptMetas:   ScriptMeta[],
  materialMetas: MaterialMeta[],
  onProgress?:   (p: number) => void,
): Promise<Uint8Array> {

  const report = (p: number) => onProgress?.(p)
  const files: Record<string, Uint8Array> = {}
  const prefix = `${config.outputName}/`
  const manifest: NebuRuntimeManifest = {
    version: '1.0.0', title: config.title, engineTarget: config.engineTarget,
    exportMode: 'file-based', scenes: [], assets: {}, materials: {}, scripts: {},
  }
  const total = config.scenes.length + assets.length + materialMetas.length + scriptMetas.length + 1
  let step = 0

  for (const scene of config.scenes) {
    try {
      const json    = await fileSystemService.readText(dirHandle, scene.relPath)
      const outPath = `scenes/${scene.name}.scene.json`
      files[`${prefix}${outPath}`] = strToU8(json)
      manifest.scenes.push({ id: scene.guid, name: scene.name, file: outPath })
    } catch { console.warn(`[ExportBuilder] Could not read scene: ${scene.relPath}`) }
    report(++step / total)
  }

  for (const asset of assets) {
    const t = asset.meta.type
    if (t === 'mesh' || t === 'texture' || t === 'audio') {
      try {
        const buf = await fileSystemService.readBinary(dirHandle, `assets/${asset.relativePath}`)
        const out = `assets/${asset.relativePath}`
        files[`${prefix}${out}`] = new Uint8Array(buf)
        manifest.assets[asset.meta.guid] = { type: t, file: out }
      } catch { /* skip missing */ }
    }
    report(++step / total)
  }

  for (const mat of materialMetas) {
    try {
      const json     = await fileSystemService.readText(dirHandle, mat.relPath)
      const parsed   = JSON.parse(json) as { id?: string }
      const matId    = parsed.id ?? mat.id
      const filename = mat.relPath.split('/').pop()!
      const outName  = filename.endsWith('.mat') ? `${filename}.json` : filename
      const outPath  = `materials/${outName}`
      files[`${prefix}${outPath}`] = strToU8(json)
      manifest.materials[matId] = outPath
    } catch { /* skip */ }
    report(++step / total)
  }

  for (const script of scriptMetas) {
    try {
      const ts       = await fileSystemService.readText(dirHandle, script.relPath)
      const code     = transpileScript(ts)
      const basename = script.relPath.split('/').pop()!.replace(/\.ts$/, '.js')
      const outPath  = `scripts/${basename}`
      files[`${prefix}${outPath}`] = strToU8(code)
      manifest.scripts[script.guid] = { name: script.name, file: outPath }
    } catch (e) { console.warn(`[ExportBuilder] Script transpile failed: ${script.relPath}`, e) }
    report(++step / total)
  }

  files[`${prefix}index.html`] = strToU8(_renderHtml(config, manifest))
  report(++step / total)
  return _zipAsync(files)
}

// ── Shared helpers ────────────────────────────────────────────────────────

function _renderHtml(config: ExportConfig, manifest: NebuRuntimeManifest): string {
  const template = config.templateId === 'custom'
    ? BUILT_IN_TEMPLATES.find(t => t.id === 'custom')
    : (BUILT_IN_TEMPLATES.find(t => t.id === config.templateId) ?? BUILT_IN_TEMPLATES[0])
  if (!template) throw new Error('No export template available')

  return applyTemplate(template, config.customHtml, {
    title:           escapeHtml(config.title),
    sceneSelectHtml: buildSceneSelectHtml(config.scenes),
    // Escape </script> so inline data can never close the script tag early.
    manifestJson:    JSON.stringify(manifest).replace(/<\/script>/gi, '<\\/script>'),
  })
}

function _zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (err, data) => { if (err) reject(err); else resolve(data) })
  })
}

/** Trigger a browser download for the generated zip. */
export function triggerZipDownload(zipBytes: Uint8Array, outputName: string): void {
  // Copy into an ArrayBuffer-backed view — Blob rejects ArrayBufferLike-backed ones.
  const blob = new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${outputName}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

