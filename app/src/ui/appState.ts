// Minimal shared state — no framework, so this is just a module-level
// mutable holder with a simple pub/sub for the one thing views need to react
// to (data finishing loading).

import type { GameData } from '../data/schema'

type Listener = () => void

class AppState {
  gameData: GameData | null = null
  /** False until the WASM core's `init()` has resolved. Calling into the
   * search export before this is true throws (the compiled module's
   * internal `wasm` reference is still unset) -- callers must check this
   * rather than assume `init()` in main.ts has already settled. */
  wasmReady = false
  private listeners: Listener[] = []

  setGameData(data: GameData) {
    this.gameData = data
    for (const l of this.listeners) l()
  }

  setWasmReady() {
    this.wasmReady = true
    for (const l of this.listeners) l()
  }

  onDataLoaded(listener: Listener) {
    this.listeners.push(listener)
  }
}

export const appState = new AppState()
