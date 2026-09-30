// Importer for setting/allows.xml and setting/ignore.xml — plain exact-name
// (or class-code) allow/deny lists per category, each section either
// self-closing when empty or a list of <string> children.

import type { Allows, Ignore } from '../schema'
import { makeParser, parseStringListElement, stripBom } from './xmlUtil'

const ARRAY_TAGS = new Set(['string'])

export function parseAllowsFile(xmlText: string): Allows {
  const parser = makeParser(ARRAY_TAGS)
  const doc = parser.parse(stripBom(xmlText)) as { Allows: Record<string, unknown> }
  const root = doc.Allows
  return {
    equip: parseStringListElement(root['Equip'] as Record<string, unknown>),
    jewelry: parseStringListElement(root['Jewelry'] as Record<string, unknown>),
    skillCuff: parseStringListElement(root['SkillCuff'] as Record<string, unknown>),
    tag: parseStringListElement(root['Tag'] as Record<string, unknown>),
  }
}

export function parseIgnoreFile(xmlText: string): Ignore {
  const parser = makeParser(ARRAY_TAGS)
  const doc = parser.parse(stripBom(xmlText)) as { Ignore: Record<string, unknown> }
  const root = doc.Ignore
  return {
    equip: parseStringListElement(root['Equip'] as Record<string, unknown>),
    jewelry: parseStringListElement(root['Jewelry'] as Record<string, unknown>),
    // Note: lowercase in the source XML — a real quirk, not a typo to "fix".
    skill: parseStringListElement(root['skill'] as Record<string, unknown>),
    class: parseStringListElement(root['Class'] as Record<string, unknown>),
    classJewelry: parseStringListElement(root['Class_Jewelry'] as Record<string, unknown>),
    skillCuff: parseStringListElement(root['SkillCuff'] as Record<string, unknown>),
    item: parseStringListElement(root['Item'] as Record<string, unknown>),
    tag: parseStringListElement(root['Tag'] as Record<string, unknown>),
  }
}
