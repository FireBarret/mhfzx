//! Single-loadout evaluator — the oracle called by both the search engine's
//! inner loop (Phase 4) and the UI's single-set inspector.
//!
//! Every rule implemented here is cited from docs/rules-spec.md, which was
//! written directly from the original app's decompiled source. Two pieces of
//! that spec are *not* implemented here, deliberately, rather than guessed:
//!
//! - The exact ">10 active skills" truncation docs/rules-spec.md §2 describes
//!   (sort the *entire* active-skill set — every skill any equipped piece,
//!   plus/single-plus jewel, or cuff grants, tracked or not, but explicitly
//!   *excluding* SP jewels and Senyu skills — ascending by `SkillId`, then
//!   keep the first `maxActiveSkillCount` entries plus however many of those
//!   are no-count-exempt) is a search-space-reduction heuristic for scoring
//!   *candidate* combinations mid-search, not a rule for evaluating one
//!   already-complete, concrete loadout. It also has no stable general
//!   result independent of `SkillId` ordering, which this evaluator has no
//!   reason to reproduce for a finished-set display. For a single fixed set,
//!   this evaluator reports every skill whose tiered lookup resolves to an
//!   active option, plus whether that count exceeds the computed cap — see
//!   `EvaluationResult::exceeds_active_skill_cap` — without picking which
//!   specific skills the original would keep vs. drop. Revisit only if
//!   Phase 4's search engine needs this exact truncation to score candidates
//!   (in which case it belongs in `search.rs`, keyed on `SkillId`, not here).
//! - Decoration/skill-cuff slot-filling combinatorics (docs/rules-spec.md §3)
//!   are Phase 4's job (the search engine solves for which decorations to
//!   use); this evaluator takes a fully concrete set of decorations/cuffs as
//!   input and just sums their effect, per the Phase 3 function signature in
//!   the project plan.

use crate::schema::{
    AbilityTypeLabels, Elemental, EquipData, GameData, JewelData, SkillBaseEntry,
    SkillContribution, SkillCuffData, SkillName, WeaponData,
};
use crate::skill_base;
use std::collections::{HashMap, HashSet};

/// One equipped armor piece plus the chosen upgrade level (levels only vary
/// Def/Slot/Cost — Abilities/Skills live on the piece as a whole).
pub struct EquippedPiece<'a> {
    pub data: &'a EquipData,
    /// 1-based level number (matches `LevelEntry.level`), i.e. which `Lx`
    /// rung is currently equipped.
    pub level: u8,
}

pub struct Loadout<'a> {
    pub weapon: Option<&'a WeaponData>,
    pub head: EquippedPiece<'a>,
    pub body: EquippedPiece<'a>,
    pub arm: EquippedPiece<'a>,
    pub waist: EquippedPiece<'a>,
    pub leg: EquippedPiece<'a>,
    pub decorations: Vec<&'a JewelData>,
    pub skill_cuffs: Vec<&'a SkillCuffData>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActiveSkill {
    pub option_name: String,
    pub point: i32,
    /// True for skills granted via a Senyu (遷悠) ability — these are
    /// pre-satisfied named options, not tiered-lookup results from a raw
    /// point sum. See docs/rules-spec.md §4.
    pub from_senyu: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvaluationResult {
    pub active_skills: HashMap<SkillName, ActiveSkill>,
    pub total_defense: i32,
    pub resistances: Elemental,
    /// Base cap (10/11/12 via the G-rank-effect step function) plus the
    /// capped Skill-Slots-Up contribution. See docs/rules-spec.md §1.
    pub max_active_skill_count: i32,
    /// Count of `active_skills` not exempted by a no-count skill cuff.
    pub active_skill_count: i32,
    pub exceeds_active_skill_cap: bool,
    /// Distinct Teni-tree skill names present on any of the 6 equip slots or
    /// equipped skill cuffs (membership only — never summed into points).
    pub teni_skill_names: HashSet<String>,
}

/// A uniform view over the "abilities + skills" shape shared by armor,
/// weapons, and skill cuffs, so the six equip slots plus cuffs can be
/// iterated identically.
struct EquipLike<'a> {
    abilities: &'a [crate::schema::Ability],
    skills: &'a [SkillContribution],
}

impl<'a> From<&'a EquipData> for EquipLike<'a> {
    fn from(d: &'a EquipData) -> Self {
        EquipLike {
            abilities: &d.abilities,
            skills: &d.skills,
        }
    }
}
impl<'a> From<&'a WeaponData> for EquipLike<'a> {
    fn from(d: &'a WeaponData) -> Self {
        EquipLike {
            abilities: &d.abilities,
            skills: &d.skills,
        }
    }
}
impl<'a> From<&'a SkillCuffData> for EquipLike<'a> {
    fn from(d: &'a SkillCuffData) -> Self {
        EquipLike {
            abilities: &d.abilities,
            skills: &d.skills,
        }
    }
}

fn has_ability(abilities: &[crate::schema::Ability], type_name: &str) -> bool {
    abilities.iter().any(|a| a.type_name == type_name)
}

/// docs/rules-spec.md §1: `CountGRankEffect` — how many of the 6 equip slots
/// carry the Ｇ級効果 ability.
fn count_gclass_effect(slots: &[EquipLike], labels: &AbilityTypeLabels) -> i32 {
    slots
        .iter()
        .filter(|s| has_ability(s.abilities, &labels.gclass_effect))
        .count() as i32
}

/// docs/rules-spec.md §1 `GetMaxActiveSkillCount`'s step function:
/// base 10, +1 at exactly 3-4 G-rank-effect pieces, +2 at 5 (never happens
/// for 0-2, and 6 isn't reachable since only the 5 armor slots carry this
/// ability in practice).
fn gclass_step_bonus(count: i32) -> i32 {
    match count {
        3 | 4 => 1,
        5 => 2,
        _ => 0,
    }
}

/// docs/rules-spec.md §1/§2/§9: the Skill-Slots-Up contribution to the
/// active-skill-count cap. Sums each matching ability's *Teni tag point
/// value* (e.g. a "Skill Slots Up+5" ability contributes 5, not 1 — this is
/// not just a count of how many such abilities are worn), for equipment and
/// skill cuffs together, capped once at `max_skill_limit_up` (7).
///
/// This implements `EquipSet.CountEquipBySkillLimitUpEffect`'s
/// **combined-then-capped** formula (`min(equip_sum + cuff_sum, 7)`) — the
/// one the original uses for *displaying a finished set's stats*, which is
/// this evaluator's job. Deliberately **not** implemented here: the live
/// search's own internal `SearchClass.CountSkillLimitUpEffect`, which caps
/// equipment and skill-cuff contributions **separately** at 7 each (so a
/// candidate can get up to 14, not 7) as a *candidate-acceptance* heuristic
/// while search is still in progress — a different formula for a different
/// purpose, cited in the spec as something the original itself doesn't keep
/// consistent with the display path. Phase 4's search engine must implement
/// that separately-capped variant itself, not by calling this function.
fn skill_limit_up_count(
    equip_slots: &[EquipLike],
    cuffs: &[EquipLike],
    labels: &AbilityTypeLabels,
) -> i32 {
    let sum_tags = |abilities: &[crate::schema::Ability]| -> i32 {
        abilities
            .iter()
            .filter(|a| a.type_name == labels.skill_limit_up)
            .filter_map(|a| a.tag.as_ref())
            .map(|tag| tag.point)
            .sum()
    };
    let equip_count: i32 = equip_slots.iter().map(|s| sum_tags(s.abilities)).sum();
    let cuff_count: i32 = cuffs.iter().map(|s| sum_tags(s.abilities)).sum();
    (equip_count + cuff_count).min(labels.max_skill_limit_up)
}

/// docs/rules-spec.md §2 `CountNoCountSkills` — distinct skill names exempted
/// from the active-skill-count cap, sourced from skill cuffs' スキル枠消費なし
/// abilities.
fn no_count_skill_names(cuffs: &[&SkillCuffData], labels: &AbilityTypeLabels) -> HashSet<String> {
    let mut names = HashSet::new();
    for cuff in cuffs {
        for ability in &cuff.abilities {
            if ability.type_name == labels.nocount_skill {
                if let Some(tag) = &ability.tag {
                    names.insert(tag.name.clone());
                }
            }
        }
    }
    names
}

/// docs/rules-spec.md §4: Senyu (遷悠) skills are pre-satisfied named
/// `SkillOption`s carried by a スキル発動 ability's `Tag` — never summed as
/// raw points. Returns skill_name -> the granted option.
fn senyu_skills<'a>(
    slots: &'a [EquipLike],
    labels: &AbilityTypeLabels,
) -> HashMap<SkillName, &'a crate::schema::SkillOption> {
    let mut out = HashMap::new();
    for slot in slots {
        for ability in slot.abilities {
            if ability.type_name == labels.activate_skill {
                if let Some(tag) = &ability.tag {
                    out.insert(tag.name.clone(), tag);
                }
            }
        }
    }
    out
}

/// docs/rules-spec.md §4: Teni-tree skill names — membership only, from
/// either Skill-Slots-Up or スキル強化 abilities, on equip slots or cuffs.
fn teni_skill_names(
    equip_slots: &[EquipLike],
    cuffs: &[EquipLike],
    labels: &AbilityTypeLabels,
) -> HashSet<String> {
    let mut names = HashSet::new();
    let mut collect = |abilities: &[crate::schema::Ability]| {
        for ability in abilities {
            if ability.type_name == labels.skill_limit_up
                || ability.type_name == labels.skill_upgrade
            {
                if let Some(tag) = &ability.tag {
                    names.insert(tag.name.clone());
                }
            }
        }
    };
    for s in equip_slots {
        collect(s.abilities);
    }
    for s in cuffs {
        collect(s.abilities);
    }
    names
}

fn find_skill_base<'a>(game_data: &'a GameData, name: &str) -> Option<&'a SkillBaseEntry> {
    game_data.skill_base.iter().find(|s| s.name == name)
}

fn level_entry(data: &EquipData, level: u8) -> &crate::schema::LevelEntry {
    data.levels
        .iter()
        .find(|l| l.level == level)
        .unwrap_or_else(|| panic!("level {level} not found on {}", data.name))
}

pub fn evaluate_loadout(loadout: &Loadout, game_data: &GameData) -> EvaluationResult {
    let labels = &game_data.ability_types;

    let armor_pieces: [&EquipData; 5] = [
        loadout.head.data,
        loadout.body.data,
        loadout.arm.data,
        loadout.waist.data,
        loadout.leg.data,
    ];
    let armor_slots: Vec<EquipLike> = armor_pieces.iter().map(|d| EquipLike::from(*d)).collect();
    let weapon_slot: Option<EquipLike> = loadout.weapon.map(EquipLike::from);
    let all_equip_slots: Vec<EquipLike> = armor_slots
        .iter()
        .map(|s| EquipLike {
            abilities: s.abilities,
            skills: s.skills,
        })
        .chain(weapon_slot.iter().map(|s| EquipLike {
            abilities: s.abilities,
            skills: s.skills,
        }))
        .collect();
    let cuff_slots: Vec<EquipLike> = loadout
        .skill_cuffs
        .iter()
        .map(|c| EquipLike::from(*c))
        .collect();

    // --- docs/rules-spec.md §9: defense/elemental totals exclude the weapon slot ---
    // This matches EquipSet.TotalDef's *display* semantics (what this evaluator
    // reports). The live search's own internal defense-range pruning bound
    // includes the weapon's Def, a documented inconsistency in the original —
    // moot today (dat/Weapon.xml has no Def field at all, so it's always 0),
    // but Phase 4's search engine must replicate that inclusion in its own
    // pruning bound rather than assuming it matches this function.
    let total_defense: i32 = [
        &loadout.head,
        &loadout.body,
        &loadout.arm,
        &loadout.waist,
        &loadout.leg,
    ]
    .iter()
    .map(|p| level_entry(p.data, p.level).def.unwrap_or(0))
    .sum();
    let resistances = armor_pieces.iter().fold(
        Elemental {
            fire: 0,
            water: 0,
            thunder: 0,
            ice: 0,
            dragon: 0,
        },
        |acc, d| Elemental {
            fire: acc.fire + d.elemental.fire,
            water: acc.water + d.elemental.water,
            thunder: acc.thunder + d.elemental.thunder,
            ice: acc.ice + d.elemental.ice,
            dragon: acc.dragon + d.elemental.dragon,
        },
    );

    // --- docs/rules-spec.md §1: active-skill-count cap ---
    let gclass_count = count_gclass_effect(&all_equip_slots, labels);
    let base_cap = 10 + gclass_step_bonus(gclass_count);
    let limit_up = skill_limit_up_count(&all_equip_slots, &cuff_slots, labels);
    let max_active_skill_count = base_cap + limit_up;

    // --- docs/rules-spec.md §4: Senyu (pre-satisfied, not summed) and Teni (membership only) ---
    let senyu = senyu_skills(&all_equip_slots, labels);
    let teni_names = teni_skill_names(&all_equip_slots, &cuff_slots, labels);
    let no_count_names = no_count_skill_names(&loadout.skill_cuffs, labels);

    // --- docs/rules-spec.md §2: raw point summation across equip + decorations + cuffs ---
    let mut raw_points: HashMap<SkillName, i32> = HashMap::new();
    for slot in &all_equip_slots {
        for c in slot.skills {
            *raw_points.entry(c.skill_name.clone()).or_insert(0) += c.point;
        }
    }
    for jewel in &loadout.decorations {
        for c in &jewel.skills {
            *raw_points.entry(c.skill_name.clone()).or_insert(0) += c.point;
        }
    }
    for cuff in &loadout.skill_cuffs {
        for c in &cuff.skills {
            *raw_points.entry(c.skill_name.clone()).or_insert(0) += c.point;
        }
    }

    // Senyu-granted skills are pre-satisfied and not run through the tiered
    // lookup at all — they short-circuit straight to their granted option.
    let mut active_skills: HashMap<SkillName, ActiveSkill> = HashMap::new();
    for (name, option) in &senyu {
        active_skills.insert(
            name.clone(),
            ActiveSkill {
                option_name: option.name.clone(),
                point: option.point,
                from_senyu: true,
            },
        );
    }
    for (name, points) in &raw_points {
        if active_skills.contains_key(name) {
            continue; // already pre-satisfied via Senyu
        }
        if let Some(entry) = find_skill_base(game_data, name) {
            if let Some(option) = skill_base::get_option(entry, *points) {
                active_skills.insert(
                    name.clone(),
                    ActiveSkill {
                        option_name: option.name.clone(),
                        point: option.point,
                        from_senyu: false,
                    },
                );
            }
        }
    }

    let active_skill_count = active_skills
        .keys()
        .filter(|name| !no_count_names.contains(*name))
        .count() as i32;
    let exceeds_active_skill_cap = active_skill_count > max_active_skill_count;

    EvaluationResult {
        active_skills,
        total_defense,
        resistances,
        max_active_skill_count,
        active_skill_count,
        exceeds_active_skill_cap,
        teni_skill_names: teni_names,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::*;

    fn labels() -> AbilityTypeLabels {
        AbilityTypeLabels {
            gclass_effect: "Ｇ級効果".into(),
            skill_up: "スキルUP".into(),
            activate_skill: "スキル発動".into(),
            attachable_sp_jewels: "ＳＰ装飾品装着可能".into(),
            skill_limit_up: "Skill Slots Up".into(),
            skill_upgrade: "スキル強化".into(),
            nocount_skill: "スキル枠消費なし".into(),
            max_skill_limit_up: 7,
        }
    }

    fn plain_armor(name: &str, def: i32, skills: Vec<(&str, i32)>) -> EquipData {
        EquipData {
            name: name.into(),
            class: "(Test)".into(),
            rare: 5,
            job: Job::Both,
            sex: Sex::Both,
            equip_type: "G Rank Armour".into(),
            gr: Some(1),
            platform: None,
            elemental: Elemental {
                fire: 0,
                water: 0,
                thunder: 0,
                ice: 0,
                dragon: 0,
            },
            levels: vec![LevelEntry {
                level: 1,
                def: Some(def),
                atk: None,
                slot: 0,
                cost: Cost {
                    money: 0,
                    cost_type: Some(CostType::Create),
                    items: vec![],
                },
            }],
            abilities: vec![],
            skills: skills
                .into_iter()
                .map(|(n, p)| SkillContribution {
                    skill_name: n.into(),
                    point: p,
                })
                .collect(),
        }
    }

    fn attack_skill_base() -> SkillBaseEntry {
        SkillBaseEntry {
            no: 1,
            id: "0001".into(),
            name: "Attack".into(),
            category: "Offense and Adren".into(),
            skill_rank: false,
            options: vec![
                SkillOption {
                    name: "Attack +2".into(),
                    point: 20,
                },
                SkillOption {
                    name: "Attack +1".into(),
                    point: 10,
                },
            ],
        }
    }

    fn minimal_game_data() -> GameData {
        GameData {
            head: vec![],
            body: vec![],
            arm: vec![],
            waist: vec![],
            leg: vec![],
            weapons: vec![],
            jewels: vec![],
            skill_cuffs: vec![],
            clothes: vec![],
            skill_base: vec![attack_skill_base()],
            teni_skill_base: vec![],
            ability_types: labels(),
        }
    }

    #[test]
    fn sums_points_across_armor_and_resolves_active_skill() {
        let head = plain_armor("Head", 50, vec![("Attack", 10)]);
        let body = plain_armor("Body", 60, vec![("Attack", 10)]);
        let arm = plain_armor("Arm", 40, vec![]);
        let waist = plain_armor("Waist", 45, vec![]);
        let leg = plain_armor("Leg", 55, vec![]);
        let game_data = minimal_game_data();

        let loadout = Loadout {
            weapon: None,
            head: EquippedPiece {
                data: &head,
                level: 1,
            },
            body: EquippedPiece {
                data: &body,
                level: 1,
            },
            arm: EquippedPiece {
                data: &arm,
                level: 1,
            },
            waist: EquippedPiece {
                data: &waist,
                level: 1,
            },
            leg: EquippedPiece {
                data: &leg,
                level: 1,
            },
            decorations: vec![],
            skill_cuffs: vec![],
        };

        let result = evaluate_loadout(&loadout, &game_data);
        assert_eq!(result.total_defense, 50 + 60 + 40 + 45 + 55);
        // 20 total points exactly clears "Attack +2"'s threshold (20).
        assert_eq!(
            result.active_skills.get("Attack").unwrap().option_name,
            "Attack +2"
        );
        assert_eq!(result.active_skill_count, 1);
        assert!(!result.exceeds_active_skill_cap);
        assert_eq!(result.max_active_skill_count, 10); // no G-rank pieces, no Skill Slots Up
    }

    #[test]
    fn gclass_effect_step_function_matches_spec() {
        assert_eq!(gclass_step_bonus(0), 0);
        assert_eq!(gclass_step_bonus(2), 0);
        assert_eq!(gclass_step_bonus(3), 1);
        assert_eq!(gclass_step_bonus(4), 1);
        assert_eq!(gclass_step_bonus(5), 2);
    }

    #[test]
    fn skill_limit_up_sums_tag_points_not_ability_counts() {
        let labels = labels();
        let abilities = vec![Ability {
            type_name: labels.skill_limit_up.clone(),
            name: None,
            tag: Some(SkillOption { name: "Skill Slots Up+5".into(), point: 5 }),
        }];
        let slot = EquipLike { abilities: &abilities, skills: &[] };
        // A single "+5" ability must contribute 5, not 1.
        assert_eq!(skill_limit_up_count(&[slot], &[], &labels), 5);
    }

    #[test]
    fn skill_limit_up_caps_combined_total_once_at_seven() {
        // Per docs/rules-spec.md §2 (EquipSet.CountEquipBySkillLimitUpEffect):
        // equip=5 + cuff=5 is capped ONCE at 7, not min(5,7)+min(5,7)=10 — that
        // separately-capped formula belongs to the live search's own internal
        // candidate-cap heuristic (Phase 4), not this finished-set evaluator.
        let labels = labels();
        let equip_ability = vec![Ability {
            type_name: labels.skill_limit_up.clone(),
            name: None,
            tag: Some(SkillOption { name: "Skill Slots Up+5".into(), point: 5 }),
        }];
        let cuff_ability = vec![Ability {
            type_name: labels.skill_limit_up.clone(),
            name: None,
            tag: Some(SkillOption { name: "Skill Slots Up+5".into(), point: 5 }),
        }];
        let equip_slot = EquipLike { abilities: &equip_ability, skills: &[] };
        let cuff_slot = EquipLike { abilities: &cuff_ability, skills: &[] };
        assert_eq!(skill_limit_up_count(&[equip_slot], &[cuff_slot], &labels), 7);
    }
}
