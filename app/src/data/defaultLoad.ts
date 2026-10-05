// Attempts to auto-load a bundled "default" dat/+conf/ data set from
// public/default-data/ (gitignored -- each local checkout copies its own
// copy there; see README) so the app is immediately usable on startup
// without requiring "Load Data Folder" every time. Returns null (not a
// thrown error) when the files aren't present, so a fresh clone or a future
// GitHub Pages deploy without bundled data just falls back to the manual
// folder picker silently.

import { assembleGameData, type GameDataSourceFiles } from './import/gameData'
import type { GameData } from './schema'

const DEFAULT_DATA_PATHS: Record<keyof GameDataSourceFiles, string> = {
  equipHead: '/default-data/dat/EquipHead.xml',
  equipBody: '/default-data/dat/EquipBody.xml',
  equipArm: '/default-data/dat/EquipArm.xml',
  equipWaist: '/default-data/dat/EquipWst.xml',
  equipLeg: '/default-data/dat/EquipLeg.xml',
  weapon: '/default-data/dat/Weapon.xml',
  jewel: '/default-data/dat/Jewel.xml',
  skillCuff: '/default-data/dat/SkillCuff.xml',
  skillBase: '/default-data/dat/SkillBase.xml',
  teniSkillBase: '/default-data/dat/TeniSkillBase.xml',
  define: '/default-data/conf/Define.xml',
}

async function fetchText(path: string): Promise<string | null> {
  try {
    const res = await fetch(path)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

export async function tryLoadDefaultGameData(): Promise<GameData | null> {
  const entries = await Promise.all(
    (Object.entries(DEFAULT_DATA_PATHS) as [keyof GameDataSourceFiles, string][]).map(
      async ([key, path]) => [key, await fetchText(path)] as const,
    ),
  )
  if (entries.some(([, text]) => text === null)) return null
  const sourceFiles = Object.fromEntries(entries) as unknown as GameDataSourceFiles
  return assembleGameData(sourceFiles)
}
