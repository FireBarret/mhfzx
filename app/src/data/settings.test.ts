import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { settingsViewFrom } from './settings'
import { parseXmlTree, serializeXmlTree } from './xmlTree'

const SETTING_PATH = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths/setting/setting.xml'

describe('SettingsView against the real setting.xml', () => {
  it('reads the known real values exactly', () => {
    const view = settingsViewFrom(parseXmlTree(readFileSync(SETTING_PATH, 'utf-8')))
    expect(view.threadNum).toBe(6)
    expect(view.stopSearchCount).toBe(100)
    expect(view.optimizeEquip).toBe(true)
    expect(view.optimizeJewelry).toBe(true)
    expect(view.optimizeJewelryCombination).toBe(true)
    expect(view.countRequiredSkillCount).toBe(true)
    expect(view.acceptFirstFoundSkillCuffCombination).toBe(true)
    expect(view.acceptFirstFoundDecorationCombination).toBe(true)
    expect(view.ensureActiveSkillCount).toBe(true)
    expect(view.sex).toBe('WOMAN')
    expect(view.defLower).toBe(0)
    expect(view.rareLower).toBe(1)
    expect(view.rareUpper).toBe(20)
  })

  it('reads the real SkillSets list, including one full example', () => {
    const view = settingsViewFrom(parseXmlTree(readFileSync(SETTING_PATH, 'utf-8')))
    expect(view.skillSets.map((s) => s.name)).toEqual([
      'Vigor Base',
      'Adren Base',
      'Evasion Skills',
      'Guard Skills',
      'Damage Skills',
      'Support Base',
    ])
    const vigorBase = view.skillSets.find((s) => s.name === 'Vigor Base')!
    expect(vigorBase.list).toEqual([
      'Solid Determination',
      'Strong Attack +6',
      'Furious',
      'Thunder Clad',
      'Rush',
      'Sword God +2',
      'Vigorous',
      'Ceaseless',
      'Crit Conversion',
      'Vampirism+2',
    ])
  })

  it('writing through the view and re-exporting changes only the touched fields', () => {
    const original = readFileSync(SETTING_PATH, 'utf-8')
    const tree = parseXmlTree(original)
    const view = settingsViewFrom(tree)
    view.threadNum = 16
    view.optimizeEquip = false

    const exported = serializeXmlTree(tree)
    const expected = original
      .replace('<ThreadNum>6</ThreadNum>', '<ThreadNum>16</ThreadNum>')
      .replace('<OptimizeEquip>true</OptimizeEquip>', '<OptimizeEquip>false</OptimizeEquip>')
    expect(exported).toBe(expected)

    // And re-importing sees the new values, with everything else intact.
    const reView = settingsViewFrom(parseXmlTree(exported))
    expect(reView.threadNum).toBe(16)
    expect(reView.optimizeEquip).toBe(false)
    expect(reView.stopSearchCount).toBe(100)
    expect(reView.skillSets).toHaveLength(6)
  })
})
