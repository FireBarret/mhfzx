// Importer for dat/SkillBase.xml and dat/TeniSkillBase.xml.
// SkillBase.xml: root <Skill> -> <SkillType TypeName> -> <Data No ID Name
// SkillRank?> -> <Option Name Point> (descending point ladder, +/-).
// TeniSkillBase.xml: same root tag <Skill>, but a structurally distinct
// shape -> <SkillType TypeName="辿異スキル"> -> <SkillTree No ID Name
// Target?> -> ordered <Skill Point>Name+N</Skill> rungs. See
// docs/rules-spec.md §4 for why these two are not interchangeable.

import type { SkillBaseEntry, SkillOption, TeniSkillTree } from '../schema'
import { asArray, attrNum, attrStr, attrStrOpt, makeParser, stripBom, textOf } from './xmlUtil'

function parseOptions(node: Record<string, unknown> | undefined, tag: string): SkillOption[] {
  if (!node) return []
  return asArray(node[tag] as Record<string, unknown>[]).map((o) => ({
    name: attrStr(o, 'Name'),
    point: attrNum(o, 'Point'),
  }))
}

export function parseSkillBaseFile(xmlText: string): SkillBaseEntry[] {
  const parser = makeParser(new Set(['SkillType', 'Data', 'Option']))
  const doc = parser.parse(stripBom(xmlText)) as { Skill: Record<string, unknown> }
  const skillTypes = asArray(doc.Skill['SkillType'] as Record<string, unknown>[])
  const entries: SkillBaseEntry[] = []
  for (const st of skillTypes) {
    for (const data of asArray(st['Data'] as Record<string, unknown>[])) {
      entries.push({
        no: attrNum(data, 'No'),
        id: attrStr(data, 'ID'),
        name: attrStr(data, 'Name'),
        skillRank: attrStrOpt(data, 'SkillRank') === '1',
        options: parseOptions(data, 'Option'),
      })
    }
  }
  return entries
}

export function parseTeniSkillBaseFile(xmlText: string): TeniSkillTree[] {
  // Force isArray on the nested rung `Skill` (path SkillType.SkillTree.Skill)
  // without also wrapping the document's root `<Skill>` element in an array —
  // the root tag and the nested rung tag are both literally named "Skill".
  const parser = makeParser(
    (tagName, jPath) => tagName === 'SkillType' || tagName === 'SkillTree' || jPath.endsWith('.SkillTree.Skill'),
  )
  const doc = parser.parse(stripBom(xmlText)) as { Skill: Record<string, unknown> }
  const skillTypes = asArray(doc.Skill['SkillType'] as Record<string, unknown>[])
  const trees: TeniSkillTree[] = []
  for (const st of skillTypes) {
    for (const tree of asArray(st['SkillTree'] as Record<string, unknown>[])) {
      const rungs = asArray(tree['Skill'] as Record<string, unknown>[]).map((r) => ({
        name: textOf(r),
        point: attrNum(r, 'Point'),
      }))
      trees.push({
        no: attrNum(tree, 'No'),
        id: attrStr(tree, 'ID'),
        name: attrStr(tree, 'Name'),
        target: attrStrOpt(tree, 'Target'),
        rungs,
      })
    }
  }
  return trees
}
