import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * Unit-test config, deliberately separate from vite.config.ts.
 *
 * The app config loads plugins that walk node_modules for .d.ts files and read
 * the Havok wasm — none of that is needed here, and skipping it keeps the suite
 * fast. Only the path aliases are shared.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@nebu/plugin-havok': resolve(__dirname, 'packages/nebu-plugin-havok/src'),
    },
  },
  test: {
    // Babylon and the focus helpers both expect a DOM.
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
  },
})
