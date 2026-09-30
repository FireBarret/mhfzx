// Domain types mirroring the confirmed dat/*.xml / conf/*.xml shapes (see the
// project plan's Phase 2, and rust-core/src/schema.rs for the Rust mirror
// used by the evaluator/search engine). All identity is by exact name
// string, never a synthetic id — this matches how tag/allow/ignore/alias
// files already reference equipment, and keeps XML round-tripping honest.
// No Unicode normalization is ever applied to these strings.

export type EquipName = string
export type SkillName = string

export type Job = '共' | '剣士' | 'ガンナー'
export type Sex = '共' | '女' | '男'
export type Platform = 'PS3' | 'PS4' | 'Wii'
export type CostType = 'create' | 'upgrade'

export interface Elemental {
  fire: number
  water: number
  thunder: number
  ice: number
  dragon: number
}

export interface CostItem {
  name: string
  num: number
}

export interface Cost {
  money: number
  /** Absent when a level has no associated craft/upgrade action (observed on
   * real data: a free base weapon's `<Cost Money="0" />` carries no `Type`). */
  costType?: CostType
  items: CostItem[]
}

/** One `Ability Type="...">text</Ability>` rung. For Senyu (スキル発動) and
 * Teni (Skill Slots Up / スキル強化) ability types, the element's text
 * content names a specific skill/tag (e.g. `<Ability Type="スキル発動">Speed
 * Eater</Ability>`) — see docs/rules-spec.md §1/§4. `name` captures that raw
 * text when present; resolving it to a full `SkillOption` (with a point
 * value) requires cross-referencing another source not yet identified during
 * import, so it's left as a plain string here rather than guessed. */
export interface Ability {
  typeName: string
  name?: string
}

/** One `Skill Point="N">Name` entry. Order matters: the first 5 entries in
 * document order are what the original UI calls "Skill 1..5". */
export interface SkillContribution {
  skillName: SkillName
  point: number
}

/** One `Lx Def="..." Slot="...">` level rung. Weapons use `atk` instead of `def`. */
export interface LevelEntry {
  level: number // 1..=7
  def?: number
  atk?: number
  slot: number
  cost: Cost
}

export interface EquipData {
  name: EquipName
  class: string // one of the 39 bracket codes, e.g. "(GX)"
  rare: number
  job: Job
  sex: Sex
  equipType: string // Exotic / G Rank Armour / GS Armour / Origin / Tower / Zenith / Zenith (ZP)
  gr?: number
  platform?: Platform
  elemental: Elemental
  levels: LevelEntry[]
  abilities: Ability[]
  skills: SkillContribution[]
}

export type EquipSlotCategory = 'Head' | 'Body' | 'Arm' | 'Waist' | 'Leg' | 'Weapon'

/** A `<Source Type="Head">Equip Name</Source>` entry — real data shows many
 * jewels are granted by specific armor pieces (a "set decoration") rather
 * than purchased/crafted, independently of whether the jewel also has a
 * `Cost` (nearly half of dat/Jewel.xml's records carry `Sources`, and it's
 * not mutually exclusive with `Cost` — confirmed by direct inspection, not
 * assumed from the original small sample read). */
export interface JewelSource {
  part: string // Source/@Type, e.g. "Head" | "Body" | "Arm" | "Waist" | "Leg"
  equipName: EquipName
}

export interface JewelData {
  name: EquipName
  /** Present only on "set/SP" jewels (the ones with `Sources`) — a bracket
   * class code like equipment's, e.g. "(GX)". Absent on plain craftable jewels. */
  class?: string
  job: Job
  rare: number
  slot: number
  skills: SkillContribution[] // may include negative-point side skills
  /** Zero or more *alternative* crafting recipes — confirmed by direct
   * inspection: e.g. "Artisan Deco" has two independent `<Cost>` siblings,
   * either of which crafts the same jewel. Empty for jewels obtained only
   * via `sources`. */
  costs: Cost[]
  sources: JewelSource[] // empty for plain craftable jewels
}

export type SkillCuffFamily = 'Power' | 'Skill' // <P> vs <S> section

export interface SkillCuffData {
  name: EquipName
  family: SkillCuffFamily
  class: string // e.g. "(P)", "(S_辿)", "(秘)"
  rare: number
  slot: number
  skills: SkillContribution[]
  /** Zero or more *alternative* crafting recipes (a handful of real records
   * have more than one `<Cost>` sibling — see `JewelData.costs`). */
  costs: Cost[]
  abilities: Ability[]
}

/** One rung of a SkillBase.xml `Option Name Point` ladder. */
export interface SkillOption {
  name: string
  point: number
}

export interface SkillBaseEntry {
  no: number
  id: string
  name: SkillName
  skillRank: boolean // present-and-"1" in source XML; modeled as a flag
  options: SkillOption[] // descending point ladder, +max down to negative
}

/** One rung of a TeniSkillBase.xml `SkillTree` ladder — structurally distinct
 * from SkillBaseEntry (see docs/rules-spec.md §4). */
export interface TeniSkillTree {
  no: number
  id: string
  name: string
  target?: string // links to a base Weapon ability name, when present
  rungs: SkillOption[] // e.g. "Skill Slots Up+7" .. "+1"
}

export interface WeaponData {
  name: EquipName
  job: Job
  sex: Sex
  rare: number
  elemental: Elemental
  levels: LevelEntry[]
  abilities: Ability[]
  skills: SkillContribution[]
}

/** conf/Define.xml's ABILITY_TYPE_* label strings + MAX_SKILL_LIMIT_UP, read
 * at import time and never hardcoded (see docs/rules-spec.md §1). */
export interface AbilityTypeLabels {
  gclassEffect: string // ABILITY_TYPE_GCLASS_EFFECT, "Ｇ級効果"
  skillUp: string // ABILITY_TYPE_SKILL_UP, "スキルUP"
  activateSkill: string // ABILITY_TYPE_ACTIVATE_SKILL, "スキル発動" (Senyu)
  attachableSpJewels: string // ABILITY_TYPE_ATTACHABLE_SPJEWELS
  skillLimitUp: string // ABILITY_TYPE_SKILL_LIMIT_UP, "Skill Slots Up" (Teni)
  skillUpgrade: string // ABILITY_TYPE_SKILL_UPGRADE, "スキル強化" (Teni)
  nocountSkill: string // ABILITY_TYPE_NOCOUNT_SKILL, "スキル枠消費なし"
  maxSkillLimitUp: number // MAX_SKILL_LIMIT_UP, confirmed 7
}

export interface GameData {
  head: EquipData[]
  body: EquipData[]
  arm: EquipData[]
  waist: EquipData[]
  leg: EquipData[]
  weapons: WeaponData[]
  jewels: JewelData[]
  skillCuffs: SkillCuffData[]
  skillBase: SkillBaseEntry[]
  teniSkillBase: TeniSkillTree[]
  abilityTypes: AbilityTypeLabels
}
