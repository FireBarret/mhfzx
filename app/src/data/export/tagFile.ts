// Exporter for tag/*.xml — byte-for-byte faithful to the original .NET
// XmlSerializer output (see xmlWrite.ts for the shared conventions), so an
// unmodified round-trip (import -> export) produces an identical file the
// original exe can read back without complaint.

import type { Tag } from '../schema'
import { CRLF, escapeXmlText, renderStringListElement } from './xmlWrite'

export function exportTagFile(tag: Tag): string {
  const systemAttr = tag.system === true ? ' system="true"' : ''
  const openTag = `<Tag id="${tag.id}" name="${escapeXmlText(tag.name)}"${systemAttr}>`
  return [
    `<?xml version="1.0"?>`,
    openTag,
    renderStringListElement('ItemKeys', tag.itemKeys, '  ', 'Item'),
    `</Tag>`,
  ].join(CRLF)
}
