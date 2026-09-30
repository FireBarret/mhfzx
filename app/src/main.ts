import './style.css'
import init from 'mhfz-core'
import { loadGameDataFromFileList, MissingFilesError } from './data/browserLoad'
import { appState } from './ui/appState'
import { renderSearchView } from './ui/searchView'
import { renderDataBrowserView } from './ui/dataBrowserView'

type Tab = 'search' | 'browser'

const appEl = document.querySelector<HTMLDivElement>('#app')!
appEl.innerHTML = `
  <header>
    <h1>MHFZ Set Searcher</h1>
    <input id="folder-input" type="file" webkitdirectory style="display:none">
    <button id="load-folder-btn">Load Data Folder…</button>
    <span id="status">Loading WebAssembly core…</span>
  </header>
  <div class="tabs">
    <button class="tab-button active" data-tab="search">Search</button>
    <button class="tab-button" data-tab="browser">Data Browser</button>
  </div>
  <div class="tab-panel active" id="tab-search"></div>
  <div class="tab-panel" id="tab-browser"></div>
`

const statusEl = document.querySelector<HTMLSpanElement>('#status')!
const folderInput = document.querySelector<HTMLInputElement>('#folder-input')!
const loadBtn = document.querySelector<HTMLButtonElement>('#load-folder-btn')!

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
  })
})

loadBtn.addEventListener('click', () => folderInput.click())
folderInput.addEventListener('change', async () => {
  const files = folderInput.files
  if (!files || files.length === 0) return
  statusEl.textContent = 'Parsing data files…'
  loadBtn.disabled = true
  try {
    const gameData = await loadGameDataFromFileList(files)
    appState.setGameData(gameData)
    const total = gameData.head.length + gameData.body.length + gameData.arm.length + gameData.waist.length + gameData.leg.length
    statusEl.textContent = `Loaded ${total} armor pieces, ${gameData.jewels.length} jewels, ${gameData.weapons.length} weapons.`
  } catch (err) {
    if (err instanceof MissingFilesError) {
      statusEl.textContent = `Folder is missing required files: ${err.missing.join(', ')}. Select the app's root folder (containing dat/ and conf/).`
    } else {
      statusEl.textContent = `Failed to load data: ${err instanceof Error ? err.message : String(err)}`
    }
  } finally {
    loadBtn.disabled = false
  }
})

init()
  .then(() => {
    statusEl.textContent = 'Ready — click "Load Data Folder…" to begin.'
  })
  .catch((err) => {
    statusEl.textContent = `Failed to load WASM core: ${err}`
  })
