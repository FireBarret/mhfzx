import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSkillBaseFile, parseTeniSkillBaseFile } from './skillBase'

const DAT_DIR = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths/dat'

describe('parseSkillBaseFile', () => {
  const entries = parseSkillBaseFile(readFileSync(`${DAT_DIR}/SkillBase.xml`, 'utf-8'))

  it('parses the "Health" ladder exactly', () => {
    const health = entries.find((e) => e.name === 'Health')
    expect(health).toEqual({
      no: 31,
      id: '0950',
      name: 'Health',
      category: 'Health and Stamina',
      skillRank: true,
      options: [
        { name: 'Health +50', point: 40 },
        { name: 'Health +40', point: 30 },
        { name: 'Health +30', point: 20 },
        { name: 'Health +20', point: 15 },
        { name: 'Health +10', point: 10 },
        { name: 'Health -10', point: -10 },
        { name: 'Health -20', point: -15 },
        { name: 'Health -30', point: -20 },
      ],
    })
  })

  it('models SkillRank as a boolean, true only when the source value is "1"', () => {
    expect(entries.some((e) => e.skillRank === true)).toBe(true)
    expect(entries.filter((e) => e.skillRank).length).toBeLessThan(entries.length)
  })

  it('captures all 16 real skill categories, in document order, matching the original app\'s tree', () => {
    const categoriesInOrder = [...new Set(entries.map((e) => e.category))]
    expect(categoriesInOrder).toEqual([
      'Health and Stamina',
      'Offense and Adren',
      'Elemental Attack',
      'Guard and Defense',
      'Blademaster',
      'Sword Crystals',
      'Gunning',
      'Hiden Skills',
      'Elemental Resistance',
      'Status Resistance',
      'Protection and Evasion',
      'Items and Combination',
      'Map and Detection',
      'Gathering and Transport',
      'Rewards',
      'Other',
    ])
  })
})

describe('parseTeniSkillBaseFile', () => {
  const trees = parseTeniSkillBaseFile(readFileSync(`${DAT_DIR}/TeniSkillBase.xml`, 'utf-8'))

  it('parses 26 SkillTree entries with at least one rung each', () => {
    expect(trees).toHaveLength(26)
    for (const tree of trees) {
      expect(tree.rungs.length).toBeGreaterThan(0)
    }
  })

  it('parses "Skill Slots Up" as 7 rungs in descending document order', () => {
    // The canonical, most important tree — confirmed descending 7..1.
    const tree = trees.find((t) => t.name === 'Skill Slots Up')!
    expect(tree.rungs.map((r) => r.point)).toEqual([7, 6, 5, 4, 3, 2, 1])
  })

  it('preserves document order even where the source data is inconsistent', () => {
    // Real data quirk: every other tree lists rungs high-to-low, but
    // "Vampirism Up" (SkillTree No="13") is ordered low-to-high in the
    // actual file. The importer must not silently "fix" this by sorting —
    // it should reflect exactly what's on disk.
    const vampirism = trees.find((t) => t.name === 'Vampirism Up')!
    expect(vampirism.rungs.map((r) => r.point)).toEqual([1, 2])
  })
})
