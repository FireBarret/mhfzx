// Importer for dat/Jewel.xml and dat/SkillCuff.xml.
// Jewel.xml: root <Jewel> -> <Normal>/<SP>, flat <Data Job Name Rare Slot>
// (no Class/Sex/Type/Level/Elemental/Abilities — just Skills + Cost).
// SkillCuff.xml: root <SkillCuff> -> <P>/<S> (two independent cuff families,
// no <Normal>/<SP>), <Data Class Name Rare Slot> (no Job attribute observed
// on real data), with optional <Abilities> carrying Teni/no-count entries.

import type {
  Ability,
  Cost,
  CostItem,
  Job,
  JewelData,
  JewelSource,
  SkillContribution,
  SkillCuffData,
  SkillCuffFamily,
} from '../schema'
import { assertOneOf, asArray, attrNum, attrStr, attrStrOpt, makeParser, stripBom, textOf } from './xmlUtil'

const JOBS: readonly Job[] = ['共', '剣士', 'ガンナー']
// 'Cost' must be forced to an array here: unlike Equip/Weapon level rungs
// (always exactly one Cost each), a Jewel or SkillCuff Data element can have
// multiple sibling <Cost> elements representing alternative recipes — e.g.
// "Artisan Deco" has two independent ways to craft it (confirmed by direct
// inspection, not assumed from the original small sample read).
const ARRAY_TAGS = new Set(['Data', 'Ability', 'Skill', 'Item', 'Source', 'Cost'])

function parseOneCost(node: Record<string, unknown>): Cost {
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

function parseCosts(node: unknown): Cost[] {
  return asArray(node as Record<string, unknown>[]).map(parseOneCost)
}

function parseSources(node: Record<string, unknown> | undefined): JewelSource[] {
  if (!node) return []
  return asArray(node['Source'] as Record<string, unknown>[]).map((s) => ({
    part: attrStr(s, 'Type'),
    equipName: textOf(s),
  }))
}

function parseSkills(node: Record<string, unknown> | undefined): SkillContribution[] {
  if (!node) return []
  return asArray(node['Skill'] as Record<string, unknown>[]).map((s) => ({
    skillName: textOf(s),
    point: attrNum(s, 'Point'),
  }))
}

function parseAbilities(node: Record<string, unknown> | undefined): Ability[] {
  if (!node) return []
  return asArray(node['Ability'] as Record<string, unknown>[]).map((a) => {
    const text = textOf(a)
    return { typeName: attrStr(a, 'Type'), name: text === '' ? undefined : text }
  })
}

function parseJewelData(data: Record<string, unknown>): JewelData {
  return {
    name: attrStr(data, 'Name'),
    class: attrStrOpt(data, 'Class'),
    job: assertOneOf(attrStr(data, 'Job'), JOBS, 'Data/@Job'),
    rare: attrNum(data, 'Rare'),
    slot: attrNum(data, 'Slot'),
    skills: parseSkills(data['Skills'] as Record<string, unknown>),
    costs: parseCosts(data['Cost']),
    sources: parseSources(data['Sources'] as Record<string, unknown>),
  }
}

function parseSkillCuffData(data: Record<string, unknown>, family: SkillCuffFamily): SkillCuffData {
  return {
    name: attrStr(data, 'Name'),
    family,
    class: attrStr(data, 'Class'),
    rare: attrNum(data, 'Rare'),
    slot: attrNum(data, 'Slot'),
    skills: parseSkills(data['Skills'] as Record<string, unknown>),
    costs: parseCosts(data['Cost']),
    abilities: parseAbilities(data['Abilities'] as Record<string, unknown>),
  }
}

export interface JewelFileResult {
  normal: JewelData[]
  sp: JewelData[]
}

export function parseJewelFile(xmlText: string): JewelFileResult {
  const parser = makeParser(ARRAY_TAGS)
  const doc = parser.parse(stripBom(xmlText)) as { Jewel: Record<string, unknown> }
  const normalSection = doc.Jewel['Normal'] as Record<string, unknown> | undefined
  const spSection = doc.Jewel['SP'] as Record<string, unknown> | undefined
  return {
    normal: asArray(normalSection?.['Data'] as Record<string, unknown>[]).map(parseJewelData),
    sp: asArray(spSection?.['Data'] as Record<string, unknown>[]).map(parseJewelData),
  }
}

export function parseSkillCuffFile(xmlText: string): SkillCuffData[] {
  const parser = makeParser(ARRAY_TAGS)
  const doc = parser.parse(stripBom(xmlText)) as { SkillCuff: Record<string, unknown> }
  const powerSection = doc.SkillCuff['P'] as Record<string, unknown> | undefined
  const skillSection = doc.SkillCuff['S'] as Record<string, unknown> | undefined
  return [
    ...asArray(powerSection?.['Data'] as Record<string, unknown>[]).map((d) => parseSkillCuffData(d, 'Power')),
    ...asArray(skillSection?.['Data'] as Record<string, unknown>[]).map((d) => parseSkillCuffData(d, 'Skill')),
  ]
}
