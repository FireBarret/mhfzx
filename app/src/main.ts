import './style.css'
import init from 'mhfz-core'
import { loadGameDataFromFileList, MissingFilesError } from './data/browserLoad'
import { tryLoadDefaultGameData } from './data/defaultLoad'
import type { GameData } from './data/schema'
import { appState } from './ui/appState'
import { renderSearchView, renderTagFilter } from './ui/searchView'
import { renderDataBrowserView } from './ui/dataBrowserView'

type Tab = 'search' | 'browser'

const appEl = document.querySelector<HTMLDivElement>('#app')!
appEl.innerHTML = `
  <div class="menu-bar">
    <div class="menu-item" data-menu="file">File
      <div class="menu-dropdown">
        <button data-action="load-folder">Load Data Folder…</button>
      </div>
    </div>
    <div class="menu-item" data-menu="view">View
      <div class="menu-dropdown">
        <button disabled>Search</button>
        <button disabled>Data Browser</button>
      </div>
    </div>
    <div class="menu-item" data-menu="tools">Tools
      <div class="menu-dropdown">
        <button disabled>Options… (not yet implemented)</button>
      </div>
    </div>
    <div class="menu-item" data-menu="help">Help
      <div class="menu-dropdown">
        <button disabled>About MHFZ Set Searcher</button>
      </div>
    </div>
    <span id="status">Loading WebAssembly core…</span>
    <input id="folder-input" type="file" webkitdirectory style="display:none">
  </div>
  <div class="tabs">
    <button class="tab-button active" data-tab="search">Search</button>
    <button class="tab-button" data-tab="browser">Data Browser</button>
  </div>
  <div class="tab-panel active" id="tab-search"></div>
  <div class="tab-panel" id="tab-browser"></div>
`

const statusEl = document.querySelector<HTMLSpanElement>('#status')!
const folderInput = document.querySelector<HTMLInputElement>('#folder-input')!

const searchPanel = document.querySelector<HTMLDivElement>('#tab-search')!
const browserPanel = document.querySelector<HTMLDivElement>('#tab-browser')!
renderSearchView(searchPanel)
renderDataBrowserView(browserPanel)

document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab as Tab
    document.querySelectorAll('.tab-button').forEach((b) => b.classList.toggle('active', b === btn))
    searchPanel.classList.toggle('active', tab === 'search')
    browserPanel.classList.toggle('active', tab === 'browser')
    // Tags are added/removed from the Data Browser tab, so refresh the
    // Search tab's own tag-filter dropdown whenever it becomes visible
    // again (the preset panel's own tag filter self-refreshes from both
    // tabs already via presetPanel.ts's mounted-instance tracking).
    if (tab === 'search') renderTagFilter(searchPanel)
  })
})

// --- Classic dropdown menu bar: click a top-level item to open it, click
// elsewhere to close. Only File > Load Data Folder is wired to a real
// action right now; the rest are present for the authentic menu-bar look
// (matching the original's File/View/Tools/Help bar) with disabled items
// rather than silently doing nothing.
const menuItems = document.querySelectorAll<HTMLDivElement>('.menu-item')
menuItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    const isOpen = item.classList.contains('open')
    menuItems.forEach((m) => m.classList.remove('open'))
    if (!isOpen) item.classList.add('open')
    e.stopPropagation()
  })
})
document.addEventListener('click', () => menuItems.forEach((m) => m.classList.remove('open')))

document.querySelector<HTMLButtonElement>('[data-action="load-folder"]')!.addEventListener('click', () => folderInput.click())

function describeGameData(gameData: GameData) {
  const total = gameData.head.length + gameData.body.length + gameData.arm.length + gameData.waist.length + gameData.leg.length
  return `Loaded ${total} armor pieces, ${gameData.jewels.length} jewels, ${gameData.weapons.length} weapons.`
}

folderInput.addEventListener('change', async () => {
  const files = folderInput.files
  if (!files || files.length === 0) return
  statusEl.textContent = 'Parsing data files…'
  try {
    const gameData = await loadGameDataFromFileList(files)
    appState.setGameData(gameData)
    statusEl.textContent = describeGameData(gameData)
  } catch (err) {
    if (err instanceof MissingFilesError) {
      statusEl.textContent = `Folder is missing required files: ${err.missing.join(', ')}. Select the app's root folder (containing dat/ and conf/).`
    } else {
      statusEl.textContent = `Failed to load data: ${err instanceof Error ? err.message : String(err)}`
    }
  }
})

init()
  .then(async () => {
    appState.setWasmReady()
    statusEl.textContent = 'Checking for bundled default data…'
    // Auto-load a bundled dataset if one is present (public/default-data/,
    // gitignored -- a local convenience copy, not shipped in the repo), so
    // the app is usable immediately without "Load Data Folder" every time.
    // Falls back to the plain "Ready" state silently if none is found.
    const defaultGameData = await tryLoadDefaultGameData()
    if (defaultGameData) {
      appState.setGameData(defaultGameData)
      statusEl.textContent = `${describeGameData(defaultGameData)} (default data — File > Load Data Folder… to use a different one)`
    } else {
      statusEl.textContent = 'Ready — File > Load Data Folder… to begin.'
    }
  })
  .catch((err) => {
    statusEl.textContent = `Failed to load WASM core: ${err instanceof Error ? err.message : String(err)}`
  })
