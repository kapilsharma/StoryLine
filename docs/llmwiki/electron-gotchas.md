# Electron gotchas

Environment quirks that cost time if you don't know them.

## 1. Clear `ELECTRON_RUN_AS_NODE` before launching the app

Some agent/dev shells run inside Electron and export `ELECTRON_RUN_AS_NODE=1` globally (Claude Code does). With it set, `import { app } from 'electron'` returns a **path string** instead of the API, and the app crashes with `Cannot read properties of undefined (reading 'whenReady')`.

Always launch the built app with the var unset:

```bash
env -u ELECTRON_RUN_AS_NODE npx electron .
```

Same for running any esbuild-bundled data-layer script through Node. This is an environment quirk, not an app bug.

## 2. No `window.prompt()` in the renderer

Electron renderers do **not** support `window.prompt()` — it silently returns `null` and logs a warning, so any create/rename/input flow built on it does nothing. (`window.confirm()` and `window.alert()` *do* work and are fine for delete confirmations.)

For text input, use the in-app `usePrompt()` hook from `src/renderer/src/components/PromptModal.tsx` (provided by `PromptProvider`): `await ask({ title, placeholder, defaultValue })` returns the string or `null`. For richer forms, use the `Modal` component. Never reach for `window.prompt`.

## 3. "Electron uninstall" error → reinstall the binary

If `npm run dev` fails with `Error: Electron uninstall` (from electron-vite's `getElectronPath`), the Electron **binary** isn't installed — `node_modules/electron/path.txt` is missing (its postinstall didn't run after some `npm install`/upgrade).

Fix: `node node_modules/electron/install.js` (or `npm rebuild electron`), then `npm run dev` works.
