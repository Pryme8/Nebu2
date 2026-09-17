// ─────────────────────────────────────────────
// ScriptWatcher — polls a project folder for .ts script file changes
//
// The browser File System Access API has no native watch() callback, so we
// compare File.lastModified timestamps on a fixed interval.
//
// Each .ts file is backed by a .ts.meta sidecar (NebuFileMeta with kind
// 'script').  The sidecar is created automatically on first discovery, using
// a fresh GUID.  That GUID is the stable identity used by scriptStore &
// ScriptComponent throughout the project's lifetime.
//
// Callbacks:
//   onAdded   — new .ts file found (or first time seen after a project open)
//   onChanged — file's lastModified timestamp increased (content changed)
//   onRemoved — file disappeared from disk (deleted or moved away)
// ─────────────────────────────────────────────

import { fileSystemService } from './FileSystemService'
import { generateGuid }      from '@/lib/guid'
import type { NebuFileMeta } from '@/types/project'

// ── Public types ────────────────────────────────────────────────────────────

export interface ScriptWatcherCallbacks {
  onAdded(relPath: string, source: string, guid: string, name: string): void
  onChanged(relPath: string, source: string, guid: string, name: string): void
  onRemoved(relPath: string, guid: string): void
}

interface CacheEntry {
  guid:         string
  lastModified: number
}

// ── Implementation ──────────────────────────────────────────────────────────

class ScriptWatcher {

  private _handle:  FileSystemDirectoryHandle | null  = null
  private _folder   = 'scripts'
  private _cbs:     ScriptWatcherCallbacks | null     = null
  private _timer:   ReturnType<typeof setInterval> | null = null
  private _cache    = new Map<string, CacheEntry>()   // relPath → entry
  private _running  = false

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Start watching `folder` inside `handle`.
   * Performs an immediate initial scan (all existing scripts fire `onAdded`)
   * then polls every `intervalMs` milliseconds.
   */
  start(
    handle:      FileSystemDirectoryHandle,
    callbacks:   ScriptWatcherCallbacks,
    intervalMs = 2_000,
    folder     = '',
  ): void {
    this.stop()
    this._handle  = handle
    this._folder  = folder
    this._cbs     = callbacks
    this._cache   = new Map()
    this._running = true

    // Immediate scan so scripts are available as soon as the project opens.
    void this._tick()
    this._timer = setInterval(() => void this._tick(), intervalMs)
  }

  /** Stop watching and clear all state. */
  stop(): void {
    this._running = false
    if (this._timer !== null) {
      clearInterval(this._timer)
      this._timer = null
    }
    this._handle = null
    this._cbs    = null
    this._cache  = new Map()
  }

  /**
   * Trigger an immediate out-of-schedule rescan.
   * Useful after creating a new script file programmatically so it is
   * registered right away instead of waiting for the next poll tick.
   */
  rescan(): void {
    void this._tick()
  }

  // ── Private: scan tick ────────────────────────────────────────────────────

  private async _tick(): Promise<void> {
    const handle = this._handle
    if (!handle || !this._cbs || !this._running) return

    // Scan the scripts folder for all .ts files.
    const found = new Map<string, File>()
    await this._walk(handle, this._folder, found)

    // ── Additions + changes ──────────────────────────────────────────────
    for (const [relPath, file] of found) {
      const cached = this._cache.get(relPath)
      if (!cached) {
        // New file — ensure meta sidecar exists and compile.
        const { guid, name } = await this._ensureMeta(handle, relPath)
        let source = ''
        try { source = await file.text() } catch { continue }
        this._cache.set(relPath, { guid, lastModified: file.lastModified })
        this._cbs.onAdded(relPath, source, guid, name)
      } else if (file.lastModified > cached.lastModified) {
        // Modified.
        let source = ''
        try { source = await file.text() } catch { continue }
        this._cache.set(relPath, { ...cached, lastModified: file.lastModified })
        this._cbs.onChanged(relPath, source, cached.guid, _nameFromPath(relPath))
      }
    }

    // ── Removals ─────────────────────────────────────────────────────────
    for (const [relPath, entry] of this._cache) {
      if (!found.has(relPath)) {
        this._cache.delete(relPath)
        this._cbs.onRemoved(relPath, entry.guid)
      }
    }
  }

  // ── Private: file walk ────────────────────────────────────────────────────

  /** Recursively collect all .ts (but not .d.ts or .meta) files. */
  private async _walk(
    handle:  FileSystemDirectoryHandle,
    relPath: string,
    out:     Map<string, File>,
  ): Promise<void> {
    let children: FileSystemHandle[]
    try {
      children = await fileSystemService.listDir(handle, relPath)
    } catch {
      return   // folder may not exist yet
    }

    for (const child of children) {
      const childRel = relPath ? `${relPath}/${child.name}` : child.name
      if (child.kind === 'directory') {
        await this._walk(handle, childRel, out)
      } else if (
        child.kind === 'file' &&
        child.name.endsWith('.ts') &&
        !child.name.endsWith('.d.ts') &&
        !child.name.endsWith('.ts.meta')
      ) {
        try {
          const file = await fileSystemService.readAsFile(handle, childRel)
          out.set(childRel, file)
        } catch { /* skip unreadable */ }
      }
    }
  }

  // ── Private: meta sidecar ─────────────────────────────────────────────────

  /** Read or create the .ts.meta sidecar; return { guid, name }. */
  private async _ensureMeta(
    handle:  FileSystemDirectoryHandle,
    relPath: string,
  ): Promise<{ guid: string; name: string }> {
    const metaPath = `${relPath}.meta`
    const name     = _nameFromPath(relPath)

    if (await fileSystemService.fileExists(handle, metaPath)) {
      try {
        const meta = await fileSystemService.readJson<NebuFileMeta>(handle, metaPath)
        if (meta.guid) return { guid: meta.guid, name }
      } catch { /* fall through — recreate */ }
    }

    const guid = generateGuid()
    const meta: NebuFileMeta = {
      guid,
      kind:         'script',
      relPath,
      lastModified: Date.now(),
    }
    await fileSystemService.writeJson(handle, metaPath, meta)
    return { guid, name }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _nameFromPath(relPath: string): string {
  const parts = relPath.split('/')
  const file  = parts[parts.length - 1] ?? relPath
  return file.replace(/\.ts$/, '')
}

/** Module-level singleton — import this everywhere. */
export const scriptWatcher = new ScriptWatcher()
