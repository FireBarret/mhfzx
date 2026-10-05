// Favorites + Skill Sets — mirrors the original's "お気に入り" (Favorites)
// and "スキルセット" (Skill Sets) tree groups (MHSX2.SkillBaseTreeView in the
// decompiled source): Favorites is a flat list of individually-starred
// skill names; a Skill Set is a *named, saved* group of skills at their
// exact tiers (so double-clicking one restores the precise configuration
// you saved, not just the skill names at some default tier).
//
// Backed by localStorage rather than the user's setting.xml SkillSets/
// FavoriteSkills (which this app doesn't load yet) -- a per-browser
// convenience store, separate from the round-trip-critical settings.xml
// data layer. Every read/write is wrapped defensively: storage can throw or
// come back empty (private browsing, cleared site data, etc.), and this
// feature should degrade to "just empty" rather than break the page.

const FAVORITES_KEY = 'mhfz.favorites'
const SKILLSETS_KEY = 'mhfz.skillSets'

export interface SkillSetEntry {
  skillName: string
  point: number
  optionName: string
}

export interface SkillSet {
  name: string
  entries: SkillSetEntry[]
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable or full -- the in-memory change still applies for
    // this page load, it just won't persist. Not worth surfacing an error
    // for a convenience feature.
  }
}

export function getFavorites(): string[] {
  return readJson<string[]>(FAVORITES_KEY, [])
}

export function toggleFavorite(skillName: string): string[] {
  const current = getFavorites()
  const next = current.includes(skillName) ? current.filter((n) => n !== skillName) : [...current, skillName]
  writeJson(FAVORITES_KEY, next)
  return next
}

export function getSkillSets(): SkillSet[] {
  return readJson<SkillSet[]>(SKILLSETS_KEY, [])
}

export function saveSkillSet(name: string, entries: SkillSetEntry[]): SkillSet[] {
  const current = getSkillSets().filter((s) => s.name !== name)
  const next = [...current, { name, entries }]
  writeJson(SKILLSETS_KEY, next)
  return next
}

export function deleteSkillSet(name: string): SkillSet[] {
  const next = getSkillSets().filter((s) => s.name !== name)
  writeJson(SKILLSETS_KEY, next)
  return next
}
