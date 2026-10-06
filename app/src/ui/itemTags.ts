// Browser-persisted "already have" tags on armor/weapon/jewel/skill-cuff
// items, for the Data Browser's tagging feature and the Search tab's "only
// use tagged items" filter. Mirrors the original's tag/*.xml shape (`Tag`
// in data/schema.ts: id, name, a flat list of item display names) so a
// future export can reuse data/export/tagFile.ts unchanged -- this module
// only owns the localStorage-backed working copy, not the file format.
//
// Every read/write is wrapped defensively, same convention as
// skillGroups.ts: storage can throw or come back empty, and this feature
// should degrade to "just empty" rather than break the page.

const TAGS_KEY = 'mhfz.itemTags'

export interface ItemTag {
  id: number
  name: string
  itemKeys: string[]
}

function readTags(): ItemTag[] {
  try {
    const raw = localStorage.getItem(TAGS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ItemTag[]
  } catch {
    return []
  }
}

function writeTags(tags: ItemTag[]): void {
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(tags))
  } catch {
    // Storage unavailable/full -- the in-memory change still applies for
    // this page load, it just won't persist.
  }
}

export function getTags(): ItemTag[] {
  return readTags()
}

export function getAllTagNames(): string[] {
  return readTags()
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b))
}

export function getTagNamesForItem(itemName: string): string[] {
  return readTags()
    .filter((t) => t.itemKeys.includes(itemName))
    .map((t) => t.name)
}

/** Replaces the full set of tags an item belongs to with `tagNames`:
 * creates any tag name that doesn't exist yet, adds/removes `itemName` from
 * each tag's membership as needed, and prunes any tag left with zero
 * members afterward (including ones this call just emptied). */
export function setTagsForItem(itemName: string, tagNames: string[]): void {
  const wanted = new Set(tagNames.map((n) => n.trim()).filter((n) => n.length > 0))
  const tags = readTags()
  const byName = new Map(tags.map((t) => [t.name, t]))

  for (const tag of tags) {
    const shouldHave = wanted.has(tag.name)
    const has = tag.itemKeys.includes(itemName)
    if (shouldHave && !has) tag.itemKeys.push(itemName)
    if (!shouldHave && has) tag.itemKeys = tag.itemKeys.filter((n) => n !== itemName)
  }

  let nextId = tags.reduce((max, t) => Math.max(max, t.id), 0) + 1
  for (const name of wanted) {
    if (!byName.has(name)) {
      const created: ItemTag = { id: nextId++, name, itemKeys: [itemName] }
      tags.push(created)
      byName.set(name, created)
    }
  }

  writeTags(tags.filter((t) => t.itemKeys.length > 0))
}

export function deleteTag(tagName: string): void {
  writeTags(readTags().filter((t) => t.name !== tagName))
}

/** The item names tagged with `tagName`, or `null` when `tagName` is
 * empty/unselected (meaning "no filter" to callers). */
export function getItemNamesForTag(tagName: string): string[] | null {
  if (!tagName) return null
  return readTags().find((t) => t.name === tagName)?.itemKeys ?? []
}

/** Merges imported tag lists (e.g. from the original app's tag/*.xml) into the
 * store. A tag that already exists by name gets the imported items unioned
 * into its membership; a new name is appended with a fresh id. Returns how
 * many distinct tag names were touched. */
export function importTags(imported: { name: string; itemKeys: string[] }[]): number {
  const tags = readTags()
  let nextId = tags.reduce((max, t) => Math.max(max, t.id), 0) + 1
  const byName = new Map(tags.map((t) => [t.name, t]))
  for (const { name, itemKeys } of imported) {
    const existing = byName.get(name)
    if (existing) {
      existing.itemKeys = Array.from(new Set([...existing.itemKeys, ...itemKeys]))
    } else {
      const created: ItemTag = { id: nextId++, name, itemKeys: Array.from(new Set(itemKeys)) }
      tags.push(created)
      byName.set(name, created)
    }
  }
  writeTags(tags.filter((t) => t.itemKeys.length > 0))
  return imported.length
}
