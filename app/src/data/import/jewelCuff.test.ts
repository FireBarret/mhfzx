import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseJewelFile, parseSkillCuffFile } from './jewelCuff'

const DAT_DIR = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths/dat'

describe('parseJewelFile', () => {
  const { normal, sp } = parseJewelFile(readFileSync(`${DAT_DIR}/Jewel.xml`, 'utf-8'))

  it('parses a large normal list and an empty SP list', () => {
    expect(normal.length).toBeGreaterThan(100)
    expect(sp).toEqual([])
  })

  it('parses "Paralysis 1 Deco" including its negative side-skill', () => {
    const deco = normal.find((j) => j.name === 'Paralysis 1 Deco')
    expect(deco).toEqual({
      name: 'Paralysis 1 Deco',
      job: '共',
      rare: 4,
      slot: 1,
      skills: [
        { skillName: 'Paralysis Res', point: 2 },
        { skillName: 'Poison Res', point: -2 },
      ],
      costs: [
        {
          money: 400,
          costType: 'create',
          items: [
            { name: 'Aquaglow Jewel', num: 1 },
            { name: 'Genprey Fang', num: 3 },
          ],
        },
      ],
      sources: [],
    })
  })

  it('parses "set/SP" jewels that have a Class and Sources but no Cost', () => {
    // Confirmed by direct inspection of the real file: ~1952 of 2336 jewel
    // records carry <Sources> (granted by specific armor pieces), and this
    // is not mutually exclusive with having a <Cost> — both, either, or
    // neither field may be present.
    const setJewel = normal.find((j) => j.name === 'Wht Mono BM G')
    expect(setJewel).toBeDefined()
    expect(setJewel!.class).toBe('(Ｇ)')
    expect(setJewel!.costs).toEqual([])
    expect(setJewel!.sources).toEqual([
      { part: 'Head', equipName: 'Monodevil G Helm' },
      { part: 'Body', equipName: 'Monodevil G Mail' },
      { part: 'Arm', equipName: 'Monodevil G Arms' },
      { part: 'Waist', equipName: 'Monodevil G Coil' },
      { part: 'Leg', equipName: 'Monodevil G Greaves' },
    ])
  })

  it('parses "Artisan Deco" as having two alternative crafting recipes', () => {
    // Confirmed by direct inspection: a Data element can have more than one
    // sibling <Cost> — alternative recipes for the same jewel.
    const artisan = normal.find((j) => j.name === 'Artisan Deco')
    expect(artisan).toBeDefined()
    expect(artisan!.costs).toHaveLength(2)
    expect(artisan!.costs[0].items.map((i) => i.name)).toEqual([
      'Bloodrun Jewel',
      'Golden Rajang Hide',
      'Blood Red Horn',
    ])
    expect(artisan!.costs[1].items.map((i) => i.name)).toEqual([
      'Bloodrun Jewel',
      'Lunastra Horn',
      'White Monoblos Hrn',
    ])
  })

  it('every jewel has either a Cost, Sources, or both', () => {
    for (const j of normal) {
      expect(j.costs.length > 0 || j.sources.length > 0).toBe(true)
    }
  })
})

describe('parseSkillCuffFile', () => {
  const cuffs = parseSkillCuffFile(readFileSync(`${DAT_DIR}/SkillCuff.xml`, 'utf-8'))

  it('parses both the P and S families', () => {
    expect(cuffs.some((c) => c.family === 'Power')).toBe(true)
    expect(cuffs.some((c) => c.family === 'Skill')).toBe(true)
  })

  it('parses "Artisan PA1" from the P family exactly', () => {
    const cuff = cuffs.find((c) => c.name === 'Artisan PA1')
    expect(cuff).toEqual({
      name: 'Artisan PA1',
      family: 'Power',
      category: 'Normal',
      class: '(P)',
      rare: 5,
      slot: 2,
      skills: [{ skillName: 'Artisan', point: 3 }],
      costs: [{ money: 0, costType: 'create', items: [{ name: 'PA Cuff Tkt', num: 1 }] }],
      abilities: [],
    })
  })
})
