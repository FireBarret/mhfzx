//! Domain types mirroring the confirmed `dat/*.xml` / `conf/*.xml` shapes.
//!
//! Field shapes are taken directly from the schema survey in the project plan
//! (see docs/rules-spec.md for the game-logic rules that operate on these types).
//! All identity is by exact name string, never a synthetic id — this matches how
//! tag/allow/ignore/alias files already reference equipment, and keeps XML
//! round-tripping honest.

use serde::{Deserialize, Serialize};

pub type EquipName = String;
pub type SkillName = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Job {
    Both,        // 共
    Blademaster, // 剣士
    Gunner,      // ガンナー
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Sex {
    Both,   // 共
    Female, // 女
    Male,   // 男
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Platform {
    Ps3,
    Ps4,
    Wii,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CostType {
    Create,
    Upgrade,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Elemental {
    pub fire: i32,
    pub water: i32,
    pub thunder: i32,
    pub ice: i32,
    pub dragon: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostItem {
    pub name: String,
    pub num: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cost {
    pub money: u32,
    pub cost_type: CostType,
    pub items: Vec<CostItem>,
}

/// One rung (Ability Type="...") of an equipment piece's Abilities block.
/// The set of valid `type_name` values is read from conf/Define.xml at
/// import time, never hardcoded (see rules-spec "Ability-type effects").
///
/// `tag`: for スキル発動 (Senyu, ACTIVATE_SKILL) and the two Teni-tree ability
/// types (Skill Slots Up / スキル強化), the decompiled `Ability.Tag` carries a
/// concrete named `SkillOption` — see rules-spec §1/§4. `None` for ordinary
/// ability types that carry no such payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ability {
    pub type_name: String,
    pub tag: Option<SkillOption>,
}

/// One `<Skill Point="N">Name</Skill>` entry. Order matters: the first 5
/// entries in document order are what the original UI calls "Skill 1..5".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillContribution {
    pub skill_name: SkillName,
    pub point: i32,
}

/// One `<Lx Def="..." Slot="...">` level rung. Weapons use `atk` instead of `def`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LevelEntry {
    pub level: u8, // 1..=7
    pub def: Option<i32>,
    pub atk: Option<i32>,
    pub slot: u8,
    pub cost: Cost,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EquipData {
    pub name: EquipName,
    pub class: String, // one of the 39 bracket codes, e.g. "(GX)"
    pub rare: u8,
    pub job: Job,
    pub sex: Sex,
    pub equip_type: String, // Exotic / G Rank Armour / GS Armour / Origin / Tower / Zenith / Zenith (ZP)
    pub gr: Option<u32>,
    pub platform: Option<Platform>,
    pub elemental: Elemental,
    pub levels: Vec<LevelEntry>,
    pub abilities: Vec<Ability>,
    pub skills: Vec<SkillContribution>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EquipSlotCategory {
    Head,
    Body,
    Arm,
    Waist,
    Leg,
    Weapon,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JewelData {
    pub name: EquipName,
    pub job: Job,
    pub rare: u8,
    pub slot: u8,
    pub skills: Vec<SkillContribution>, // may include negative-point side skills
    pub cost: Cost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SkillCuffFamily {
    Power, // <P> section
    Skill, // <S> section
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillCuffData {
    pub name: EquipName,
    pub family: SkillCuffFamily,
    pub class: String, // e.g. "(P)", "(S_辿)", "(秘)"
    pub rare: u8,
    pub slot: u8,
    pub skills: Vec<SkillContribution>,
    pub cost: Cost,
    /// Carries Teni-tree (Skill Slots Up / スキル強化) and no-count-skill
    /// (スキル枠消費なし) entries — see docs/rules-spec.md §1/§4.
    pub abilities: Vec<Ability>,
}

/// One rung of a SkillBase.xml `<Option Name Point>` ladder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillOption {
    pub name: String,
    pub point: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillBaseEntry {
    pub no: u32,
    pub id: String,
    pub name: SkillName,
    pub skill_rank: bool, // present-and-"1" in source XML; modeled as a flag
    pub options: Vec<SkillOption>, // descending point ladder, +max down to negative
}

/// One rung of a TeniSkillBase.xml `<SkillTree>` ladder — structurally distinct
/// from SkillBaseEntry (see rules-spec "Teni / Senyu skill math").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TeniSkillTree {
    pub no: u32,
    pub id: String,
    pub name: String,
    pub target: Option<String>, // links to a base Weapon ability name, when present
    pub rungs: Vec<SkillOption>, // e.g. "Skill Slots Up+7" .. "+1"
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WeaponData {
    pub name: EquipName,
    pub job: Job,
    pub sex: Sex,
    pub rare: u8,
    pub elemental: Elemental,
    pub levels: Vec<LevelEntry>,
    pub abilities: Vec<Ability>,
    pub skills: Vec<SkillContribution>,
}

/// conf/Define.xml's ABILITY_TYPE_* label strings + MAX_SKILL_LIMIT_UP, read
/// at import time and never hardcoded (see docs/rules-spec.md §1). These are
/// the exact string values `Ability.type_name` is compared against — a data
/// update that changes Define.xml changes these too.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AbilityTypeLabels {
    pub gclass_effect: String,        // ABILITY_TYPE_GCLASS_EFFECT, "Ｇ級効果"
    pub skill_up: String,             // ABILITY_TYPE_SKILL_UP, "スキルUP"
    pub activate_skill: String,       // ABILITY_TYPE_ACTIVATE_SKILL, "スキル発動" (Senyu)
    pub attachable_sp_jewels: String, // ABILITY_TYPE_ATTACHABLE_SPJEWELS
    pub skill_limit_up: String,       // ABILITY_TYPE_SKILL_LIMIT_UP, "Skill Slots Up" (Teni)
    pub skill_upgrade: String,        // ABILITY_TYPE_SKILL_UPGRADE, "スキル強化" (Teni)
    pub nocount_skill: String,        // ABILITY_TYPE_NOCOUNT_SKILL, "スキル枠消費なし"
    pub max_skill_limit_up: i32,      // MAX_SKILL_LIMIT_UP, confirmed 7
}

/// The full normalized dataset loaded from a `dat/` + `conf/` folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameData {
    pub head: Vec<EquipData>,
    pub body: Vec<EquipData>,
    pub arm: Vec<EquipData>,
    pub waist: Vec<EquipData>,
    pub leg: Vec<EquipData>,
    pub weapons: Vec<WeaponData>,
    pub jewels: Vec<JewelData>,
    pub skill_cuffs: Vec<SkillCuffData>,
    pub skill_base: Vec<SkillBaseEntry>,
    pub teni_skill_base: Vec<TeniSkillTree>,
    pub ability_types: AbilityTypeLabels,
}
