// Importer for tag/*.xml (and the sibling "-- Additional Tag Files --/" pack,
// same schema). Root <Tag id name system?><ItemKeys><Item>Name</Item></ItemKeys></Tag>
// — <Item> entries are plain equipment display-name strings, not ids.

import type { Tag } from '../schema'
import type { XmlNode } from './xmlUtil'
import { asArray, attrNum, attrStr, attrStrOpt, makeParser, stripBom, textOf } from './xmlUtil'

export function parseTagFile(xmlText: string): Tag {
  const parser = makeParser(new Set(['Item']), { trimValues: false })
  const doc = parser.parse(stripBom(xmlText)) as { Tag: Record<string, unknown> }
  const root = doc.Tag
  const itemKeys = root['ItemKeys'] as Record<string, unknown> | undefined
  return {
    id: attrNum(root, 'id'),
    name: attrStr(root, 'name'),
    system: attrStrOpt(root, 'system') === 'true' ? true : undefined,
    itemKeys: asArray(itemKeys?.['Item'] as XmlNode[]).map(textOf),
  }
}
