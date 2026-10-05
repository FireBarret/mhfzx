// Browser-persisted user state: Favorites, Skill Sets, and the in-progress
// search session. All three use localStorage, not cookies -- cookies are
// capped at ~4KB and sent to a server on every request, neither of which
// fits a fully client-side app with no server to receive them; localStorage
// is the correct tool for "remember this in the browser" here.
//
// Favorites + Skill Sets mirror the original's "お気に入り" (Favorites) and
// "スキルセット" (Skill Sets) tree groups (MHSX2.SkillBaseTreeView in the
// decompiled source): Favorites is a flat list of individually-starred
// skill names; a Skill Set is a *named, saved* group of skills at their
// exact tiers (so double-clicking one restores the precise configuration
// you saved, not just the skill names at some default tier). Backed by
// localStorage rather than the user's setting.xml SkillSets/FavoriteSkills
// (which this app doesn't load yet) -- a per-browser convenience store,
// separate from the round-trip-critical settings.xml data layer.
//
// Every read/write is wrapped defensively: storage can throw or come back
// empty (private browsing, cleared site data, etc.), and this feature
// should degrade to "just empty" rather than break the page.

import type { SkillBaseEntry } from '../data/schema'

const FAVORITES_KEY = 'mhfz.favorites'
const SKILLSETS_KEY = 'mhfz.skillSets'
const SEARCH_STATE_KEY = 'mhfz.searchState'
const DEFAULTS_SEEDED_KEY = 'mhfz.defaultsSeeded'

// The original app's own setting.xml ships with these six named Skill Sets
// (skill names only -- the original format has no explicit point target per
// skill). Seeded once per browser on first load so the Skill Sets group
// isn't empty out of the box; see maybeSeedDefaultSkillSets.
const DEFAULT_SKILL_SETS: { name: string; skillNames: string[] }[] = [
  {
    name: 'Vigor Base',
    skillNames: [
      'Solid Determination',
      'Strong Attack +6',
      'Furious',
      'Thunder Clad',
      'Rush',
      'Sword God +2',
      'Vigorous',
      'Ceaseless',
      'Crit Conversion',
      'Vampirism+2',
    ],
  },
  {
    name: 'Adren Base',
    skillNames: [
      'Solid Determination',
      'Strong Attack +6',
      'Furious',
      'Thunder Clad',
      'Rush',
      'Sword God +2',
      'Ceaseless',
      'Crit Conversion',
      'Vampirism+2',
    ],
  },
  {
    name: 'Evasion Skills',
    skillNames: ['Evasion Boost', 'Drawing Arts+2', 'Starving Wolf +2'],
  },
  {
    name: 'Guard Skills',
    skillNames: ['Obscurity', 'Fortification +2', 'Reflect +3'],
  },
  {
    name: 'Damage Skills',
    skillNames: [
      'Stylish Assault',
      'Stylish',
      'Ice Age',
      'Point Breakthrough',
      'Abnormality',
      'Combat Supremacy',
      'Elemental Attack Up',
      'Lone Wolf',
      'Consumption Slayer',
      'Charge Attack Up +2',
      'Adaptation +2',
    ],
  },
  {
    name: 'Support Base',
    skillNames: [
      'Encourage +2',
      'All Res +20',
      'Skilled',
      'Blazing Majesty +2',
      'Blue Soul',
      'Abnormality',
      'Unaffected +3',
    ],
  },
]

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

/** The in-progress (not necessarily saved-as-a-Skill-Set) search state:
 * current target list, job filter, and max-results, so closing and
 * reopening the browser picks up right where you left off rather than
 * starting from a blank search every time. Distinct from Skill Sets, which
 * are deliberately-named, permanent saves. */
export interface SearchSessionState {
  targets: { skillName: string; minPoint: number }[]
  job: string
  maxResults: number
}

export function getSearchSessionState(): SearchSessionState | null {
  return readJson<SearchSessionState | null>(SEARCH_STATE_KEY, null)
}

export function saveSearchSessionState(state: SearchSessionState): void {
  writeJson(SEARCH_STATE_KEY, state)
}

/** Seeds the six Skill Sets bundled with the original app's own setting.xml
 * into localStorage, once per browser (guarded by DEFAULTS_SEEDED_KEY so it
 * never overwrites sets the user has since renamed or deleted). Each skill
 * name is resolved against the loaded skillBase to its lowest positive
 * tier, matching searchView's addTargetBySkillName default. Skill names not
 * found in the loaded data (e.g. a different package.xml revision) are
 * skipped rather than failing the whole set. */
export function maybeSeedDefaultSkillSets(skillBase: SkillBaseEntry[]): void {
  try {
    if (localStorage.getItem(DEFAULTS_SEEDED_KEY)) return
  } catch {
    return
  }
  for (const { name, skillNames } of DEFAULT_SKILL_SETS) {
    const entries: SkillSetEntry[] = []
    for (const skillName of skillNames) {
      const skill = skillBase.find((s) => s.name === skillName)
      const lowestPositive = skill?.options.filter((o) => o.point > 0).sort((a, b) => a.point - b.point)[0]
      if (!lowestPositive) continue
      entries.push({ skillName, point: lowestPositive.point, optionName: lowestPositive.name })
    }
    if (entries.length > 0) saveSkillSet(name, entries)
  }
  writeJson(DEFAULTS_SEEDED_KEY, true)
}
