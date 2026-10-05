import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// mhfz-core is a `file:` dependency pointing at ../rust-core/pkg (outside
// this project's own root), so the compiled .wasm it serves lives outside
// app/ too. Vite's dev server refuses to serve files outside its detected
// root by default (server.fs.allow) -- without this, every request for
// mhfz_core_bg.wasm 403s, the WASM core never initializes, and every
// search silently fails with no visible error (confirmed via a real
// Chromium run: "403 Forbidden fetching '.../rust-core/pkg/mhfz_core_bg.wasm'").
export default defineConfig(({ command }) => ({
  // GitHub Pages serves a project site from https://<user>.github.io/<repo>/,
  // so every asset URL in the production build needs that /<repo>/ prefix --
  // but the dev server is served from the root (http://localhost:5173/), so
  // only the production build gets the prefixed base, keeping `npm run dev`
  // unaffected. Update this if the repo is ever renamed.
  base: command === 'build' ? '/mhfzx/' : '/',
  server: {
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
}))
