/// <reference types="vite/client" />

/**
 * Virtual module produced by the `bundlePackageTypes` Vite plugin.
 * Contains every .d.ts file from the configured npm packages, keyed by
 * virtual path e.g. 'file:///node_modules/@babylonjs/core/index.d.ts'.
 * MonacoEditor.vue registers these with the Monaco TypeScript language
 * service so that bare-specifier imports in user scripts resolve correctly.
 */
declare module 'virtual:package-types' {
  const types: Record<string, string>
  export default types
}
