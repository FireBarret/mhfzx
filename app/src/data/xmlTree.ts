// A generic, order-preserving XML tree — parse any of these config files
// into a structure that captures *everything* (including inter-element
// whitespace as literal text nodes), so re-serializing an untouched tree
// reproduces the original byte-for-byte with zero custom formatting logic.
//
// This is the "opaque passthrough" mechanism the project plan's Phase 2
// calls for: setting/setting.xml has dozens of fields, many of them pure UI
// layout state (window bounds, grid column widths) nobody needs to interpret
// — rather than hand-modeling every one of them (as the smaller, fully-typed
// tag/*.xml and allows.xml/ignore.xml exporters do), this module lets typed
// accessors read/mutate only the handful of fields the app actually cares
// about, while everything else round-trips through unchanged automatically.
//
// Built on fast-xml-parser's `preserveOrder` mode (which is confirmed, by a
// full-file round-trip test against the real setting.xml, to capture enough
// information to reconstruct the original exactly) but with its own tiny
// serializer rather than fast-xml-parser's XMLBuilder — XMLBuilder's own
// `format: true` output inserts spurious blank lines around every
// preserveOrder array element and normalizes line endings to LF, neither of
// which matches the original .NET XmlSerializer output.

import { XMLParser } from 'fast-xml-parser'

export interface XmlTextNode {
  text: string
}

export interface XmlElementNode {
  tag: string
  /** Insertion-order-preserved (a plain object's string keys iterate in
   * insertion order in JS, which is all the ordering guarantee these files'
   * attributes need). */
  attrs: Record<string, string>
  children: XmlNode[]
}

export type XmlNode = XmlTextNode | XmlElementNode

export function isElement(node: XmlNode): node is XmlElementNode {
  return 'tag' in node
}

const ATTR_PREFIX = '@_'

// fast-xml-parser's preserveOrder shape: an array of nodes, each either
// `{ '#text': string }` or `{ [tagName]: PreserveOrderNode[], ':@'?: Record<string,string> }`.
type RawNode = Record<string, unknown>

function fromRaw(raw: RawNode): XmlNode {
  if (Object.prototype.hasOwnProperty.call(raw, '#text')) {
    return { text: String(raw['#text']) }
  }
  const tag = Object.keys(raw).find((k) => k !== ':@')
  if (tag === undefined) throw new Error(`malformed preserveOrder node: ${JSON.stringify(raw)}`)
  const rawAttrs = (raw[':@'] as Record<string, string> | undefined) ?? {}
  const attrs: Record<string, string> = {}
  for (const [k, v] of Object.entries(rawAttrs)) {
    attrs[k.slice(ATTR_PREFIX.length)] = v
  }
  const rawChildren = raw[tag] as RawNode[]
  return { tag, attrs, children: rawChildren.map(fromRaw) }
}

/** Parses XML text into an ordered tree, including the leading `<?xml ...?>`
 * declaration as its own element node (tag `"?xml"`) at the top level. */
export function parseXmlTree(xmlText: string): XmlNode[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    preserveOrder: true,
    trimValues: false,
    parseAttributeValue: false,
    parseTagValue: false,
  })
  const raw = parser.parse(xmlText) as RawNode[]
  return raw.map(fromRaw)
}

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeXmlAttr(text: string): string {
  return escapeXmlText(text).replace(/"/g, '&quot;')
}

function serializeNode(node: XmlNode): string {
  if (!isElement(node)) return escapeXmlText(node.text)
  const attrStr = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join('')
  if (node.tag === '?xml') return `<?xml${attrStr}?>`
  if (node.children.length === 0) return `<${node.tag}${attrStr} />`
  const inner = node.children.map(serializeNode).join('')
  return `<${node.tag}${attrStr}>${inner}</${node.tag}>`
}

/** Serializes a tree back to XML text, reproducing the source's exact CRLF
 * line endings (the parser normalizes CRLF -> LF internally, per the XML
 * spec's line-ending-normalization rule, so this reverses that once at the
 * end rather than trying to preserve raw bytes through the parse). */
export function serializeXmlTree(nodes: XmlNode[]): string {
  return nodes
    .map(serializeNode)
    .join('\n')
    .replace(/\n/g, '\r\n')
}

// --- Navigation/mutation helpers for typed accessors built on this tree ---

export function findChild(parent: XmlElementNode, tag: string): XmlElementNode | undefined {
  return parent.children.find((c): c is XmlElementNode => isElement(c) && c.tag === tag)
}

export function findChildren(parent: XmlElementNode, tag: string): XmlElementNode[] {
  return parent.children.filter((c): c is XmlElementNode => isElement(c) && c.tag === tag)
}

/** Concatenates all direct text-node children (a leaf element like
 * `<ThreadNum>6</ThreadNum>` has exactly one). */
export function getText(el: XmlElementNode): string {
  return el.children
    .filter((c): c is XmlTextNode => !isElement(c))
    .map((c) => c.text)
    .join('')
}

/** Replaces a leaf element's text content in place. If the element currently
 * has exactly one text child, that node's value is mutated (preserving any
 * surrounding structure); otherwise its children are replaced with a single
 * new text node. */
export function setText(el: XmlElementNode, newText: string): void {
  const textChildren = el.children.filter((c): c is XmlTextNode => !isElement(c))
  if (textChildren.length === 1 && el.children.length === 1) {
    textChildren[0].text = newText
  } else {
    el.children = [{ text: newText }]
  }
}

export function getRoot(tree: XmlNode[]): XmlElementNode {
  const root = tree.find((n): n is XmlElementNode => isElement(n) && n.tag !== '?xml')
  if (!root) throw new Error('no root element found in XML tree')
  return root
}
