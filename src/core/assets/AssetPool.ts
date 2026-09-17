import type { AssetEntry } from '@/types/asset'

/**
 * AssetPool — centralized in-memory registry of all loaded/registered assets.
 * Owned by the AssetStore; passed to systems that need access to loaded data.
 */
export class AssetPool {
  private readonly _assets = new Map<string, AssetEntry>()

  register(entry: AssetEntry): void {
    this._assets.set(entry.meta.guid, entry)
  }

  get(guid: string): AssetEntry | undefined {
    return this._assets.get(guid)
  }

  remove(guid: string): boolean {
    return this._assets.delete(guid)
  }

  has(guid: string): boolean {
    return this._assets.has(guid)
  }

  get size(): number {
    return this._assets.size
  }

  get entries(): IterableIterator<AssetEntry> {
    return this._assets.values()
  }

  clear(): void {
    this._assets.clear()
  }
}
