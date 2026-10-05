// Attempts to auto-load a bundled "default" dat/+conf/ data set from
// public/default-data/ (committed to the repo, ships with both local builds
// and the GitHub Pages deploy -- see README) so the app is immediately
// usable on startup without requiring "Load Data Folder" every time.
// Returns null (not a thrown error) when the files aren't present, so a
// fork that removes the folder just falls back to the manual folder picker
// silently.

import { assembleGameData, type GameDataSourceFiles } from './import/gameData'
import type { GameData } from './schema'

// Relative to Vite's configured base path (import.meta.env.BASE_URL), not
// hardcoded to domain root -- a GitHub Pages *project* site is served from
// /<repo>/, not /, so an absolute "/default-data/..." path would silently
// 404 there even though it works fine locally at root. See vite.config.ts's
// `base` setting (and its own comment) for where that prefix comes from.
const BASE = import.meta.env.BASE_URL
const DEFAULT_DATA_PATHS: Record<keyof GameDataSourceFiles, string> = {
  equipHead: `${BASE}default-data/dat/EquipHead.xml`,
  equipBody: `${BASE}default-data/dat/EquipBody.xml`,
  equipArm: `${BASE}default-data/dat/EquipArm.xml`,
  equipWaist: `${BASE}default-data/dat/EquipWst.xml`,
  equipLeg: `${BASE}default-data/dat/EquipLeg.xml`,
  weapon: `${BASE}default-data/dat/Weapon.xml`,
  jewel: `${BASE}default-data/dat/Jewel.xml`,
  skillCuff: `${BASE}default-data/dat/SkillCuff.xml`,
  skillBase: `${BASE}default-data/dat/SkillBase.xml`,
  teniSkillBase: `${BASE}default-data/dat/TeniSkillBase.xml`,
  define: `${BASE}default-data/conf/Define.xml`,
  clothes: `${BASE}default-data/conf/Clothes.xml`,
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
