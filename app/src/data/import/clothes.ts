// Importer for conf/Clothes.xml — the "layered outfit" item a hunter wears
// to gain 2 skill-cuff slots (decompiled PigClothes/ClothesData). Root
// <Clothes> -> flat <Data Type Slot Class?>Name</Data> (Class is an
// optional cash-shop marker, e.g. "(課)", not used for anything the search
// cares about). `Type` is always "P" or "S" in real data (decompiled
// BaseData.LoadClothes throws on anything else), mapped to `sRestricted`:
// Type="S" restricts attachable cuffs to the Skill family (decompiled
// `PigClothes.SetJewelry`'s `SetableCuffSeriesType != 0` check, where
// SkillCuffSeriesType.P == 0); Type="P" imposes no family restriction.

import type { ClothesData } from '../schema'
import { assertOneOf, asArray, attrNum, attrStr, makeParser, stripBom, textOf } from './xmlUtil'

const ARRAY_TAGS = new Set(['Data'])

export function parseClothesFile(xmlText: string): ClothesData[] {
  const parser = makeParser(ARRAY_TAGS)
  const doc = parser.parse(stripBom(xmlText)) as { Clothes: Record<string, unknown> }
  const entries = asArray(doc.Clothes['Data'] as Record<string, unknown>[])
  return entries.map((data) => ({
    name: textOf(data),
    slot: attrNum(data, 'Slot'),
    sRestricted: assertOneOf(attrStr(data, 'Type'), ['P', 'S'] as const, 'Data/@Type') === 'S',
  }))
}
