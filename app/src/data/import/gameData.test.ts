import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleGameData } from './gameData'

const ROOT = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths'
const read = (p: string) => readFileSync(`${ROOT}/${p}`, 'utf-8')

// Assembled once for the whole suite — parsing all five ~3MB Equip files plus
// the rest is the expensive part; every test below just inspects the result.
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
})

describe('assembleGameData against the real dat/ + conf/ files', () => {
  it('parses a substantial record count for every category', () => {
    expect(gameData.head.length).toBeGreaterThan(1000)
    expect(gameData.body.length).toBeGreaterThan(1000)
    expect(gameData.arm.length).toBeGreaterThan(1000)
    expect(gameData.waist.length).toBeGreaterThan(1000)
    expect(gameData.leg.length).toBeGreaterThan(1000)
    expect(gameData.weapons.length).toBeGreaterThan(0)
    expect(gameData.jewels.length).toBeGreaterThan(1000)
    expect(gameData.skillCuffs.length).toBeGreaterThan(1000)
    expect(gameData.skillBase.length).toBeGreaterThan(100)
    expect(gameData.teniSkillBase).toHaveLength(26)
  })

  // The original engine resolves every <Skills><Skill>Name</Skill> entry
  // against a SkillBase name->entry map and *throws* if the name isn't found
  // (docs/rules-spec.md §4, BaseData.cs). So by construction, every skill name
  // referenced anywhere in real dat/ data must have a matching SkillBase
  // entry — this is a strong, free consistency check on both the importer
  // and the data itself, not an assumption.
  it('every <Skills> reference across Equip/Weapon/Jewel/SkillCuff resolves to a SkillBase entry', () => {
    const knownSkillNames = new Set(gameData.skillBase.map((s) => s.name))
    const unresolved = new Set<string>()

    const checkAll = (items: { skills: { skillName: string }[] }[]) => {
      for (const item of items) {
        for (const s of item.skills) {
          if (!knownSkillNames.has(s.skillName)) unresolved.add(s.skillName)
        }
      }
    }

    checkAll(gameData.head)
    checkAll(gameData.body)
    checkAll(gameData.arm)
    checkAll(gameData.waist)
    checkAll(gameData.leg)
    checkAll(gameData.weapons)
    checkAll(gameData.jewels)
    checkAll(gameData.skillCuffs)

    expect([...unresolved]).toEqual([])
  })

  it('every equip Class code is a non-empty bracketed string', () => {
    for (const d of [...gameData.head, ...gameData.body, ...gameData.arm, ...gameData.waist, ...gameData.leg]) {
      expect(d.class).toMatch(/^\(.+\)$/)
    }
  })
})
