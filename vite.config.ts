import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve, join, relative } from 'path'
import { readFileSync, readdirSync, existsSync } from 'fs'

/**
 * Collects all .d.ts files (+ package.json stubs) from the specified npm packages
 * and exposes them as the virtual module 'virtual:package-types'.
 *
 * MonacoEditor imports this to populate Monaco's TypeScript language service so
 * that bare-specifier imports like `import { Vector3 } from "@babylonjs/core"`
 * resolve with full IntelliSense in user scripts.
 *
 * The resulting module is routed into the 'monaco' lazy chunk so it only loads
 * when the Script Editor dialog first opens.
 */
function bundlePackageTypes(packages: string[]): Plugin {
  const VIRTUAL_ID  = 'virtual:package-types'
  const RESOLVED_ID = '\0virtual:package-types'
  let _cache: string | null = null

  function walkDts(
    dir: string,
    base: string,
    cb: (rel: string, src: string) => void,
  ): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDts(full, base, cb)
      } else if (entry.name.endsWith('.d.ts')) {
        cb(relative(base, full).replace(/\\/g, '/'), readFileSync(full, 'utf-8'))
      }
    }
  }

  return {
    name: 'bundle-package-types',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id !== RESOLVED_ID) return
      if (_cache) return _cache

      const map: Record<string, string> = {}

      for (const pkg of packages) {
        // resolve '@babylonjs/core' → node_modules/@babylonjs/core  (works on Windows too)
        const pkgDir = resolve(__dirname, 'node_modules', ...pkg.split('/'))
        if (!existsSync(pkgDir)) continue

        // Minimal package.json stub so Monaco's TS resolver finds the "types" entry point
        const pkgJsonPath = join(pkgDir, 'package.json')
        if (existsSync(pkgJsonPath)) {
          const raw = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
          map[`file:///node_modules/${pkg}/package.json`] = JSON.stringify({
            name:    raw.name,
            version: raw.version,
            types:   raw.types ?? raw.typings ?? 'index.d.ts',
          })
        }

        // All declaration files under the package root
        walkDts(pkgDir, pkgDir, (rel, src) => {
          map[`file:///node_modules/${pkg}/${rel}`] = src
        })
      }

      _cache = `const t=${JSON.stringify(map)};export default t;`
      return _cache
    },
  }
}

// Copies @babylonjs/havok's WASM so it's served at /HavokPhysics.wasm
// with the correct application/wasm MIME type in both dev and production.
function havokWasm(): Plugin {
  const wasmSrc = resolve(
    __dirname,
    'node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',
  )
  return {
    name: 'havok-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/HavokPhysics.wasm') {
          res.setHeader('Content-Type', 'application/wasm')
          res.end(readFileSync(wasmSrc))
          return
        }
        next()
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'HavokPhysics.wasm',
        source: readFileSync(wasmSrc),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    havokWasm(),
    bundlePackageTypes(['@babylonjs/core', '@babylonjs/havok']),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@nebu/plugin-havok': resolve(__dirname, 'packages/nebu-plugin-havok/src'),
    },
  },
  build: {
    // Split Monaco into its own chunk so it loads lazily and doesn't block
    // the initial app bundle.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('monaco-editor') || id.includes('package-types')) return 'monaco'
        },
      },
    },
    chunkSizeWarningLimit: 3000,
  },
  optimizeDeps: {
    // @babylonjs/core is excluded because it lazily imports shader modules
    // (e.g. depthBoxBlur.fragment) the first time features like shadow generators
    // are activated.  When Vite pre-bundles the package those dynamic imports
    // produce new chunks that weren't part of the initial scan, triggering
    // "Outdated Optimize Dep" (504) errors at runtime.  Excluding it lets Vite
    // serve the files straight from node_modules so every dynamic import resolves
    // naturally without cache invalidation issues.
    //
    // @babylonjs/havok uses `import.meta.url` at the module level to set its
    // scriptDirectory for WASM resolution.  Vite's esbuild pre-bundler cannot
    // handle this pattern correctly — it either stalls or replaces the URL with
    // the bundle's own path, making the WASM un-loadable.
    //
    // monaco-editor is excluded for the same reason: it self-references its own
    // worker URIs via import.meta.url which pre-bundling breaks.
    exclude: ['@babylonjs/core', '@babylonjs/havok', 'monaco-editor'],
  },
})
