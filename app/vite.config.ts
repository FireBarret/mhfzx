import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// mhfz-core is a `file:` dependency pointing at ../rust-core/pkg (outside
// this project's own root), so the compiled .wasm it serves lives outside
// app/ too. Vite's dev server refuses to serve files outside its detected
// root by default (server.fs.allow) -- without this, every request for
// mhfz_core_bg.wasm 403s, the WASM core never initializes, and every
// search silently fails with no visible error (confirmed via a real
// Chromium run: "403 Forbidden fetching '.../rust-core/pkg/mhfz_core_bg.wasm'").
export default defineConfig({
  server: {
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
})
