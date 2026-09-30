import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDefineFile } from './define'

const CONF_DIR = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths/conf'

describe('parseDefineFile', () => {
  it('parses all ability-type labels and MAX_SKILL_LIMIT_UP exactly', () => {
    const labels = parseDefineFile(readFileSync(`${CONF_DIR}/Define.xml`, 'utf-8'))
    expect(labels).toEqual({
      gclassEffect: 'Ｇ級効果',
      skillUp: 'スキルUP',
      activateSkill: 'スキル発動',
      attachableSpJewels: 'ＳＰ装飾品装着可能',
      skillLimitUp: 'Skill Slots Up',
      skillUpgrade: 'スキル強化',
      nocountSkill: 'スキル枠消費なし',
      maxSkillLimitUp: 7,
    })
  })
})
