import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import init from 'mhfz-core'
import { assembleGameData } from './data/import/gameData'
import { runSearch } from './search'

const ROOT = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths'
const read = (p: string) => readFileSync(`${ROOT}/${p}`, 'utf-8')

// Exercises the exact call path the UI uses (search.ts -> the compiled
// wasm-bindgen `search` export), not just the underlying Rust function
// directly — this is the integration seam most likely to break silently
// (camelCase mismatches, wasm init timing, etc.) without a live browser.
describe('runSearch against real data through the actual wasm-bindgen boundary', () => {
  beforeAll(async () => {
    const wasmPath = new URL('../node_modules/mhfz-core/mhfz_core_bg.wasm', import.meta.url)
    const bytes = readFileSync(wasmPath)
    await init({ module_or_path: bytes })
  })

  it('finds real Attack+Health sets exactly like the native Rust test does', () => {
    const gameData = assembleGameData({
      equipHead: read('dat/EquipHead.xml'),
      equipBody: read('dat/EquipBody.xml'),
      equipArm: read('dat/EquipArm.xml'),
      equipWaist: read('dat/EquipWst.xml'),
      equipLeg: read('dat/EquipLeg.xml'),
      weapon: read('dat/Weapon.xml'),
      jewel: read('dat/Jewel.xml'),
      skillCuff: read('dat/SkillCuff.xml'),
      skillBase: read('dat/SkillBase.xml'),
      teniSkillBase: read('dat/TeniSkillBase.xml'),
      define: read('conf/Define.xml'),
      clothes: read('conf/Clothes.xml'),
    })

    const results = runSearch(gameData, {
      targets: [
        { skillName: 'Attack', minPoint: 10 },
        { skillName: 'Health', minPoint: 10 },
      ],
      job: 'Both',
      maxResults: 5,
    })

    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      const attack = r.activeSkills.find((s) => s.skillName === 'Attack')
      const health = r.activeSkills.find((s) => s.skillName === 'Health')
      expect(attack && attack.point >= 10).toBe(true)
      expect(health && health.point >= 10).toBe(true)
      expect(typeof r.totalDefense).toBe('number')
      expect(r.head).toBeTruthy()
    }
  })
})
