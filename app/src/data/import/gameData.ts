// Assembles a full GameData from already-read XML file contents. Pure and
// I/O-free on purpose: browser code will read files via <input webkitdirectory>
// or the File System Access API and pass their text in here; tests read them
// from disk directly. Keeping this function decoupled from *how* the text was
// obtained is what makes it usable from both places unchanged.

import type { Ability, GameData, SkillOption } from '../schema'
import { parseClothesFile } from './clothes'
import { parseDefineFile } from './define'
import { parseEquipFile, parseWeaponFile } from './equip'
import { parseJewelFile, parseSkillCuffFile } from './jewelCuff'
import { parseSkillBaseFile, parseTeniSkillBaseFile } from './skillBase'

export interface GameDataSourceFiles {
  equipHead: string
  equipBody: string
  equipArm: string
  equipWaist: string
  equipLeg: string
  weapon: string
  jewel: string
  skillCuff: string
  skillBase: string
  teniSkillBase: string
  define: string
  clothes: string
}

/** Resolves each Skill Slots Up / スキル強化 ability's bare rung name (e.g.
 * "Vampirism Up+1") to its point value by looking it up in TeniSkillBase's
 * ladders -- the item XML never carries the point itself. Unmatched names are
 * left without a tag rather than throwing. */
function resolveTeniAbilities<T extends { abilities: Ability[] }>(
  items: T[],
  rungs: Map<string, SkillOption>,
  skillLimitUp: string,
  skillUpgrade: string,
): T[] {
  return items.map((item) => ({
    ...item,
    abilities: item.abilities.map((a) =>
      (a.typeName === skillLimitUp || a.typeName === skillUpgrade) && a.name && rungs.has(a.name)
        ? { ...a, tag: rungs.get(a.name) }
        : a,
    ),
  }))
}

export function assembleGameData(files: GameDataSourceFiles): GameData {
  const abilityTypes = parseDefineFile(files.define)
  const teniSkillBase = parseTeniSkillBaseFile(files.teniSkillBase)
  const rungs = new Map<string, SkillOption>()
  for (const tree of teniSkillBase) for (const rung of tree.rungs) rungs.set(rung.name, rung)
  const resolve = <T extends { abilities: Ability[] }>(items: T[]) =>
    resolveTeniAbilities(items, rungs, abilityTypes.skillLimitUp, abilityTypes.skillUpgrade)

  return {
    head: resolve(parseEquipFile(files.equipHead).normal),
    body: resolve(parseEquipFile(files.equipBody).normal),
    arm: resolve(parseEquipFile(files.equipArm).normal),
    waist: resolve(parseEquipFile(files.equipWaist).normal),
    leg: resolve(parseEquipFile(files.equipLeg).normal),
    weapons: resolve(parseWeaponFile(files.weapon)),
    jewels: parseJewelFile(files.jewel).normal,
    skillCuffs: resolve(parseSkillCuffFile(files.skillCuff)),
    clothes: parseClothesFile(files.clothes),
    skillBase: parseSkillBaseFile(files.skillBase),
    teniSkillBase,
    abilityTypes,
  }
}
