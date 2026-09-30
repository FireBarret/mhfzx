// Shared helpers for the dat/*.xml importers. See docs for why the parser is
// configured this way (project plan, Phase 1/2): parseAttributeValue and
// parseTagValue are both off so numeric-looking class/rarity codes and
// significant fullwidth text are never silently coerced or mangled — every
// field this codebase treats as a number is converted explicitly, here, not
// by the parser's own type inference.

import { XMLParser } from 'fast-xml-parser'

export const ATTR_PREFIX = '@_'
export const TEXT_KEY = '#text'

/** A node that's either plain text (no attributes) or `{ '#text': ..., '@_Foo': ... }`. */
export type XmlNode = string | number | Record<string, unknown> | undefined

export type IsArrayRule = Set<string> | ((tagName: string, jPath: string) => boolean)

export function makeParser(arrayRule: IsArrayRule): XMLParser {
  const test = arrayRule instanceof Set ? (tagName: string) => arrayRule.has(tagName) : arrayRule
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    parseAttributeValue: false,
    parseTagValue: false,
    textNodeName: TEXT_KEY,
    // fast-xml-parser's own type allows jPath to be a richer "matcher" object
    // in some modes; we only ever use it in plain-string-jPath mode, so this
    // wrapper narrows it back to the (tagName, jPath) shape our rules expect.
    isArray: (tagName, jPath) => test(tagName, String(jPath)),
  })
}

/** Always returns an array, even if the parser handed back a single bare object. */
export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Extracts the text content of a node, whether it's a bare string or `{ '#text': ... }`. */
export function textOf(node: XmlNode): string {
  if (node === undefined) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  const text = (node as Record<string, unknown>)[TEXT_KEY]
  return text === undefined ? '' : String(text)
}

/** Reads a required numeric attribute (`node['@_Foo']`). Throws on missing/NaN
 * rather than silently defaulting, since a malformed dat file should surface
 * loudly during import, not produce a silently-wrong loadout later. */
export function attrNum(node: Record<string, unknown>, name: string): number {
  const raw = node[ATTR_PREFIX + name]
  const num = Number(raw)
  if (raw === undefined || Number.isNaN(num)) {
    throw new Error(`expected numeric attribute ${name}, got ${JSON.stringify(raw)}`)
  }
  return num
}

export function attrNumOpt(node: Record<string, unknown>, name: string): number | undefined {
  const raw = node[ATTR_PREFIX + name]
  if (raw === undefined) return undefined
  const num = Number(raw)
  if (Number.isNaN(num)) throw new Error(`expected numeric attribute ${name}, got ${JSON.stringify(raw)}`)
  return num
}

export function attrStr(node: Record<string, unknown>, name: string): string {
  const raw = node[ATTR_PREFIX + name]
  if (raw === undefined) throw new Error(`expected attribute ${name} on ${JSON.stringify(node)}`)
  return String(raw)
}

export function attrStrOpt(node: Record<string, unknown>, name: string): string | undefined {
  const raw = node[ATTR_PREFIX + name]
  return raw === undefined ? undefined : String(raw)
}

/** Validates that a string is one of a known enum's values, throwing loudly
 * rather than silently mistyping — a future dat/ update introducing a new
 * Job/Sex/Platform/etc. value should surface immediately during import, not
 * produce a mistyped record that fails later in some unrelated place. */
export function assertOneOf<T extends string>(value: string, allowed: readonly T[], context: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${context}: unexpected value ${JSON.stringify(value)}, expected one of ${allowed.join(', ')}`)
  }
  return value as T
}

/** Strips a UTF-8 BOM if present. Confirmed some dat/conf/tag files have one
 * and some don't (see docs/rules-spec.md context) — always check defensively
 * rather than assuming per file. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
