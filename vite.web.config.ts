import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Build config for the **static web shell** (`npm run build:web`).
 *
 * The output is deliberately data-independent — it holds no story content, only
 * the app — so it can be built once and reused for every export. The story data
 * is a separate `snapshot.js` written next to it by `npm run export:static`.
 */
export default defineConfig({
  root: resolve('src/web'),
  // Relative asset URLs, so the exported folder works at any depth: a subdomain
  // root, /storyline/, or wp-content/uploads/… . Vite's default of '/' would
  // only work at the domain root.
  base: './',
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [
    react(),
    {
      // Injected here rather than written into index.html so Vite doesn't try to
      // resolve it as a build input (it doesn't exist until export time) and warn
      // about it on every build. `head-prepend` makes it a classic script ahead of
      // the deferred module bundle, so the data is on `window` before React boots.
      name: 'zn-inject-snapshot',
      transformIndexHtml: () => [
        { tag: 'script', attrs: { src: './snapshot.js' }, injectTo: 'head-prepend' as const }
      ]
    },
    {
      // Vite always tags the entry as `type="module" crossorigin`, regardless of
      // the IIFE output format. Both attributes trigger CORS checks that fail on
      // a file:// page (origin `null`) — they're what blocks the script *and* the
      // stylesheet when you double-click index.html. The bundle is already a
      // classic IIFE script, so dropping them costs nothing and makes the
      // exported folder previewable locally as well as over http(s).
      name: 'zn-classic-entry',
      transformIndexHtml: {
        order: 'post' as const,
        handler: (html: string) =>
          html
            .replace(/\s+type="module"/g, '')
            .replace(/\s+crossorigin/g, '')
            // A classic script runs *during* parsing, so without `defer` the entry
            // executes before <div id="root"> exists. snapshot.js deliberately
            // stays non-deferred, so the data is on `window` before the app runs.
            .replace(/<script(?=\s+src="\.\/assets\/)/g, '<script defer')
      }
    }
  ],
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true,
    // A published board is read by humans, not audited for bundle size; keeping
    // sourcemaps off keeps the uploaded folder small.
    sourcemap: false,
    // Emit one classic script instead of an ES module, so the exported folder can
    // also be opened straight from file:// to check before uploading. Module
    // scripts are CORS-checked and a file:// document's origin is null, so a
    // module build only ever works over http(s). Nothing is lost: the app is a
    // single chunk either way.
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } }
  }
})
