// ─────────────────────────────────────────────
// Texture Store
//
// Manages Babylon.js Texture instances keyed by asset GUID.
// Provides a checkerboard DynamicTexture as a placeholder for
// textures that have not yet been loaded from disk.
// ─────────────────────────────────────────────

import { defineStore }     from 'pinia'
import { shallowRef }      from 'vue'
import {
  DynamicTexture,
  Texture,
  type Scene as BabylonScene,
} from '@babylonjs/core'
import { fileSystemService } from '@/lib/fs/FileSystemService'
import type { AssetEntry }   from '@/types/asset'

export const useTextureStore = defineStore('texture', () => {
  const _scene         = shallowRef<BabylonScene | null>(null)
  const _textures      = new Map<string, Texture>()
  const _checkerboard  = shallowRef<DynamicTexture | null>(null)

  // ── Scene wiring ─────────────────────────────────────────────

  /**
   * Called by sceneStore when the Babylon scene changes.
   * Disposes all existing Babylon textures and recreates the checkerboard
   * for the new scene. Texture re-loading for an open project is handled
   * by projectStore.openProject / individual import calls.
   */
  function setBabylonScene(scene: BabylonScene | null): void {
    for (const tex of _textures.values()) tex.dispose()
    _textures.clear()

    _checkerboard.value?.dispose()
    _checkerboard.value = null

    _scene.value = scene
    if (scene) {
      _checkerboard.value = _createCheckerboard(scene)
    }
  }

  function _createCheckerboard(scene: BabylonScene): DynamicTexture {
    const size = 128
    const tex  = new DynamicTexture('__nebu_checkerboard__', { width: size, height: size }, scene, false)
    const ctx  = tex.getContext() as CanvasRenderingContext2D
    const tile = size / 8
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#888888' : '#444444'
        ctx.fillRect(col * tile, row * tile, tile, tile)
      }
    }
    tex.update()
    return tex
  }

  // ── Texture access ────────────────────────────────────────────

  /**
   * Returns the loaded Babylon texture for a GUID, or the checkerboard
   * DynamicTexture when the texture has not been loaded yet.
   * Returns null if no Babylon scene is active.
   */
  function getTexture(guid: string): Texture | null {
    const loaded = _textures.get(guid)
    if (loaded) return loaded
    return _checkerboard.value as Texture | null
  }

  function hasTexture(guid: string): boolean {
    return _textures.has(guid)
  }

  // ── Import-time loading ───────────────────────────────────────

  /**
   * Create a Babylon Texture from a File already in memory (e.g. just imported).
   * Disposes any previous Babylon Texture for the same GUID.
   */
  async function loadFromFile(guid: string, file: File): Promise<void> {
    const scene = _scene.value
    if (!scene) return

    const url = URL.createObjectURL(file)
    _textures.get(guid)?.dispose()

    const tex = new Texture(
      url, scene, false, true, Texture.BILINEAR_SAMPLINGMODE,
      ()  => URL.revokeObjectURL(url),
      (_) => URL.revokeObjectURL(url),
    )
    _textures.set(guid, tex)
  }

  /**
   * Load all texture-type asset entries from the project directory into Babylon.
   * Called by projectStore after opening a project that has texture assets.
   */
  async function loadFromDirectory(
    entries:   AssetEntry[],
    dirHandle: FileSystemDirectoryHandle,
  ): Promise<void> {
    const scene = _scene.value
    if (!scene) return

    const texEntries = entries.filter(e => e.meta.type === 'texture')
    for (const entry of texEntries) {
      try {
        const file = await fileSystemService.readAsFile(dirHandle, `assets/${entry.relativePath}`)
        await loadFromFile(entry.meta.guid, file)
      } catch { /* skip textures that can't be read */ }
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────

  function unloadTexture(guid: string): void {
    _textures.get(guid)?.dispose()
    _textures.delete(guid)
  }

  return {
    setBabylonScene,
    getTexture,
    hasTexture,
    loadFromFile,
    loadFromDirectory,
    unloadTexture,
  }
})
