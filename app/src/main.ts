import './style.css'
import init, { core_version } from 'mhfz-core'

const appEl = document.querySelector<HTMLDivElement>('#app')!
appEl.innerHTML = `
  <main>
    <h1>MHFZ Set Searcher</h1>
    <p id="status">Loading WebAssembly core…</p>
  </main>
`

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!

init()
  .then(() => {
    statusEl.textContent = `Rust/WASM core loaded (v${core_version()}). Data browser, search, and settings UI land in later phases.`
  })
  .catch((err) => {
    statusEl.textContent = `Failed to load WASM core: ${err}`
  })
