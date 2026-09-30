// Importer for dat/Equip{Head,Body,Arm,Wst,Leg}.xml and dat/Weapon.xml.
// Confirmed shape (project plan Phase 2 schema survey): root <Equip> (or
// <Wepon> for weapons) -> <normal>/<SP> sections, each with repeated <Data>.
// Levels are exactly L1 or exactly L1..L7 (never partial); Abilities/Skills
// live on the whole Data element, not per-level.

import type {
  Ability,
  Cost,
  CostItem,
  Elemental,
  EquipData,
  Job,
  LevelEntry,
  Platform,
  Sex,
  SkillContribution,
  WeaponData,
} from '../schema'
import { assertOneOf, asArray, attrNum, attrNumOpt, attrStr, attrStrOpt, makeParser, stripBom, textOf } from './xmlUtil'

const JOBS: readonly Job[] = ['共', '剣士', 'ガンナー']
const SEXES: readonly Sex[] = ['共', '女', '男']
const PLATFORMS: readonly Platform[] = ['PS3', 'PS4', 'Wii']

const ARRAY_TAGS = new Set(['Data', 'Ability', 'Skill', 'Item'])

function parseElemental(node: Record<string, unknown> | undefined): Elemental {
  if (!node) return { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 }
  return {
    fire: attrNum(node, 'Fire'),
    water: attrNum(node, 'Water'),
    thunder: attrNum(node, 'Thunder'),
    ice: attrNum(node, 'Ice'),
    dragon: attrNum(node, 'Dragon'),
  }
}

function parseCost(node: Record<string, unknown> | undefined): Cost {
  if (!node) return { money: 0, costType: undefined, items: [] }
  const items: CostItem[] = asArray(node['Item'] as Record<string, unknown>[]).map((itemNode) => ({
    name: textOf(itemNode),
    num: attrNum(itemNode, 'Num'),
  }))
  const rawType = attrStrOpt(node, 'Type')
  return {
    money: attrNum(node, 'Money'),
    costType: rawType === undefined ? undefined : assertOneOf(rawType, ['create', 'upgrade'] as const, 'Cost/@Type'),
    items,
  }
}

function parseLevels(node: Record<string, unknown> | undefined, statAttr: 'Def' | 'Atk'): LevelEntry[] {
  if (!node) return []
  const levels: LevelEntry[] = []
  for (let n = 1; n <= 7; n++) {
    const rung = node[`L${n}`] as Record<string, unknown> | undefined
    if (!rung) continue
    levels.push({
      level: n,
      def: statAttr === 'Def' ? attrNum(rung, 'Def') : undefined,
      atk: statAttr === 'Atk' ? attrNum(rung, 'Atk') : undefined,
      slot: attrNum(rung, 'Slot'),
      cost: parseCost(rung['Cost'] as Record<string, unknown>),
    })
  }
  return levels
}

function parseAbilities(node: Record<string, unknown> | undefined): Ability[] {
  if (!node) return []
  return asArray(node['Ability'] as Record<string, unknown>[]).map((a) => {
    const text = textOf(a)
    return { typeName: attrStr(a, 'Type'), name: text === '' ? undefined : text }
  })
}

function parseSkills(node: Record<string, unknown> | undefined): SkillContribution[] {
  if (!node) return []
  return asArray(node['Skill'] as Record<string, unknown>[]).map((s) => ({
    skillName: textOf(s),
    point: attrNum(s, 'Point'),
  }))
}

function parseEquipData(data: Record<string, unknown>): EquipData {
  return {
    name: attrStr(data, 'Name'),
    class: attrStr(data, 'Class'),
    rare: attrNum(data, 'Rare'),
    job: assertOneOf(attrStr(data, 'Job'), JOBS, 'Data/@Job'),
    sex: assertOneOf(attrStr(data, 'Sex'), SEXES, 'Data/@Sex'),
    equipType: attrStr(data, 'Type'),
    gr: attrNumOpt(data, 'GR'),
    platform: attrStrOpt(data, 'Platform') === undefined
      ? undefined
      : assertOneOf(attrStr(data, 'Platform'), PLATFORMS, 'Data/@Platform'),
    elemental: parseElemental(data['Elemental'] as Record<string, unknown>),
    levels: parseLevels(data['Level'] as Record<string, unknown>, 'Def'),
    abilities: parseAbilities(data['Abilities'] as Record<string, unknown>),
    skills: parseSkills(data['Skills'] as Record<string, unknown>),
  }
}

function parseWeaponData(data: Record<string, unknown>): WeaponData {
  return {
    name: attrStr(data, 'Name'),
    job: assertOneOf(attrStr(data, 'Job'), JOBS, 'Data/@Job'),
    sex: assertOneOf(attrStr(data, 'Sex'), SEXES, 'Data/@Sex'),
    rare: attrNum(data, 'Rare'),
    elemental: parseElemental(data['Elemental'] as Record<string, unknown>),
    levels: parseLevels(data['Level'] as Record<string, unknown>, 'Atk'),
    abilities: parseAbilities(data['Abilities'] as Record<string, unknown>),
    skills: parseSkills(data['Skills'] as Record<string, unknown>),
  }
}

export interface EquipFileResult {
  normal: EquipData[]
  sp: EquipData[]
}

export function parseEquipFile(xmlText: string): EquipFileResult {
  const parser = makeParser(ARRAY_TAGS)
  const doc = parser.parse(stripBom(xmlText)) as { Equip: Record<string, unknown> }
  const root = doc.Equip
  const normalSection = root['normal'] as Record<string, unknown> | undefined
  const spSection = root['SP'] as Record<string, unknown> | undefined
  return {
    normal: asArray(normalSection?.['Data'] as Record<string, unknown>[]).map(parseEquipData),
    sp: asArray(spSection?.['Data'] as Record<string, unknown>[]).map(parseEquipData),
  }
}

export function parseWeaponFile(xmlText: string): WeaponData[] {
  const parser = makeParser(ARRAY_TAGS)
  const doc = parser.parse(stripBom(xmlText)) as { Wepon: Record<string, unknown> }
  const normalSection = doc.Wepon['normal'] as Record<string, unknown> | undefined
  return asArray(normalSection?.['Data'] as Record<string, unknown>[]).map(parseWeaponData)
}
