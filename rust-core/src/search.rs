//! Armor-set search: branch-and-bound over the 5 armor slots, with a greedy
//! per-skill decoration fill as the final step, verified against the Phase 3
//! evaluator before being accepted as a result.
//!
//! Scope, deliberately: this is **not** a port of `SearchClass.Search()`
//! (docs/rules-spec.md §5) — the project plan's Phase 4 explicitly does not
//! require bit-for-bit parity with the original's closed heuristics. What it
//! does require (and what this module guarantees): every returned result is
//! re-checked by `evaluator::evaluate_loadout` before being returned
//! (soundness), and the search is a real, working branch-and-bound over the
//! actual game data (not a stub). Skill cuffs and SP-slot decorations are out
//! of scope for this first version — regular armor + regular jewel
//! decorations only — a documented cut, not an oversight; both are
//! self-contained subsystems (rules-spec §3) that can be added later without
//! changing this module's shape.

use crate::evaluator::{evaluate_loadout, ActiveSkill, EquippedPiece, Loadout};
use crate::schema::{EquipData, GameData, Job, JewelData, SkillName, WeaponData};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchTarget {
    pub skill_name: SkillName,
    /// The minimum point total the caller wants this skill to reach. A
    /// result is only accepted if every target's skill is active with at
    /// least this point value (per the tiered lookup, not a raw sum).
    pub min_point: i32,
}

pub struct SearchInput {
    pub targets: Vec<SearchTarget>,
    pub job: Job,
    pub max_results: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundSkill {
    pub skill_name: SkillName,
    pub option_name: String,
    pub point: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundSet {
    /// `None` only when the loaded data has no weapons at all — otherwise a
    /// weapon is always selected, both for its own skills and because it
    /// commonly contributes decoration slots too (per real MHF play: a
    /// weapon typically has slots, often filled with "blank"/no-skill
    /// decorations when nothing better is available).
    pub weapon: Option<String>,
    pub head: String,
    pub body: String,
    pub arm: String,
    pub waist: String,
    pub leg: String,
    pub decorations: Vec<String>,
    pub total_defense: i32,
    pub active_skills: Vec<FoundSkill>,
}

const MAX_CANDIDATES_PER_SLOT: usize = 24;
const MAX_FILLER_PER_SLOT: usize = 6;
const MAX_NODES_VISITED: u64 = 3_000_000;

fn job_compatible(piece_job: Job, wanted: Job) -> bool {
    piece_job == Job::Both || wanted == Job::Both || piece_job == wanted
}

/// The piece's highest (last) level rung — the fully-upgraded stats, used as
/// this candidate's Def/Slot for search purposes.
fn best_level(piece: &EquipData) -> &crate::schema::LevelEntry {
    piece.levels.last().expect("every EquipData has at least one level")
}

/// Sum of positive contributions this piece makes toward any target skill —
/// the relevance score used to shortlist candidates per slot.
fn relevance(piece: &EquipData, target_names: &[&str]) -> i32 {
    piece
        .skills
        .iter()
        .filter(|s| target_names.contains(&s.skill_name.as_str()) && s.point > 0)
        .map(|s| s.point)
        .sum()
}

/// Shortlists a slot's candidates: the top `MAX_CANDIDATES_PER_SLOT` by
/// relevance (ties broken by defense), plus up to `MAX_FILLER_PER_SLOT`
/// generic high-defense pieces (so a slot with no relevant piece still gets
/// good, complete, valid candidates instead of an empty list).
fn shortlist<'a>(pieces: &'a [EquipData], job: Job, target_names: &[&str]) -> Vec<&'a EquipData> {
    let compatible: Vec<&EquipData> = pieces.iter().filter(|p| job_compatible(p.job, job)).collect();

    let mut by_relevance: Vec<&EquipData> = compatible.iter().copied().filter(|p| relevance(p, target_names) > 0).collect();
    by_relevance.sort_by(|a, b| {
        relevance(b, target_names)
            .cmp(&relevance(a, target_names))
            .then(best_level(b).def.unwrap_or(0).cmp(&best_level(a).def.unwrap_or(0)))
    });
    by_relevance.truncate(MAX_CANDIDATES_PER_SLOT);

    let mut fillers: Vec<&EquipData> = compatible;
    fillers.sort_by_key(|a| std::cmp::Reverse(best_level(a).def.unwrap_or(0)));
    for f in fillers {
        if by_relevance.len() >= MAX_CANDIDATES_PER_SLOT + MAX_FILLER_PER_SLOT {
            break;
        }
        if !by_relevance.iter().any(|p| p.name == f.name) {
            by_relevance.push(f);
        }
    }
    by_relevance
}

/// Best single-piece contribution to each target skill across a candidate
/// list — used as the per-slot term of the branch-and-bound upper bound.
fn max_contribution_per_target(candidates: &[&EquipData], targets: &[SearchTarget]) -> Vec<i32> {
    targets
        .iter()
        .map(|t| {
            candidates
                .iter()
                .flat_map(|p| p.skills.iter())
                .filter(|s| s.skill_name == t.skill_name && s.point > 0)
                .map(|s| s.point)
                .max()
                .unwrap_or(0)
        })
        .collect()
}

/// Best points-per-slot-unit ratio across all jewels for each target skill —
/// the decoration-side term of the bound. True (non-truncated) ratios are
/// used deliberately: docs/rules-spec.md §3 documents the original's
/// truncating-integer-division `Efficiency` as a real behavioral quirk that
/// makes its bound an *underestimate*; using the true ratio here gives an
/// honestly admissible bound instead of reproducing that specific quirk,
/// consistent with the plan's Phase 4 non-goal of exact heuristic parity.
fn best_jewel_efficiency_per_target(jewels: &[JewelData], targets: &[SearchTarget]) -> Vec<f64> {
    targets
        .iter()
        .map(|t| {
            jewels
                .iter()
                .flat_map(|j| j.skills.iter().map(move |s| (j.slot, s)))
                .filter(|(_, s)| s.skill_name == t.skill_name && s.point > 0)
                .map(|(slot, s)| s.point as f64 / slot.max(1) as f64)
                .fold(0.0_f64, f64::max)
        })
        .collect()
}

/// The weapon's highest (last) level rung.
fn best_weapon_level(weapon: &WeaponData) -> &crate::schema::LevelEntry {
    weapon.levels.last().expect("every WeaponData has at least one level")
}

fn weapon_relevance(weapon: &WeaponData, target_names: &[&str]) -> i32 {
    weapon
        .skills
        .iter()
        .filter(|s| target_names.contains(&s.skill_name.as_str()) && s.point > 0)
        .map(|s| s.point)
        .sum()
}

/// Shortlists weapon candidates the same way `shortlist` does for armor:
/// relevant-to-targets first, then a handful of generic fillers so a weapon
/// is always available even when none of them help the requested skills
/// (its slots alone are still worth having).
fn shortlist_weapons<'a>(weapons: &'a [WeaponData], job: Job, target_names: &[&str]) -> Vec<&'a WeaponData> {
    let compatible: Vec<&WeaponData> = weapons.iter().filter(|w| job_compatible(w.job, job)).collect();
    let mut by_relevance: Vec<&WeaponData> =
        compatible.iter().copied().filter(|w| weapon_relevance(w, target_names) > 0).collect();
    by_relevance.sort_by_key(|w| std::cmp::Reverse(weapon_relevance(w, target_names)));
    by_relevance.truncate(MAX_CANDIDATES_PER_SLOT);

    for w in compatible.iter().copied().take(MAX_FILLER_PER_SLOT) {
        if by_relevance.len() >= MAX_CANDIDATES_PER_SLOT + MAX_FILLER_PER_SLOT {
            break;
        }
        if !by_relevance.iter().any(|p| p.name == w.name) {
            by_relevance.push(w);
        }
    }
    by_relevance
}

struct SlotCandidates<'a> {
    pieces: Vec<&'a EquipData>,
    max_contribution: Vec<i32>,
}

struct SearchState<'a> {
    slots: [SlotCandidates<'a>; 5],
    /// The single weapon selected for this search pass (an outer loop in
    /// `search()` tries each shortlisted weapon in turn) — `None` only when
    /// `data.weapons` is empty.
    weapon: Option<&'a WeaponData>,
    targets: &'a [SearchTarget],
    jewel_efficiency: Vec<f64>,
    jewels: &'a [JewelData],
    skill_base: &'a HashMap<String, &'a crate::schema::SkillBaseEntry>,
    ability_types: crate::schema::AbilityTypeLabels,
    max_results: usize,
    nodes_visited: u64,
    results: Vec<FoundSet>,
}

/// A rough decoration-capacity estimate for the bound: total open-slot
/// *units* across armor pieces not yet chosen, computed as
/// `remaining_slot_count * 3` (the largest possible socket size) — a
/// deliberately generous overestimate of achievable capacity, which keeps
/// the bound admissible (never prunes a branch that could still succeed).
fn remaining_decoration_capacity(chosen_count: usize) -> f64 {
    ((5 - chosen_count) * 3) as f64
}

fn is_promising(state: &SearchState, chosen_count: usize, running: &[i32]) -> bool {
    let capacity = remaining_decoration_capacity(chosen_count);
    for (i, target) in state.targets.iter().enumerate() {
        let deficit = target.min_point - running[i];
        if deficit <= 0 {
            continue;
        }
        let remaining_armor_bound: i32 = state.slots[chosen_count..].iter().map(|s| s.max_contribution[i]).sum();
        let decoration_bound = state.jewel_efficiency[i] * capacity;
        if (remaining_armor_bound as f64) + decoration_bound < deficit as f64 {
            return false; // even the best case can't reach this target — prune
        }
    }
    true
}

/// Greedily fills decoration slots with the best-fitting jewels for each
/// still-unmet target skill.
///
/// Slot semantics (per real MHF/old-style MH mechanics, confirmed by the
/// user and matching rules-spec §3's `SlotInfo.Divide` description): each
/// equip piece's own `Slot` value (0-3) is a **capacity**, not a single
/// socket sized up to 3 — a 3-capacity piece can hold three separate 1-slot
/// jewels, or one 1- and one 2-slot jewel, or one 3-slot jewel, as long as
/// the sizes used sum to at most that piece's capacity. A jewel can never
/// span capacity across two different pieces. `buckets` is therefore one
/// entry per equipped piece (armor *and* weapon — both contribute slots),
/// each tracking its own remaining capacity as jewels are placed into it.
///
/// Not globally optimal — a documented heuristic, not the exact bounded-
/// knapsack DP the project plan names as a future improvement — but always
/// produces a physically valid placement, verified afterward by
/// `evaluate_loadout`.
fn fill_decorations<'a>(jewels: &'a [JewelData], piece_capacities: &[u8], deficits: &[(SkillName, i32)]) -> Vec<&'a JewelData> {
    let mut buckets = piece_capacities.to_vec();
    let mut chosen: Vec<&JewelData> = Vec::new();
    let mut remaining_deficit: HashMap<&str, i32> = deficits.iter().map(|(n, p)| (n.as_str(), *p)).collect();

    let mut sorted_targets: Vec<&str> = deficits.iter().map(|(n, _)| n.as_str()).collect();
    sorted_targets.sort_by_key(|n| std::cmp::Reverse(remaining_deficit[*n]));

    for skill_name in sorted_targets {
        loop {
            let need = *remaining_deficit.get(skill_name).unwrap_or(&0);
            if need <= 0 || buckets.iter().all(|&b| b == 0) {
                break;
            }
            // Best-fitting jewel: among those that fit in *some* bucket's
            // remaining capacity, prefer highest points, tie-broken by
            // smallest slot (conserves capacity for further jewels).
            let best = jewels
                .iter()
                .filter(|j| buckets.iter().any(|&b| b >= j.slot))
                .filter_map(|j| {
                    let point = j.skills.iter().find(|c| c.skill_name == skill_name && c.point > 0)?.point;
                    Some((j, point))
                })
                .max_by(|(a, ap), (b, bp)| ap.cmp(bp).then(b.slot.cmp(&a.slot)));

            let Some((jewel, point)) = best else { break };
            // Place into the bucket with the smallest remaining capacity
            // that still fits this jewel — conserves larger-capacity
            // buckets (which can host more/bigger jewels) for later picks.
            let bucket_idx = buckets
                .iter()
                .enumerate()
                .filter(|(_, &b)| b >= jewel.slot)
                .min_by_key(|(_, &b)| b)
                .map(|(i, _)| i)
                .expect("filtered above to guarantee a fit exists");
            buckets[bucket_idx] -= jewel.slot;
            chosen.push(jewel);
            *remaining_deficit.entry(skill_name).or_insert(0) -= point;
            // A jewel can carry negative side-skills too; apply those to
            // whichever other target they affect, so the loop doesn't keep
            // "spending" sockets on a jewel that's secretly working against
            // another tracked skill.
            for side in &jewel.skills {
                if side.skill_name != skill_name {
                    if let Some(d) = remaining_deficit.get_mut(side.skill_name.as_str()) {
                        *d -= side.point;
                    }
                }
            }
        }
    }
    chosen
}

fn recurse<'a>(
    state: &mut SearchState<'a>,
    chosen_count: usize,
    chosen: &mut [Option<&'a EquipData>; 5],
    running: &mut Vec<i32>,
) {
    if state.results.len() >= state.max_results || state.nodes_visited >= MAX_NODES_VISITED {
        return;
    }
    state.nodes_visited += 1;

    if chosen_count == 5 {
        try_accept(state, chosen, running);
        return;
    }

    if !is_promising(state, chosen_count, running) {
        return;
    }

    let candidates = state.slots[chosen_count].pieces.clone();
    for piece in candidates {
        chosen[chosen_count] = Some(piece);
        let deltas: Vec<i32> = state
            .targets
            .iter()
            .map(|t| piece.skills.iter().find(|s| s.skill_name == t.skill_name).map(|s| s.point).unwrap_or(0))
            .collect();
        for (i, d) in deltas.iter().enumerate() {
            running[i] += d;
        }

        recurse(state, chosen_count + 1, chosen, running);

        for (i, d) in deltas.iter().enumerate() {
            running[i] -= d;
        }
        if state.results.len() >= state.max_results || state.nodes_visited >= MAX_NODES_VISITED {
            chosen[chosen_count] = None;
            return;
        }
    }
    chosen[chosen_count] = None;
}

fn try_accept<'a>(state: &mut SearchState<'a>, chosen: &[Option<&'a EquipData>; 5], running: &[i32]) {
    let pieces: [&EquipData; 5] = [
        chosen[0].unwrap(),
        chosen[1].unwrap(),
        chosen[2].unwrap(),
        chosen[3].unwrap(),
        chosen[4].unwrap(),
    ];
    let mut sockets: Vec<u8> = pieces.iter().map(|p| best_level(p).slot).filter(|&s| s > 0).collect();
    if let Some(weapon) = state.weapon {
        let weapon_slot = best_weapon_level(weapon).slot;
        if weapon_slot > 0 {
            sockets.push(weapon_slot);
        }
    }

    let deficits: Vec<(SkillName, i32)> = state
        .targets
        .iter()
        .enumerate()
        .filter(|(i, t)| running[*i] < t.min_point)
        .map(|(i, t)| (t.skill_name.clone(), t.min_point - running[i]))
        .collect();
    let decorations = fill_decorations(state.jewels, &sockets, &deficits);

    let loadout = Loadout {
        weapon: state.weapon,
        head: EquippedPiece { data: pieces[0], level: best_level(pieces[0]).level },
        body: EquippedPiece { data: pieces[1], level: best_level(pieces[1]).level },
        arm: EquippedPiece { data: pieces[2], level: best_level(pieces[2]).level },
        waist: EquippedPiece { data: pieces[3], level: best_level(pieces[3]).level },
        leg: EquippedPiece { data: pieces[4], level: best_level(pieces[4]).level },
        decorations: decorations.clone(),
        skill_cuffs: vec![],
    };

    // Soundness gate: every accepted result is re-checked by the same
    // evaluator the UI's single-set inspector uses — no result reaches the
    // caller without passing through this independent check.
    let game_data_stub = build_game_data_stub(state);
    let result = evaluate_loadout(&loadout, &game_data_stub);

    let all_targets_met = state.targets.iter().all(|t| {
        result
            .active_skills
            .get(&t.skill_name)
            .map(|a: &ActiveSkill| a.point >= t.min_point)
            .unwrap_or(false)
    });
    if !all_targets_met {
        return;
    }

    let active_skills: Vec<FoundSkill> = result
        .active_skills
        .iter()
        .map(|(name, a)| FoundSkill { skill_name: name.clone(), option_name: a.option_name.clone(), point: a.point })
        .collect();

    state.results.push(FoundSet {
        weapon: state.weapon.map(|w| w.name.clone()),
        head: pieces[0].name.clone(),
        body: pieces[1].name.clone(),
        arm: pieces[2].name.clone(),
        waist: pieces[3].name.clone(),
        leg: pieces[4].name.clone(),
        decorations: decorations.iter().map(|d| d.name.clone()).collect(),
        total_defense: result.total_defense,
        active_skills,
    });
}

/// `evaluate_loadout` needs a `GameData` reference purely to resolve skill
/// names against `SkillBaseEntry`/`AbilityTypeLabels` — cheap to construct a
/// borrowed view here rather than threading the whole original `GameData`
/// through every recursion frame.
fn build_game_data_stub(state: &SearchState) -> GameData {
    GameData {
        head: vec![],
        body: vec![],
        arm: vec![],
        waist: vec![],
        leg: vec![],
        weapons: vec![],
        jewels: vec![],
        skill_cuffs: vec![],
        skill_base: state.skill_base.values().map(|s| (*s).clone()).collect(),
        teni_skill_base: vec![],
        ability_types: state.ability_types.clone(),
    }
}

/// Per-target skill point contribution of a single weapon (0 for every
/// target when `weapon` is `None`, so the outer loop can treat "no weapon
/// available" uniformly with "a weapon that happens to help nothing").
fn weapon_deltas(weapon: Option<&WeaponData>, targets: &[SearchTarget]) -> Vec<i32> {
    targets
        .iter()
        .map(|t| {
            weapon.and_then(|w| w.skills.iter().find(|s| s.skill_name == t.skill_name)).map(|s| s.point).unwrap_or(0)
        })
        .collect()
}

pub fn search(data: &GameData, input: &SearchInput) -> Vec<FoundSet> {
    let target_names: Vec<&str> = input.targets.iter().map(|t| t.skill_name.as_str()).collect();

    let head = shortlist(&data.head, input.job, &target_names);
    let body = shortlist(&data.body, input.job, &target_names);
    let arm = shortlist(&data.arm, input.job, &target_names);
    let waist = shortlist(&data.waist, input.job, &target_names);
    let leg = shortlist(&data.leg, input.job, &target_names);

    let slots: [SlotCandidates; 5] = [
        SlotCandidates { max_contribution: max_contribution_per_target(&head, &input.targets), pieces: head },
        SlotCandidates { max_contribution: max_contribution_per_target(&body, &input.targets), pieces: body },
        SlotCandidates { max_contribution: max_contribution_per_target(&arm, &input.targets), pieces: arm },
        SlotCandidates { max_contribution: max_contribution_per_target(&waist, &input.targets), pieces: waist },
        SlotCandidates { max_contribution: max_contribution_per_target(&leg, &input.targets), pieces: leg },
    ];

    let skill_base: HashMap<String, &crate::schema::SkillBaseEntry> =
        data.skill_base.iter().map(|s| (s.name.clone(), s)).collect();
    let jewel_efficiency = best_jewel_efficiency_per_target(&data.jewels, &input.targets);

    // Weapons contribute both skills and decoration slots (confirmed: the
    // active-skill-count cap is raised by Skill Slots Up on weapons too, not
    // just armor — see docs/rules-spec.md §1's "6 equip slots" scope, and
    // weapons commonly carry slots in real play). Try each shortlisted
    // weapon in turn; `None` only if the loaded data has no weapons at all.
    let weapon_candidates: Vec<Option<&WeaponData>> = if data.weapons.is_empty() {
        vec![None]
    } else {
        shortlist_weapons(&data.weapons, input.job, &target_names).into_iter().map(Some).collect()
    };

    let mut state = SearchState {
        slots,
        weapon: None,
        targets: &input.targets,
        jewel_efficiency,
        jewels: &data.jewels,
        skill_base: &skill_base,
        ability_types: data.ability_types.clone(),
        max_results: input.max_results,
        nodes_visited: 0,
        results: Vec::new(),
    };

    for weapon in weapon_candidates {
        if state.results.len() >= state.max_results || state.nodes_visited >= MAX_NODES_VISITED {
            break;
        }
        state.weapon = weapon;
        let mut chosen: [Option<&EquipData>; 5] = [None; 5];
        let mut running = weapon_deltas(weapon, &input.targets);
        recurse(&mut state, 0, &mut chosen, &mut running);
    }
    state.results
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

    fn armor(name: &str, def: i32, slot: u8, skills: Vec<(&str, i32)>) -> EquipData {
        EquipData {
            name: name.into(),
            class: "(Test)".into(),
            rare: 5,
            job: Job::Both,
            sex: Sex::Both,
            equip_type: "G Rank Armour".into(),
            gr: Some(1),
            platform: None,
            elemental: Elemental { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
            levels: vec![LevelEntry {
                level: 1,
                def: Some(def),
                atk: None,
                slot,
                cost: Cost { money: 0, cost_type: Some(CostType::Create), items: vec![] },
            }],
            abilities: vec![],
            skills: skills.into_iter().map(|(n, p)| SkillContribution { skill_name: n.into(), point: p }).collect(),
        }
    }

    fn jewel(name: &str, slot: u8, skills: Vec<(&str, i32)>) -> JewelData {
        JewelData {
            name: name.into(),
            class: None,
            job: Job::Both,
            rare: 4,
            slot,
            skills: skills.into_iter().map(|(n, p)| SkillContribution { skill_name: n.into(), point: p }).collect(),
            costs: vec![],
            sources: vec![],
        }
    }

    fn attack_skill_base() -> SkillBaseEntry {
        SkillBaseEntry {
            no: 1,
            id: "0001".into(),
            name: "Attack".into(),
            skill_rank: false,
            options: vec![
                SkillOption { name: "Attack +2".into(), point: 20 },
                SkillOption { name: "Attack +1".into(), point: 10 },
            ],
        }
    }

    /// Every slot offers a plain high-defense piece (no skill, no socket) and
    /// a "geared" piece (+5 Attack, one socket). Reaching Attack+10 requires
    /// either two geared pieces, or one geared piece's own +5 plus a jewel
    /// placed in the socket it provides — exercising both the branch-and-
    /// bound armor search and the decoration fill together.
    fn two_skill_test_data() -> GameData {
        let make_slot = |prefix: &str| {
            vec![armor(&format!("{prefix} Plain"), 100, 0, vec![]), armor(&format!("{prefix} Geared"), 50, 1, vec![("Attack", 5)])]
        };
        GameData {
            head: make_slot("Head"),
            body: make_slot("Body"),
            arm: make_slot("Arm"),
            waist: make_slot("Waist"),
            leg: make_slot("Leg"),
            weapons: vec![],
            jewels: vec![jewel("Attack Jewel", 1, vec![("Attack", 5)])],
            skill_cuffs: vec![],
            skill_base: vec![attack_skill_base()],
            teni_skill_base: vec![],
            ability_types: labels(),
        }
    }

    #[test]
    fn finds_a_valid_set_combining_armor_and_decoration() {
        let data = two_skill_test_data();
        let input = SearchInput {
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 10 }],
            job: Job::Both,
            max_results: 10,
        };
        let results = search(&data, &input);
        assert!(!results.is_empty(), "expected at least one valid Attack+10 set");
        for r in &results {
            let attack = r.active_skills.iter().find(|s| s.skill_name == "Attack").expect("Attack must be active");
            // At least the +1 tier (10 pts) is required; a set that happens
            // to reach +2 (20 pts) also legitimately satisfies "at least 10".
            assert!(attack.point >= 10, "expected Attack >= 10, got {}", attack.point);
        }
    }

    #[test]
    fn respects_the_max_results_cap() {
        let data = two_skill_test_data();
        let input = SearchInput {
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 10 }],
            job: Job::Both,
            max_results: 1,
        };
        let results = search(&data, &input);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn returns_empty_when_the_target_is_unreachable() {
        let data = two_skill_test_data();
        let input = SearchInput {
            // Max reachable is 5 geared pieces (25) + 1 jewel (5) = 30; ask for more.
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 999 }],
            job: Job::Both,
            max_results: 10,
        };
        let results = search(&data, &input);
        assert!(results.is_empty());
    }

    #[test]
    fn every_returned_set_is_independently_valid_per_the_evaluator() {
        // Soundness check, matching the plan's Phase 4 correctness bar: don't
        // just trust the search's own bookkeeping — re-verify every result
        // with a fresh evaluate_loadout call built straight from its names.
        let data = two_skill_test_data();
        let input = SearchInput {
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 10 }],
            job: Job::Both,
            max_results: 10,
        };
        let results = search(&data, &input);
        assert!(!results.is_empty());

        fn find<'a>(slot: &'a [EquipData], name: &str) -> &'a EquipData {
            slot.iter().find(|p| p.name == name).unwrap()
        }
        for r in &results {
            let loadout = Loadout {
                weapon: None,
                head: EquippedPiece { data: find(&data.head, &r.head), level: 1 },
                body: EquippedPiece { data: find(&data.body, &r.body), level: 1 },
                arm: EquippedPiece { data: find(&data.arm, &r.arm), level: 1 },
                waist: EquippedPiece { data: find(&data.waist, &r.waist), level: 1 },
                leg: EquippedPiece { data: find(&data.leg, &r.leg), level: 1 },
                decorations: r.decorations.iter().map(|n| data.jewels.iter().find(|j| &j.name == n).unwrap()).collect(),
                skill_cuffs: vec![],
            };
            let eval = evaluate_loadout(&loadout, &data);
            assert!(eval.active_skills.get("Attack").is_some_and(|a| a.point >= 10));
            assert_eq!(eval.total_defense, r.total_defense);
        }
    }

    /// Confirms the corrected slot model: a single piece's `Slot` value is a
    /// *capacity* multiple small jewels can share, not one socket sized up
    /// to that value. A piece with 3 capacity and only 1-slot jewels
    /// available must be able to fit three of them for a x3 contribution.
    #[test]
    fn one_piece_can_host_multiple_decorations_up_to_its_slot_capacity() {
        let three_slot_piece = armor("Three Slot Head", 50, 3, vec![]);
        let no_slot_piece = armor("No Slot Body", 50, 0, vec![]);
        let data = GameData {
            head: vec![three_slot_piece],
            body: vec![no_slot_piece.clone()],
            arm: vec![no_slot_piece.clone()],
            waist: vec![no_slot_piece.clone()],
            leg: vec![no_slot_piece],
            weapons: vec![],
            jewels: vec![jewel("Attack 1-Slot", 1, vec![("Attack", 7)])],
            skill_cuffs: vec![],
            skill_base: vec![attack_skill_base()],
            teni_skill_base: vec![],
            ability_types: labels(),
        };
        let input = SearchInput {
            // No armor piece grants Attack directly, and the "Attack +2"
            // tier needs a raw sum >= 20 (see attack_skill_base): two
            // 1-slot/+7 jewels only reach 14 (still just the "+1"/10 tier),
            // so this is only reachable by placing three of them (21) into
            // the single 3-capacity head piece — proving one piece can host
            // more than one decoration.
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 20 }],
            job: Job::Both,
            max_results: 5,
        };
        let results = search(&data, &input);
        assert!(!results.is_empty(), "expected the 3-capacity piece to host three 1-slot jewels");
        let best = &results[0];
        assert_eq!(best.decorations.len(), 3);
        assert!(best.decorations.iter().all(|d| d == "Attack 1-Slot"));
    }

    /// Confirms weapons are actually selected and contribute both their own
    /// skill points and their decoration slot capacity — the gap the user
    /// flagged directly (weapons were previously never chosen at all).
    #[test]
    fn weapon_contributes_skill_points_and_decoration_slots() {
        let plain_armor_piece = armor("Plain", 50, 0, vec![]);
        let weapon_with_slot = WeaponData {
            name: "Attack Sword".into(),
            job: Job::Both,
            sex: Sex::Both,
            rare: 5,
            elemental: Elemental { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
            levels: vec![LevelEntry {
                level: 1,
                def: None,
                atk: Some(100),
                slot: 2,
                cost: Cost { money: 0, cost_type: Some(CostType::Create), items: vec![] },
            }],
            abilities: vec![],
            skills: vec![SkillContribution { skill_name: "Attack".into(), point: 5 }],
        };
        let data = GameData {
            head: vec![plain_armor_piece.clone()],
            body: vec![plain_armor_piece.clone()],
            arm: vec![plain_armor_piece.clone()],
            waist: vec![plain_armor_piece.clone()],
            leg: vec![plain_armor_piece],
            weapons: vec![weapon_with_slot],
            jewels: vec![jewel("Attack 2-Slot", 2, vec![("Attack", 5)])],
            skill_cuffs: vec![],
            skill_base: vec![attack_skill_base()],
            teni_skill_base: vec![],
            ability_types: labels(),
        };
        let input = SearchInput {
            // Only reachable via the weapon's own +5 plus one 2-slot jewel
            // (+5) placed in the weapon's own 2-capacity slot: no armor
            // piece contributes anything here.
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 10 }],
            job: Job::Both,
            max_results: 5,
        };
        let results = search(&data, &input);
        assert!(!results.is_empty(), "expected the weapon's own skill + slot to be usable");
        assert_eq!(results[0].weapon.as_deref(), Some("Attack Sword"));
        assert_eq!(results[0].decorations, vec!["Attack 2-Slot".to_string()]);
    }
}
