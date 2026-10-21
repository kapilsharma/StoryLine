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
        // gray-matter is CJS and safe to require externally. An ESM-only
        // dependency must not be listed here: it has to be bundled (Rollup
        // converts it to CJS) rather than left as a require() in the CJS main
        // bundle.
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
