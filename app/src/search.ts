// Thin typed wrapper over the compiled Rust/WASM search (rust-core/src/search.rs,
// exported as `search` from the `mhfz-core` package). Measured at ~1-7ms
// against the full real dataset (see rust-core/tests/real_data_search.rs),
// so this runs synchronously on the main thread rather than through a Web
// Worker — fast enough that the added plumbing isn't worth it for a single
// search call. Revisit if a future feature needs many searches at once.

import { search as searchWasm } from 'mhfz-core'
import type { Elemental, GameData, Job, SkillName } from './data/schema'

export interface SearchTarget {
  skillName: SkillName
  minPoint: number
}

export type JobFilter = 'Both' | 'Blademaster' | 'Gunner'

/** A fixed piece for one equip slot, with 0-3 of its own decorations
 * already attached (by exact name) -- mirrors the original's
 * `Equipment.GetFixedJewelys()`: the search never substitutes this piece
 * and treats its preset decorations as already placed, filling only the
 * capacity (if any) left over. */
export interface PiecePreset {
  name: string
  decorations: string[]
}

export interface SearchPresets {
  head?: PiecePreset
  body?: PiecePreset
  arm?: PiecePreset
  waist?: PiecePreset
  leg?: PiecePreset
  weapon?: PiecePreset
}

export interface SearchRequest {
  targets: SearchTarget[]
  job: JobFilter
  maxResults: number
  /** `EquipData.equipType` values the search may choose for non-preset
   * armor slots -- empty/omitted means unfiltered. Never restricts a preset
   * slot (the caller already chose that piece explicitly). */
  equipTypes?: string[]
  presets?: SearchPresets
}

export interface FoundSkill {
  skillName: SkillName
  optionName: string
  point: number
  /** True for a skill granted via a Senyu (遷悠) ability -- pre-satisfied,
   * not a tiered-lookup result from a raw point sum. The original's
   * equipment-clip export lists these in their own "passive skills"
   * section, separate from regular active skills (see equipClip.ts). */
  fromSenyu: boolean
}

export interface FoundSet {
  weapon: string | null
  head: string
  body: string
  arm: string
  waist: string
  leg: string
  /** Every decoration used in this set, flattened across all 6 slots. */
  decorations: string[]
  /** The same decorations, broken out per slot (mirrors the original
   * equipment-clip export's per-piece decoration display) -- empty when
   * that slot has no decorations. */
  weaponDecorations: string[]
  headDecorations: string[]
  bodyDecorations: string[]
  armDecorations: string[]
  waistDecorations: string[]
  legDecorations: string[]
  totalDefense: number
  resistances: Elemental
  /** Distinct Teni-tree skill names present on this loadout (membership
   * only) -- the original's equipment-clip export lists these in their own
   * section, separate from regular active skills. */
  teniSkillNames: string[]
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
