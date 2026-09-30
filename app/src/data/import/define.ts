// Importer for conf/Define.xml — the ABILITY_TYPE_* label strings and
// MAX_SKILL_LIMIT_UP. Read at import time and never hardcoded: these are the
// exact string values `Ability.typeName` is compared against throughout the
// evaluator/search engine (see docs/rules-spec.md §1), and Define.xml is
// itself a versioned file a future data update could change.

import type { AbilityTypeLabels } from '../schema'
import { makeParser, stripBom } from './xmlUtil'

export function parseDefineFile(xmlText: string): AbilityTypeLabels {
  const parser = makeParser(new Set<string>())
  const doc = parser.parse(stripBom(xmlText)) as { Define: Record<string, unknown> }
  const d = doc.Define
  const str = (key: string): string => {
    const value = d[key]
    if (typeof value !== 'string') throw new Error(`conf/Define.xml: missing or non-text <${key}>`)
    return value
  }
  return {
    gclassEffect: str('ABILITY_TYPE_GCLASS_EFFECT'),
    skillUp: str('ABILITY_TYPE_SKILL_UP'),
    activateSkill: str('ABILITY_TYPE_ACTIVATE_SKILL'),
    attachableSpJewels: str('ABILITY_TYPE_ATTACHABLE_SPJEWELS'),
    skillLimitUp: str('ABILITY_TYPE_SKILL_LIMIT_UP'),
    skillUpgrade: str('ABILITY_TYPE_SKILL_UPGRADE'),
    nocountSkill: str('ABILITY_TYPE_NOCOUNT_SKILL'),
    maxSkillLimitUp: Number(str('MAX_SKILL_LIMIT_UP')),
  }
}
