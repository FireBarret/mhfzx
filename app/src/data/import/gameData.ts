// Assembles a full GameData from already-read XML file contents. Pure and
// I/O-free on purpose: browser code will read files via <input webkitdirectory>
// or the File System Access API and pass their text in here; tests read them
// from disk directly. Keeping this function decoupled from *how* the text was
// obtained is what makes it usable from both places unchanged.

import type { GameData } from '../schema'
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

export function assembleGameData(files: GameDataSourceFiles): GameData {
  return {
    head: parseEquipFile(files.equipHead).normal,
    body: parseEquipFile(files.equipBody).normal,
    arm: parseEquipFile(files.equipArm).normal,
    waist: parseEquipFile(files.equipWaist).normal,
    leg: parseEquipFile(files.equipLeg).normal,
    weapons: parseWeaponFile(files.weapon),
    jewels: parseJewelFile(files.jewel).normal,
    skillCuffs: parseSkillCuffFile(files.skillCuff),
    clothes: parseClothesFile(files.clothes),
    skillBase: parseSkillBaseFile(files.skillBase),
    teniSkillBase: parseTeniSkillBaseFile(files.teniSkillBase),
    abilityTypes: parseDefineFile(files.define),
  }
}
