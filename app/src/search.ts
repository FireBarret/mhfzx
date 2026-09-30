// Thin typed wrapper over the compiled Rust/WASM search (rust-core/src/search.rs,
// exported as `search` from the `mhfz-core` package). Measured at ~1-7ms
// against the full real dataset (see rust-core/tests/real_data_search.rs),
// so this runs synchronously on the main thread rather than through a Web
// Worker — fast enough that the added plumbing isn't worth it for a single
// search call. Revisit if a future feature needs many searches at once.

import { search as searchWasm } from 'mhfz-core'
import type { GameData, Job, SkillName } from './data/schema'

export interface SearchTarget {
  skillName: SkillName
  minPoint: number
}

export type JobFilter = 'Both' | 'Blademaster' | 'Gunner'

export interface SearchRequest {
  targets: SearchTarget[]
  job: JobFilter
  maxResults: number
}

export interface FoundSkill {
  skillName: SkillName
  optionName: string
  point: number
}

export interface FoundSet {
  weapon: string | null
  head: string
  body: string
  arm: string
  waist: string
  leg: string
  decorations: string[]
  totalDefense: number
  activeSkills: FoundSkill[]
}

export function runSearch(gameData: GameData, request: SearchRequest): FoundSet[] {
  return searchWasm(gameData, request) as FoundSet[]
}

/** Maps this app's own `Job` (the Japanese XML-data values) to the search's
 * plain-English job filter, for UI code that already has a `Job` value on
 * hand (e.g. from an equipment row) and wants to search "more like this". */
export function jobToFilter(job: Job): JobFilter {
  if (job === '剣士') return 'Blademaster'
  if (job === 'ガンナー') return 'Gunner'
  return 'Both'
}
