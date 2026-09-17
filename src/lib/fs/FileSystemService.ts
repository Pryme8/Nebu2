/**
 * FileSystemService — thin wrapper around the browser File System Access API.
 * All paths passed to read/write methods are relative to a root
 * FileSystemDirectoryHandle (the project folder).
 */
export class FileSystemService {

  /** Prompt the user to pick a folder.  Returns null if the user cancelled. */
  async openProjectFolder(): Promise<FileSystemDirectoryHandle | null> {
    if (typeof (window as any).showDirectoryPicker !== 'function') {
      throw new Error('The File System Access API is not supported in this browser. Please use Chrome or Edge.')
    }
    try {
      // showDirectoryPicker is not yet in all TS lib definitions, so cast.
      return await (window as any).showDirectoryPicker({ mode: 'readwrite' }) as FileSystemDirectoryHandle
    } catch (err) {
      // AbortError means the user dismissed the picker — treat as cancellation.
      if (err instanceof DOMException && err.name === 'AbortError') return null
      throw err
    }
  }

  async fileExists(dir: FileSystemDirectoryHandle, relativePath: string): Promise<boolean> {
    try {
      await this._resolveFile(dir, relativePath)
      return true
    } catch {
      return false
    }
  }

  async readJson<T>(dir: FileSystemDirectoryHandle, relativePath: string): Promise<T> {
    const fileHandle = await this._resolveFile(dir, relativePath)
    const file       = await fileHandle.getFile()
    return JSON.parse(await file.text()) as T
  }

  /** Read a file as a plain string (e.g. TypeScript source). */
  async readText(dir: FileSystemDirectoryHandle, relativePath: string): Promise<string> {
    const fileHandle = await this._resolveFile(dir, relativePath)
    const file       = await fileHandle.getFile()
    return file.text()
  }

  async writeJson(dir: FileSystemDirectoryHandle, relativePath: string, data: unknown): Promise<void> {
    const fileHandle = await this._resolveFileForWrite(dir, relativePath)
    const writable   = await fileHandle.createWritable()
    await writable.write(JSON.stringify(data, null, 2))
    await writable.close()
  }

  /** Write a raw text string to a file (e.g. TypeScript source). */
  async writeText(dir: FileSystemDirectoryHandle, relativePath: string, text: string): Promise<void> {
    const fileHandle = await this._resolveFileForWrite(dir, relativePath)
    const writable   = await fileHandle.createWritable()
    await writable.write(text)
    await writable.close()
  }

  async readBinary(dir: FileSystemDirectoryHandle, relativePath: string): Promise<ArrayBuffer> {
    const fileHandle = await this._resolveFile(dir, relativePath)
    const file       = await fileHandle.getFile()
    return file.arrayBuffer()
  }

  /** Get the raw File object for a path — useful for creating object URLs. */
  async readAsFile(dir: FileSystemDirectoryHandle, relativePath: string): Promise<File> {
    const fileHandle = await this._resolveFile(dir, relativePath)
    return fileHandle.getFile()
  }

  async writeBinary(dir: FileSystemDirectoryHandle, relativePath: string, data: ArrayBuffer): Promise<void> {
    const fileHandle = await this._resolveFileForWrite(dir, relativePath)
    const writable   = await fileHandle.createWritable()
    await writable.write(data)
    await writable.close()
  }

  /** Copy a browser File object into the project folder at the given relative path. */
  async copyFileInto(dir: FileSystemDirectoryHandle, relativePath: string, file: File): Promise<void> {
    const fileHandle = await this._resolveFileForWrite(dir, relativePath)
    const writable   = await fileHandle.createWritable()
    await writable.write(await file.arrayBuffer())
    await writable.close()
  }

  /** List the direct children of a directory (relative to root). */
  async listDir(dir: FileSystemDirectoryHandle, relativePath: string): Promise<FileSystemHandle[]> {
    const targetDir = await this._resolveDir(dir, relativePath)
    const handles: FileSystemHandle[] = []
    // FileSystemDirectoryHandle is a *pair* async iterable ([name, handle] tuples).
    // Use .values() to get the FileSystemHandle objects directly.
    for await (const handle of (targetDir as any).values()) {
      handles.push(handle as FileSystemHandle)
    }
    return handles
  }

  /** Delete a file at the given relative path from the root directory. */
  async deleteFile(dir: FileSystemDirectoryHandle, relativePath: string): Promise<void> {
    const parts    = relativePath.split('/').filter(Boolean)
    const fileName = parts.pop()!
    let   parentDir: FileSystemDirectoryHandle = dir
    for (const part of parts) {
      parentDir = await parentDir.getDirectoryHandle(part)
    }
    await (parentDir as FileSystemDirectoryHandle & { removeEntry(n: string): Promise<void> }).removeEntry(fileName)
  }

  /** Create (or return existing) directory at the relative path. */
  async ensureDir(dir: FileSystemDirectoryHandle, relativePath: string): Promise<FileSystemDirectoryHandle> {
    return this._resolveDir(dir, relativePath, true)
  }

  // ── Internals ────────────────────────────────────────────────────

  private async _resolveDir(
    root:         FileSystemDirectoryHandle,
    relativePath: string,
    create        = false,
  ): Promise<FileSystemDirectoryHandle> {
    const parts = relativePath.split('/').filter(Boolean)
    let current = root
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create })
    }
    return current
  }

  private async _resolveFile(
    root:         FileSystemDirectoryHandle,
    relativePath: string,
  ): Promise<FileSystemFileHandle> {
    const parts    = relativePath.split('/').filter(Boolean)
    const fileName = parts.pop()!
    let dir        = root
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part)
    }
    return dir.getFileHandle(fileName)
  }

  private async _resolveFileForWrite(
    root:         FileSystemDirectoryHandle,
    relativePath: string,
  ): Promise<FileSystemFileHandle> {
    const parts    = relativePath.split('/').filter(Boolean)
    const fileName = parts.pop()!
    let dir        = root
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }
    return dir.getFileHandle(fileName, { create: true })
  }
}

/** Singleton instance — import this everywhere rather than constructing. */
export const fileSystemService = new FileSystemService()
