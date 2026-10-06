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
  /** Resolved Zenith/Teni rung (name + point) for Skill Slots Up / スキル強化
   * abilities -- filled in by assembleGameData from dat/TeniSkillBase.xml,
   * since the item XML only names the rung, not its point value. */
  tag?: SkillOption
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

/** Mirrors the decompiled `SkillCuffCategory` enum: a "Hiden" (秘伝, class
 * "(秘)") cuff is a special bonus slot that doesn't consume the clothes'
 * own `slot` capacity at all (confirmed in the decompiled
 * `PigClothes.GetFilledSlotNum`, which explicitly excludes Hiden cuffs from
 * the capacity sum) — every other class is "Normal" and does consume it.
 * Derived at import time from `class === '(秘)'`, not a separate XML field. */
export type SkillCuffCategory = 'Normal' | 'Hiden'

export interface SkillCuffData {
  name: EquipName
  family: SkillCuffFamily
  category: SkillCuffCategory
  class: string // e.g. "(P)", "(S_辿)", "(秘)"
  rare: number
  slot: number
  skills: SkillContribution[]
  /** Zero or more *alternative* crafting recipes (a handful of real records
   * have more than one `<Cost>` sibling — see `JewelData.costs`). */
  costs: Cost[]
  abilities: Ability[]
}

/** conf/Clothes.xml: the "layered outfit" item a hunter wears to gain 2
 * skill-cuff slots (decompiled `PigClothes`/`ClothesData`) -- a small,
 * separate equip slot from the 5 armor pieces + weapon. `sRestricted` mirrors
 * `ClothesData.SetableCuffSeriesType` (set from the XML's `Type="S"` vs
 * `Type="P"` attribute, decompiled `BaseData.LoadClothes`): when true, only
 * `family: 'Skill'` cuffs may be attached; `Type="P"` clothes (`sRestricted:
 * false`) impose no family restriction at all (verified against
 * `PigClothes.SetJewelry`'s `SetableCuffSeriesType != 0` check, where
 * `SkillCuffSeriesType.P == 0`). */
export interface ClothesData {
  name: EquipName
  slot: number
  sRestricted: boolean
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
  /** The enclosing `<SkillType TypeName="...">` group this skill came from
   * in document order, e.g. "Health and Stamina", "Offense and Adren" —
   * this *is* the original app's skill-category tree grouping (see
   * `MHSX2.SkillBaseTreeView.LoadBaseData`'s `SkillCategoryList`/
   * `SkillCategory` index pair in the decompiled source), not an invented
   * categorization. */
  category: string
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

/** A `tag/*.xml` file (or an entry from the sibling `-- Additional Tag
 * Files --/` pack) — a user-defined (or `system="true"` built-in) named
 * collection referencing equipment by exact display name. */
export interface Tag {
  id: number
  name: string
  system?: boolean
  itemKeys: string[]
}

/** `setting/allows.xml` — plain exact-name allow-lists per category. */
export interface Allows {
  equip: string[]
  jewelry: string[]
  skillCuff: string[]
  tag: string[]
}

/** `setting/ignore.xml` — plain exact-name/class-code deny-lists per
 * category. Note `skill` is lowercase in the source XML (a real quirk, not
 * a typo to "fix") while every other section is PascalCase. */
export interface Ignore {
  equip: string[]
  jewelry: string[]
  skill: string[]
  class: string[]
  classJewelry: string[]
  skillCuff: string[]
  item: string[]
  tag: string[]
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
  clothes: ClothesData[]
  skillBase: SkillBaseEntry[]
  teniSkillBase: TeniSkillTree[]
  abilityTypes: AbilityTypeLabels
}
