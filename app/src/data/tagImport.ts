// Reads the original app's tag/*.xml lists (plus its "-- Additional Tag
// Files --" pack) out of a selected install folder and merges them into the
// browser's tag store. Best-effort: a folder without any tag files simply
// imports nothing, same as a missing conf/Clothes.xml.

import { importTags } from '../ui/itemTags'
import { parseTagFile } from './import/tagFile'

function isTagFile(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  return p.endsWith('.xml') && (p.includes('/tag/') || p.includes('Additional Tag Files'))
}

export async function loadTagsFromFileList(files: FileList): Promise<number> {
  const tagFiles = Array.from(files).filter((f) => {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    return isTagFile(path)
  })
  const parsed = await Promise.all(
    tagFiles.map(async (f) => {
      try {
        return parseTagFile(await f.text())
      } catch {
        return null // one malformed file shouldn't block the rest
      }
    }),
  )
  const lists = parsed
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .map((t) => ({ name: t.name, itemKeys: t.itemKeys }))
  return importTags(lists)
}
