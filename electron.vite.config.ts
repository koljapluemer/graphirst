import { resolve } from 'path'
import { builtinModules } from 'module'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'search-worker': resolve('src/main/search-worker.ts')
        },
        // Providing our own `input` above replaces electron-vite's default main
        // entry resolution, so its default external list (electron + node
        // builtins) has to be repeated here explicitly. re2-wasm additionally
        // must stay external (not bundled/inlined) - it locates its .wasm
        // binary via a path relative to its own __dirname at runtime, which
        // only resolves correctly when it's required from node_modules as-is.
        external: [
          'electron',
          /^electron\/.+/,
          ...builtinModules.flatMap((m) => [m, `node:${m}`]),
          're2-wasm'
        ]
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
