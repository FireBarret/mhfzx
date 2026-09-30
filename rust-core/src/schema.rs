//! Domain types mirroring the confirmed `dat/*.xml` / `conf/*.xml` shapes.
//!
//! Field shapes are taken directly from the schema survey in the project plan
//! (see docs/rules-spec.md for the game-logic rules that operate on these types).
//! All identity is by exact name string, never a synthetic id — this matches how
//! tag/allow/ignore/alias files already reference equipment, and keeps XML
//! round-tripping honest.
//!
//! Every struct is `#[serde(rename_all = "camelCase")]` and every enum's
//! variants are renamed to match `app/src/data/schema.ts` exactly, so a plain
//! `GameData` object built by the TS importers can be handed across the
//! wasm-bindgen boundary via `serde-wasm-bindgen` with no manual field
//! mapping — the two schemas are kept in sync by hand, not generated, so any
//! change here must be mirrored there (and vice versa).

use serde::{Deserialize, Serialize};

pub type EquipName = String;
pub type SkillName = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Job {
    #[serde(rename = "共")]
    Both,
    #[serde(rename = "剣士")]
    Blademaster,
    #[serde(rename = "ガンナー")]
    Gunner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Sex {
    #[serde(rename = "共")]
    Both,
    #[serde(rename = "女")]
    Female,
    #[serde(rename = "男")]
    Male,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Platform {
    #[serde(rename = "PS3")]
    Ps3,
    #[serde(rename = "PS4")]
    Ps4,
    Wii,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CostType {
    #[serde(rename = "create")]
    Create,
    #[serde(rename = "upgrade")]
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
#[serde(rename_all = "camelCase")]
pub struct Cost {
    pub money: u32,
    /// Absent when a level has no associated craft/upgrade action (observed
    /// on real data: a free base weapon's `<Cost Money="0" />` carries no
    /// `Type` attribute).
    pub cost_type: Option<CostType>,
    pub items: Vec<CostItem>,
}

/// One rung (Ability Type="...") of an equipment piece's Abilities block.
/// The set of valid `type_name` values is read from conf/Define.xml at
/// import time, never hardcoded (see rules-spec "Ability-type effects").
///
/// `name`: the TS importer's raw-text capture (e.g. a スキル発動/Senyu
/// ability's inline text names the granted skill, like `"Speed Eater"`).
/// `tag`: a fully-resolved `SkillOption` (name + point) — not populated by
/// the current dat/ importer (see `app/src/data/schema.ts`'s `Ability` doc
/// comment for why), reserved for when Senyu/Teni tag resolution is wired up.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ability {
    pub type_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub tag: Option<SkillOption>,
}

/// One `<Skill Point="N">Name</Skill>` entry. Order matters: the first 5
/// entries in document order are what the original UI calls "Skill 1..5".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillContribution {
    pub skill_name: SkillName,
    pub point: i32,
}

/// One `<Lx Def="..." Slot="...">` level rung. Weapons use `atk` instead of `def`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelEntry {
    pub level: u8, // 1..=7
    pub def: Option<i32>,
    pub atk: Option<i32>,
    pub slot: u8,
    pub cost: Cost,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// A `<Source Type="Head">Equip Name</Source>` entry — many jewels are
/// granted by specific armor pieces ("set decorations") rather than
/// purchased/crafted, independently of whether the jewel also has a `Cost`
/// (confirmed by direct inspection of dat/Jewel.xml: ~half its records carry
/// `Sources`, not mutually exclusive with `Cost`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JewelSource {
    pub part: String, // Source/@Type, e.g. "Head" | "Body" | "Arm" | "Waist" | "Leg"
    pub equip_name: EquipName,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JewelData {
    pub name: EquipName,
    /// Present only on "set/SP" jewels (the ones with `sources`) — a bracket
    /// class code like equipment's, e.g. "(GX)".
    pub class: Option<String>,
    pub job: Job,
    pub rare: u8,
    pub slot: u8,
    pub skills: Vec<SkillContribution>, // may include negative-point side skills
    /// Zero or more *alternative* crafting recipes (e.g. "Artisan Deco" has
    /// two independent `<Cost>` siblings, either of which crafts it). Empty
    /// for jewels obtained only via `sources`.
    pub costs: Vec<Cost>,
    pub sources: Vec<JewelSource>, // empty for plain craftable jewels
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SkillCuffFamily {
    Power, // <P> section
    Skill, // <S> section
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCuffData {
    pub name: EquipName,
    pub family: SkillCuffFamily,
    pub class: String, // e.g. "(P)", "(S_辿)", "(秘)"
    pub rare: u8,
    pub slot: u8,
    pub skills: Vec<SkillContribution>,
    /// Zero or more *alternative* crafting recipes (a handful of real records
    /// have more than one `<Cost>` sibling — see `JewelData::costs`).
    pub costs: Vec<Cost>,
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct TeniSkillTree {
    pub no: u32,
    pub id: String,
    pub name: String,
    pub target: Option<String>, // links to a base Weapon ability name, when present
    pub rungs: Vec<SkillOption>, // e.g. "Skill Slots Up+7" .. "+1"
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Confirms a JSON payload shaped exactly like what the TS importers
    /// (app/src/data/schema.ts + import/*.ts) produce — camelCase field
    /// names, Japanese enum string values — deserializes correctly. This is
    /// the contract the wasm-bindgen boundary depends on: the TS side is
    /// never adjusted to match Rust's naming, only the reverse.
    #[test]
    fn deserializes_ts_shaped_json_for_one_equip_record() {
        let json = r#"{
            "name": "Pietra GX Helm",
            "class": "(GX)",
            "rare": 11,
            "job": "共",
            "sex": "共",
            "equipType": "G Rank Armour",
            "gr": 7,
            "platform": null,
            "elemental": { "fire": 0, "water": 0, "thunder": 0, "ice": 0, "dragon": 0 },
            "levels": [
                { "level": 1, "def": 246, "atk": null, "slot": 3,
                  "cost": { "money": 1800, "costType": "upgrade", "items": [{ "name": "Ulti Conquest Proof", "num": 1 }] } }
            ],
            "abilities": [{ "typeName": "Ｇ級効果" }],
            "skills": [{ "skillName": "Breeder", "point": 5 }]
        }"#;
        let equip: EquipData = serde_json::from_str(json).expect("should deserialize");
        assert_eq!(equip.name, "Pietra GX Helm");
        assert_eq!(equip.job, Job::Both);
        assert_eq!(equip.equip_type, "G Rank Armour");
        assert_eq!(equip.gr, Some(7));
        assert_eq!(equip.platform, None);
        assert_eq!(equip.levels[0].cost.cost_type, Some(CostType::Upgrade));
        assert_eq!(equip.abilities[0].type_name, "Ｇ級効果");
        assert_eq!(equip.abilities[0].name, None);
    }

    #[test]
    fn job_sex_platform_enums_round_trip_through_their_ts_string_values() {
        assert_eq!(serde_json::to_string(&Job::Blademaster).unwrap(), "\"剣士\"");
        assert_eq!(serde_json::from_str::<Job>("\"ガンナー\"").unwrap(), Job::Gunner);
        assert_eq!(serde_json::to_string(&Sex::Female).unwrap(), "\"女\"");
        assert_eq!(serde_json::to_string(&Platform::Ps4).unwrap(), "\"PS4\"");
        assert_eq!(serde_json::to_string(&Platform::Wii).unwrap(), "\"Wii\"");
    }
}
