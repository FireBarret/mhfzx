// Exporter for setting/allows.xml and setting/ignore.xml — see xmlWrite.ts
// for the shared formatting conventions this must reproduce byte-for-byte.

import type { Allows, Ignore } from '../schema'
import { CRLF, XSI_XSD_NS, renderStringListElement } from './xmlWrite'

export function exportAllowsFile(allows: Allows): string {
  return [
    `<?xml version="1.0"?>`,
    `<Allows ${XSI_XSD_NS}>`,
    renderStringListElement('Equip', allows.equip, '  '),
    renderStringListElement('Jewelry', allows.jewelry, '  '),
    renderStringListElement('SkillCuff', allows.skillCuff, '  '),
    renderStringListElement('Tag', allows.tag, '  '),
    `</Allows>`,
  ].join(CRLF)
}

export function exportIgnoreFile(ignore: Ignore): string {
  return [
    `<?xml version="1.0"?>`,
    `<Ignore ${XSI_XSD_NS}>`,
    renderStringListElement('Equip', ignore.equip, '  '),
    renderStringListElement('Jewelry', ignore.jewelry, '  '),
    // Note: lowercase in the source XML — a real quirk, not a typo to "fix".
    renderStringListElement('skill', ignore.skill, '  '),
    renderStringListElement('Class', ignore.class, '  '),
    renderStringListElement('Class_Jewelry', ignore.classJewelry, '  '),
    renderStringListElement('SkillCuff', ignore.skillCuff, '  '),
    renderStringListElement('Item', ignore.item, '  '),
    renderStringListElement('Tag', ignore.tag, '  '),
    `</Ignore>`,
  ].join(CRLF)
}
