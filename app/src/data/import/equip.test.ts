import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseEquipFile, parseWeaponFile } from './equip'

// Parsed directly against the real community dat/ files (not a fixture copy)
// so this test fails immediately if the importer's assumptions about the
// schema drift from the actual data. Path is the user's original app
// install, outside this repo.
const DAT_DIR = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths/dat'

describe('parseEquipFile', () => {
  const xml = readFileSync(`${DAT_DIR}/EquipHead.xml`, 'utf-8')
  const { normal, sp } = parseEquipFile(xml)

  it('parses ~1800 normal records and zero SP records', () => {
    expect(normal.length).toBeGreaterThan(1500)
    expect(sp.length).toBe(0)
  })

  it('parses the first record (Pietra GX Helm) exactly', () => {
    const helm = normal[0]
    expect(helm.name).toBe('Pietra GX Helm')
    expect(helm.class).toBe('(GX)')
    expect(helm.rare).toBe(11)
    expect(helm.job).toBe('共')
    expect(helm.sex).toBe('共')
    expect(helm.equipType).toBe('G Rank Armour')
    expect(helm.gr).toBe(7)
    expect(helm.platform).toBeUndefined()
    expect(helm.elemental).toEqual({ fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 })

    expect(helm.levels).toHaveLength(7)
    expect(helm.levels[0]).toEqual({
      level: 1,
      def: 246,
      atk: undefined,
      slot: 3,
      cost: {
        money: 1800,
        costType: 'upgrade',
        items: [
          { name: 'Ulti Conquest Proof', num: 1 },
          { name: 'Pokaradon Claw', num: 5 },
          { name: 'Inexhaustive Fluid', num: 1 },
        ],
      },
    })
    const l7 = helm.levels[6]
    expect(l7.level).toBe(7)
    expect(l7.def).toBe(352)
    expect(l7.cost.items).toHaveLength(4)
    expect(l7.cost.items[3]).toEqual({ name: 'Bird Wyvern Ringer', num: 1 })

    expect(helm.abilities).toEqual([{ typeName: 'Ｇ級効果' }])
    expect(helm.skills).toEqual([
      { skillName: 'Breeder', point: 5 },
      { skillName: 'Attack', point: 5 },
      { skillName: 'Movement Speed', point: 5 },
      { skillName: 'Hunter', point: 5 },
      { skillName: 'Iron Arm', point: 5 },
    ])
  })

  it('every record has a name, at least 1 level, and either 1 or 7 levels', () => {
    for (const d of normal) {
      expect(d.name.length).toBeGreaterThan(0)
      expect([1, 7]).toContain(d.levels.length)
    }
  })

  it('surfaces the Platform enum on records that carry it', () => {
    const withPlatform = normal.find((d) => d.platform !== undefined)
    expect(withPlatform).toBeDefined()
    expect(['PS3', 'PS4', 'Wii']).toContain(withPlatform!.platform)
  })
})

describe('parseWeaponFile', () => {
  it('parses the Weapon(Eating) record with Atk instead of Def', () => {
    const xml = readFileSync(`${DAT_DIR}/Weapon.xml`, 'utf-8')
    const weapons = parseWeaponFile(xml)
    const eating = weapons.find((w) => w.name === 'Weapon(Eating)')
    expect(eating).toBeDefined()
    expect(eating!.levels[0].atk).toBe(0)
    expect(eating!.levels[0].def).toBeUndefined()
    expect(eating!.abilities).toEqual([{ typeName: 'スキル発動', name: 'Speed Eater' }])
    // The XML has no <Skills> block for this record at all.
    expect(eating!.skills).toEqual([])
  })
})
