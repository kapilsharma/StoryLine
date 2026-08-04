import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': shared }
    },
    build: {
      rollupOptions: {
        // gray-matter is CJS and safe to require externally. chokidar v4 is
        // ESM-only, so it must be bundled (Rollup converts it to CJS) rather
        // than left as a require() in the CJS main bundle.
        external: ['gray-matter']
      }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': shared }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [react()]
  }
})
