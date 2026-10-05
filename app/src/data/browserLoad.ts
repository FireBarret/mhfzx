// Loads a GameData from a browser folder selection (<input webkitdirectory>).
// The user points this at their MHSX2G install root (the folder containing
// dat/ and conf/ directly) — matched by path suffix so it works regardless
// of what the root folder itself is named.

import { assembleGameData, type GameDataSourceFiles } from './import/gameData'
import type { GameData } from './schema'

const REQUIRED_SUFFIXES: Record<keyof GameDataSourceFiles, string> = {
  equipHead: '/dat/EquipHead.xml',
  equipBody: '/dat/EquipBody.xml',
  equipArm: '/dat/EquipArm.xml',
  equipWaist: '/dat/EquipWst.xml',
  equipLeg: '/dat/EquipLeg.xml',
  weapon: '/dat/Weapon.xml',
  jewel: '/dat/Jewel.xml',
  skillCuff: '/dat/SkillCuff.xml',
  skillBase: '/dat/SkillBase.xml',
  teniSkillBase: '/dat/TeniSkillBase.xml',
  define: '/conf/Define.xml',
  clothes: '/conf/Clothes.xml',
}

export class MissingFilesError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`Selected folder is missing: ${missing.join(', ')}`)
    this.missing = missing
  }
}

export async function loadGameDataFromFileList(files: FileList): Promise<GameData> {
  const byPath = new Map<string, File>()
  for (const file of Array.from(files)) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    byPath.set(path, file)
  }

  const found: Partial<Record<keyof GameDataSourceFiles, File>> = {}
  const missing: string[] = []
  for (const [key, suffix] of Object.entries(REQUIRED_SUFFIXES) as [keyof GameDataSourceFiles, string][]) {
    const match = Array.from(byPath.entries()).find(([path]) => path.replace(/\\/g, '/').endsWith(suffix))
    if (match) {
      found[key] = match[1]
    } else {
      missing.push(suffix)
    }
  }
  if (missing.length > 0) {
    throw new MissingFilesError(missing)
  }

  const entries = await Promise.all(
    (Object.entries(found) as [keyof GameDataSourceFiles, File][]).map(
      async ([key, file]) => [key, await file.text()] as const,
    ),
  )
  const sourceFiles = Object.fromEntries(entries) as unknown as GameDataSourceFiles
  return assembleGameData(sourceFiles)
}
