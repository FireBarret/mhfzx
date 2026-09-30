// Hand-rolled XML writing helpers for the round-trip-critical files
// (tag/*.xml, setting/allows.xml, setting/ignore.xml, setting/setting.xml).
// These are purpose-built rather than routed through a generic XML library:
// the original files are .NET XmlSerializer output with an exact, narrow set
// of conventions (CRLF line endings, no trailing newline, 2-space indent,
// self-closing empty elements written as `<Tag />` with a space before `/>`,
// no BOM) that's easier to reproduce byte-for-byte by construction than to
// coax out of a general-purpose serializer's own formatting options.

export const CRLF = '\r\n'

/** The `xsi`/`xsd` schema-instance namespace declarations .NET's
 * XmlSerializer puts on the root element of most (but not all — tag/*.xml
 * notably doesn't) of these config files. */
export const XSI_XSD_NS = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"'

/** Escapes text for use inside an XML text node. Minimal on purpose — this
 * matches what .NET's XmlWriter escapes in element text (not attribute
 * values, which these files don't need for their text-list contents). */
export function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Renders a `<Tag>...</Tag>` element wrapping a list of `<childTag>` text
 * entries, self-closing when empty, matching the exact indentation depth
 * observed in real files. `childTag` is `"string"` for allows.xml/ignore.xml
 * lists but `"Item"` for tag/*.xml's `<ItemKeys>` — real, not interchangeable. */
export function renderStringListElement(
  tagName: string,
  values: string[],
  indent: string,
  childTag: string = 'string',
): string {
  if (values.length === 0) return `${indent}<${tagName} />`
  const inner = values.map((v) => `${indent}  <${childTag}>${escapeXmlText(v)}</${childTag}>`).join(CRLF)
  return `${indent}<${tagName}>${CRLF}${inner}${CRLF}${indent}</${tagName}>`
}
