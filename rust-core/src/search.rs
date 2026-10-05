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
use crate::schema::{Elemental, EquipData, GameData, Job, JewelData, SkillName, WeaponData};
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
    /// Restricts armor candidates the *search chooses* to these `EquipData`
    /// `equip_type` values (see schema.rs's doc comment for the value set) —
    /// empty means unfiltered. Weapons have no `Type` field in the original
    /// data, so this never applies to weapon candidates. Mirrors
    /// `MHSX2.EquipTypeCondition.Evaluate` (decompiled source): exact string
    /// equality against the piece's own Type, not a substring/fuzzy match.
    pub allowed_equip_types: Vec<String>,
    /// User-specified fixed pieces (by exact name) for any subset of the 6
    /// equip slots, each optionally with its own fixed decorations already
    /// attached — mirrors the original's `Equipment.GetFixedJewelys()`
    /// (decompiled `Equipment.cs`): up to 3 decorations pre-placed in a
    /// piece, consuming part of its slot capacity, with the rest of that
    /// piece's capacity (if any) and every non-preset slot still filled
    /// normally by the search. A preset slot bypasses job/equip-type
    /// filtering entirely -- the caller chose it explicitly.
    pub presets: SearchPresets,
}

/// Identifies which of the 6 equip slots a decoration was placed into —
/// used to report a per-piece decoration breakdown on `FoundSet` (the
/// original's equipment-clip export shows decorations inline on each
/// piece's own line, not as one flat list for the whole set).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EquipSlot {
    Head,
    Body,
    Arm,
    Waist,
    Leg,
    Weapon,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiecePreset {
    pub name: String,
    #[serde(default)]
    pub decorations: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPresets {
    pub head: Option<PiecePreset>,
    pub body: Option<PiecePreset>,
    pub arm: Option<PiecePreset>,
    pub waist: Option<PiecePreset>,
    pub leg: Option<PiecePreset>,
    pub weapon: Option<PiecePreset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundSkill {
    pub skill_name: SkillName,
    pub option_name: String,
    pub point: i32,
    /// True for a skill granted via a Senyu (遷悠) ability — pre-satisfied,
    /// not a tiered-lookup result from a raw point sum. Lets UI/export code
    /// group skills the way the original's equipment-clip export does
    /// (separate "passive"/Senyu vs. regular "activated skills" sections).
    pub from_senyu: bool,
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
    /// Every decoration used in this set, flattened across all 6 slots —
    /// kept for callers that just want the whole-set list (e.g. the results
    /// grid's "Decorations" column).
    pub decorations: Vec<String>,
    /// The same decorations, broken out per slot (mirrors the original
    /// equipment-clip export's per-piece decoration display) — empty when
    /// that slot has no decorations.
    pub weapon_decorations: Vec<String>,
    pub head_decorations: Vec<String>,
    pub body_decorations: Vec<String>,
    pub arm_decorations: Vec<String>,
    pub waist_decorations: Vec<String>,
    pub leg_decorations: Vec<String>,
    pub total_defense: i32,
    pub resistances: Elemental,
    /// Distinct Teni-tree skill names present on this loadout (membership
    /// only, same as `evaluator::EvaluationResult::teni_skill_names`) — the
    /// original's equipment-clip export lists these in their own section
    /// separate from regular active skills.
    pub teni_skill_names: Vec<String>,
    pub active_skills: Vec<FoundSkill>,
}

const MAX_CANDIDATES_PER_SLOT: usize = 24;
const MAX_FILLER_PER_SLOT: usize = 6;
const MAX_NODES_VISITED: u64 = 3_000_000;

fn job_compatible(piece_job: Job, wanted: Job) -> bool {
    piece_job == Job::Both || wanted == Job::Both || piece_job == wanted
}

/// Empty `allowed` means unfiltered — matches `SearchInput::allowed_equip_types`'s
/// "empty = no restriction" convention.
fn type_allowed(piece_type: &str, allowed: &[String]) -> bool {
    allowed.is_empty() || allowed.iter().any(|t| t == piece_type)
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
fn shortlist<'a>(pieces: &'a [EquipData], job: Job, target_names: &[&str], allowed_types: &[String]) -> Vec<&'a EquipData> {
    let compatible: Vec<&EquipData> =
        pieces.iter().filter(|p| job_compatible(p.job, job) && type_allowed(&p.equip_type, allowed_types)).collect();

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

    // Fillers (no relevance to any target skill): prefer real combat
    // weapons over zero-stat utility ones (e.g. "Weapon(Eating)", kept
    // purely to grant one ability with no Atk at all) by sorting on Atk
    // descending, rather than taking whichever happens to sort first in the
    // source file.
    let mut fillers: Vec<&WeaponData> = compatible;
    fillers.sort_by_key(|w| std::cmp::Reverse(best_weapon_level(w).atk.unwrap_or(0)));
    for w in fillers {
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
    /// Fixed decorations from `SearchInput::presets`, flattened across every
    /// preset slot (armor and weapon) — always included in every accepted
    /// result's `decorations`, on top of whatever `fill_decorations` adds
    /// for the remaining open capacity. Their skill contributions are
    /// already baked into each weapon pass's starting `running` vector (see
    /// `search()`), so no further bookkeeping is needed for them here.
    preset_decorations: Vec<(EquipSlot, &'a JewelData)>,
    /// Per-armor-slot (head..leg, matching `pieces`'s index order) capacity
    /// already consumed by that slot's preset decorations, if any — 0 for
    /// every non-preset slot.
    armor_reserved_capacity: [u8; 5],
    /// Same idea as `armor_reserved_capacity`, for the selected weapon's
    /// preset decorations (0 when the weapon slot has no preset).
    weapon_reserved_capacity: u8,
    /// How many results this weapon pass may still contribute, and how many
    /// `results` already held when this pass started — together these cap
    /// any single weapon's share of the result set (see `search()`), so
    /// results aren't dominated by whichever weapon the odometer tries
    /// first exhausting the whole budget before any other weapon is tried.
    per_weapon_cap: usize,
    weapon_pass_start_count: usize,
}

impl SearchState<'_> {
    /// The overall stop condition, independent of which weapon pass (if
    /// any) is currently running — this is what the outer weapon loop in
    /// `search()` checks *before* starting a new pass, since that pass's
    /// own `weapon_pass_start_count`/`per_weapon_cap` haven't been set for
    /// it yet and would otherwise still hold the previous weapon's values.
    fn overall_budget_exhausted(&self) -> bool {
        self.results.len() >= self.max_results || self.nodes_visited >= MAX_NODES_VISITED
    }

    /// The full stop condition used inside a weapon pass's own recursion:
    /// the overall cap, plus this pass's fair-share cap (see
    /// `per_weapon_cap`'s doc comment).
    fn budget_exhausted(&self) -> bool {
        self.overall_budget_exhausted() || self.results.len() - self.weapon_pass_start_count >= self.per_weapon_cap
    }
}

/// A decoration-capacity estimate for the bound: total open-slot *units*
/// across every piece that will end up equipped, both armor and weapon.
///
/// This must include capacity from pieces **already chosen** (depth
/// `0..chosen_count`) as well as the weapon's own slots, not just a generic
/// `3 * slots not yet chosen` estimate for the armor pieces still to pick —
/// an earlier version counted only the latter, which made the bound shrink
/// toward zero as recursion went deeper even though a chosen piece's real
/// capacity (plus the weapon's) was still fully available for decorations
/// placed at the leaf by `fill_decorations`. That under-count made the
/// bound inadmissible (it could claim a reachable target was impossible),
/// which was confirmed live: presetting a real, directly-relevant piece
/// (e.g. a head granting +5 Strong Attack, Skill Slots Up+1, 3 slots) into
/// a multi-target search returned "no sets found" in under a tenth of a
/// second -- far too fast to be real node-budget exhaustion -- and
/// temporarily forcing this function to return `true` immediately produced
/// 20 valid results, confirming the bound (not a real infeasibility) was
/// at fault.
///
/// Already-chosen pieces use their *actual* capacity (minus whatever a
/// preset already reserved on that piece); not-yet-chosen armor slots keep
/// the deliberately generous `3 per slot` overestimate (the real pieces
/// aren't known yet, so the admissible bound is "as if every one of them
/// turned out to be a full 3-capacity piece").
fn remaining_decoration_capacity(state: &SearchState, chosen_count: usize, chosen: &[Option<&EquipData>; 5]) -> f64 {
    let mut capacity: u32 = 0;
    for (i, piece) in chosen.iter().enumerate().take(chosen_count) {
        if let Some(piece) = piece {
            capacity += best_level(piece).slot.saturating_sub(state.armor_reserved_capacity[i]) as u32;
        }
    }
    capacity += ((5 - chosen_count) * 3) as u32;
    if let Some(weapon) = state.weapon {
        capacity += best_weapon_level(weapon).slot.saturating_sub(state.weapon_reserved_capacity) as u32;
    }
    capacity as f64
}

fn is_promising(state: &SearchState, chosen_count: usize, chosen: &[Option<&EquipData>; 5], running: &[i32]) -> bool {
    let capacity = remaining_decoration_capacity(state, chosen_count, chosen);
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
fn fill_decorations<'a>(
    jewels: &'a [JewelData],
    piece_buckets: &[(EquipSlot, u8)],
    deficits: &[(SkillName, i32)],
) -> Vec<(EquipSlot, &'a JewelData)> {
    let mut buckets: Vec<u8> = piece_buckets.iter().map(|(_, cap)| *cap).collect();
    let mut chosen: Vec<(EquipSlot, &JewelData)> = Vec::new();
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
            chosen.push((piece_buckets[bucket_idx].0, jewel));
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
    if state.budget_exhausted() {
        return;
    }
    state.nodes_visited += 1;

    if chosen_count == 5 {
        try_accept(state, chosen, running);
        return;
    }

    if !is_promising(state, chosen_count, chosen, running) {
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
        if state.budget_exhausted() {
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
    // Each slot's open capacity is its full slot count minus whatever its
    // own preset decorations already consumed (0 for non-preset slots) --
    // see `armor_reserved_capacity`/`weapon_reserved_capacity`'s doc
    // comments. Tagged with the owning slot so `fill_decorations`'s
    // placements can be reported per piece, not just as one flat list.
    const ARMOR_SLOT_ORDER: [EquipSlot; 5] = [EquipSlot::Head, EquipSlot::Body, EquipSlot::Arm, EquipSlot::Waist, EquipSlot::Leg];
    let mut buckets: Vec<(EquipSlot, u8)> = pieces
        .iter()
        .enumerate()
        .map(|(i, p)| (ARMOR_SLOT_ORDER[i], best_level(p).slot.saturating_sub(state.armor_reserved_capacity[i])))
        .filter(|(_, cap)| *cap > 0)
        .collect();
    if let Some(weapon) = state.weapon {
        let weapon_slot = best_weapon_level(weapon).slot.saturating_sub(state.weapon_reserved_capacity);
        if weapon_slot > 0 {
            buckets.push((EquipSlot::Weapon, weapon_slot));
        }
    }

    let deficits: Vec<(SkillName, i32)> = state
        .targets
        .iter()
        .enumerate()
        .filter(|(i, t)| running[*i] < t.min_point)
        .map(|(i, t)| (t.skill_name.clone(), t.min_point - running[i]))
        .collect();
    let mut placed: Vec<(EquipSlot, &JewelData)> = state.preset_decorations.clone();
    placed.extend(fill_decorations(state.jewels, &buckets, &deficits));

    let decorations: Vec<&JewelData> = placed.iter().map(|(_, j)| *j).collect();
    let by_slot = |slot: EquipSlot| -> Vec<String> { placed.iter().filter(|(s, _)| *s == slot).map(|(_, j)| j.name.clone()).collect() };

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

    // `result.active_skills` is a HashMap, so its iteration order carries no
    // meaning -- without an explicit sort here, which skills happened to
    // land in the UI's first few "Skill N" columns was effectively random,
    // not necessarily the skills the caller actually searched for. Put the
    // requested targets first, in the order the caller gave them, then any
    // other (incidental/bonus) active skills by descending point value.
    let target_order: HashMap<&str, usize> =
        state.targets.iter().enumerate().map(|(i, t)| (t.skill_name.as_str(), i)).collect();
    let mut active_skills: Vec<FoundSkill> = result
        .active_skills
        .iter()
        .map(|(name, a)| FoundSkill {
            skill_name: name.clone(),
            option_name: a.option_name.clone(),
            point: a.point,
            from_senyu: a.from_senyu,
        })
        .collect();
    active_skills.sort_by(|a, b| {
        let a_rank = target_order.get(a.skill_name.as_str());
        let b_rank = target_order.get(b.skill_name.as_str());
        match (a_rank, b_rank) {
            (Some(x), Some(y)) => x.cmp(y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => b.point.cmp(&a.point).then_with(|| a.skill_name.cmp(&b.skill_name)),
        }
    });

    state.results.push(FoundSet {
        weapon: state.weapon.map(|w| w.name.clone()),
        head: pieces[0].name.clone(),
        body: pieces[1].name.clone(),
        arm: pieces[2].name.clone(),
        waist: pieces[3].name.clone(),
        leg: pieces[4].name.clone(),
        decorations: decorations.iter().map(|d| d.name.clone()).collect(),
        weapon_decorations: by_slot(EquipSlot::Weapon),
        head_decorations: by_slot(EquipSlot::Head),
        body_decorations: by_slot(EquipSlot::Body),
        arm_decorations: by_slot(EquipSlot::Arm),
        waist_decorations: by_slot(EquipSlot::Waist),
        leg_decorations: by_slot(EquipSlot::Leg),
        total_defense: result.total_defense,
        resistances: result.resistances.clone(),
        teni_skill_names: {
            let mut names: Vec<String> = result.teni_skill_names.iter().cloned().collect();
            names.sort();
            names
        },
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

/// Resolves one armor-slot preset (by exact piece name, with 0-3 named
/// decorations already attached) against the loaded data. `Err` on any name
/// that doesn't resolve, or decorations whose combined slot size exceeds
/// the piece's own capacity — a caller mistake, not a search outcome, so
/// this fails loudly rather than silently dropping the preset.
fn resolve_armor_preset<'a>(
    preset: &Option<PiecePreset>,
    pool: &'a [EquipData],
    jewels: &'a [JewelData],
) -> Result<Option<(&'a EquipData, Vec<&'a JewelData>)>, String> {
    let Some(p) = preset else { return Ok(None) };
    let piece = pool.iter().find(|e| e.name == p.name).ok_or_else(|| format!("preset piece not found: {}", p.name))?;
    let decorations = resolve_preset_decorations(&p.decorations, jewels, best_level(piece).slot, &p.name)?;
    Ok(Some((piece, decorations)))
}

/// Same as `resolve_armor_preset`, for the weapon slot (its own distinct
/// data type/level accessor).
fn resolve_weapon_preset<'a>(
    preset: &Option<PiecePreset>,
    pool: &'a [WeaponData],
    jewels: &'a [JewelData],
) -> Result<Option<(&'a WeaponData, Vec<&'a JewelData>)>, String> {
    let Some(p) = preset else { return Ok(None) };
    let weapon = pool.iter().find(|w| w.name == p.name).ok_or_else(|| format!("preset weapon not found: {}", p.name))?;
    let decorations = resolve_preset_decorations(&p.decorations, jewels, best_weapon_level(weapon).slot, &p.name)?;
    Ok(Some((weapon, decorations)))
}

fn resolve_preset_decorations<'a>(
    names: &[String],
    jewels: &'a [JewelData],
    capacity: u8,
    piece_name: &str,
) -> Result<Vec<&'a JewelData>, String> {
    let mut decorations = Vec::with_capacity(names.len());
    let mut used: u16 = 0;
    for name in names {
        let jewel = jewels.iter().find(|j| &j.name == name).ok_or_else(|| format!("preset decoration not found: {name}"))?;
        used += jewel.slot as u16;
        decorations.push(jewel);
    }
    if used > capacity as u16 {
        return Err(format!(
            "preset decorations for \"{piece_name}\" need {used} slot capacity but it only has {capacity}"
        ));
    }
    Ok(decorations)
}

/// Builds one armor slot's `SlotCandidates` plus how much of that piece's
/// own capacity its preset decorations (if any) already consumed. A preset
/// slot always has exactly one candidate (the chosen piece) and bypasses
/// job/equip-type filtering entirely — the caller picked it explicitly.
fn build_armor_slot<'a>(
    preset: &Option<(&'a EquipData, Vec<&'a JewelData>)>,
    pool: &'a [EquipData],
    job: Job,
    target_names: &[&str],
    allowed_types: &[String],
    targets: &[SearchTarget],
) -> (SlotCandidates<'a>, u8) {
    match preset {
        Some((piece, decorations)) => {
            let reserved: u8 = decorations.iter().map(|j| j.slot).sum();
            let pieces = vec![*piece];
            let max_contribution = max_contribution_per_target(&pieces, targets);
            (SlotCandidates { pieces, max_contribution }, reserved)
        }
        None => {
            let pieces = shortlist(pool, job, target_names, allowed_types);
            let max_contribution = max_contribution_per_target(&pieces, targets);
            (SlotCandidates { pieces, max_contribution }, 0)
        }
    }
}

pub fn search(data: &GameData, input: &SearchInput) -> Result<Vec<FoundSet>, String> {
    let target_names: Vec<&str> = input.targets.iter().map(|t| t.skill_name.as_str()).collect();

    let head_preset = resolve_armor_preset(&input.presets.head, &data.head, &data.jewels)?;
    let body_preset = resolve_armor_preset(&input.presets.body, &data.body, &data.jewels)?;
    let arm_preset = resolve_armor_preset(&input.presets.arm, &data.arm, &data.jewels)?;
    let waist_preset = resolve_armor_preset(&input.presets.waist, &data.waist, &data.jewels)?;
    let leg_preset = resolve_armor_preset(&input.presets.leg, &data.leg, &data.jewels)?;
    let weapon_preset = resolve_weapon_preset(&input.presets.weapon, &data.weapons, &data.jewels)?;

    let (head_slot, head_reserved) =
        build_armor_slot(&head_preset, &data.head, input.job, &target_names, &input.allowed_equip_types, &input.targets);
    let (body_slot, body_reserved) =
        build_armor_slot(&body_preset, &data.body, input.job, &target_names, &input.allowed_equip_types, &input.targets);
    let (arm_slot, arm_reserved) =
        build_armor_slot(&arm_preset, &data.arm, input.job, &target_names, &input.allowed_equip_types, &input.targets);
    let (waist_slot, waist_reserved) =
        build_armor_slot(&waist_preset, &data.waist, input.job, &target_names, &input.allowed_equip_types, &input.targets);
    let (leg_slot, leg_reserved) =
        build_armor_slot(&leg_preset, &data.leg, input.job, &target_names, &input.allowed_equip_types, &input.targets);

    let slots: [SlotCandidates; 5] = [head_slot, body_slot, arm_slot, waist_slot, leg_slot];
    let armor_reserved_capacity = [head_reserved, body_reserved, arm_reserved, waist_reserved, leg_reserved];

    let skill_base: HashMap<String, &crate::schema::SkillBaseEntry> =
        data.skill_base.iter().map(|s| (s.name.clone(), s)).collect();
    let jewel_efficiency = best_jewel_efficiency_per_target(&data.jewels, &input.targets);

    // Weapons contribute both skills and decoration slots (confirmed: the
    // active-skill-count cap is raised by Skill Slots Up on weapons too, not
    // just armor — see docs/rules-spec.md §1's "6 equip slots" scope, and
    // weapons commonly carry slots in real play). Try each shortlisted
    // weapon in turn; `None` only if the loaded data has no weapons at all.
    // A preset weapon short-circuits all of that to the one chosen weapon.
    let (weapon_candidates, weapon_reserved_capacity): (Vec<Option<&WeaponData>>, u8) = match &weapon_preset {
        Some((weapon, decorations)) => (vec![Some(*weapon)], decorations.iter().map(|j| j.slot).sum()),
        None if data.weapons.is_empty() => (vec![None], 0),
        None => (shortlist_weapons(&data.weapons, input.job, &target_names).into_iter().map(Some).collect(), 0),
    };

    let mut preset_decorations: Vec<(EquipSlot, &JewelData)> = Vec::new();
    for (slot, preset) in [
        (EquipSlot::Head, &head_preset),
        (EquipSlot::Body, &body_preset),
        (EquipSlot::Arm, &arm_preset),
        (EquipSlot::Waist, &waist_preset),
        (EquipSlot::Leg, &leg_preset),
    ] {
        if let Some((_, decorations)) = preset {
            preset_decorations.extend(decorations.iter().map(|j| (slot, *j)));
        }
    }
    if let Some((_, decorations)) = &weapon_preset {
        preset_decorations.extend(decorations.iter().map(|j| (EquipSlot::Weapon, *j)));
    }
    // Preset decorations' skill contributions are a fixed baseline on top of
    // whichever weapon is tried — folded into `running` below, once per
    // weapon pass, the same way a selected weapon's own skills are.
    let preset_deltas: Vec<i32> = input
        .targets
        .iter()
        .map(|t| {
            preset_decorations
                .iter()
                .filter_map(|(_, j)| j.skills.iter().find(|s| s.skill_name == t.skill_name))
                .map(|s| s.point)
                .sum()
        })
        .collect();

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
        per_weapon_cap: input.max_results,
        weapon_pass_start_count: 0,
        preset_decorations,
        armor_reserved_capacity,
        weapon_reserved_capacity,
    };

    let weapon_count = weapon_candidates.len();
    for (i, weapon) in weapon_candidates.into_iter().enumerate() {
        if state.overall_budget_exhausted() {
            break;
        }
        state.weapon = weapon;
        state.weapon_pass_start_count = state.results.len();
        // Give each remaining weapon a fair share of what's left of the
        // overall budget, so one early weapon with abundant valid armor
        // combinations (e.g. a zero-stat utility weapon that nonetheless
        // satisfies the skill targets) can't alone fill every result slot
        // before any other weapon is even tried.
        let remaining_budget = input.max_results.saturating_sub(state.results.len());
        let remaining_weapons = weapon_count - i;
        state.per_weapon_cap = remaining_budget.div_ceil(remaining_weapons).max(1);
        let mut chosen: [Option<&EquipData>; 5] = [None; 5];
        let mut running = weapon_deltas(weapon, &input.targets);
        for (j, d) in preset_deltas.iter().enumerate() {
            running[j] += d;
        }
        recurse(&mut state, 0, &mut chosen, &mut running);
    }
    Ok(state.results)
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
            category: "Offense and Adren".into(),
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
            allowed_equip_types: vec![],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
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
            allowed_equip_types: vec![],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
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
            allowed_equip_types: vec![],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
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
            allowed_equip_types: vec![],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
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
            allowed_equip_types: vec![],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
        assert!(!results.is_empty(), "expected the 3-capacity piece to host three 1-slot jewels");
        let best = &results[0];
        assert_eq!(best.decorations.len(), 3);
        assert!(best.decorations.iter().all(|d| d == "Attack 1-Slot"));
        // All three must be reported under the head slot specifically (the
        // only piece with any capacity in this fixture), not scattered
        // across the other empty-capacity slots.
        assert_eq!(best.head_decorations.len(), 3);
        assert!(best.body_decorations.is_empty() && best.weapon_decorations.is_empty());
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
            allowed_equip_types: vec![],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
        assert!(!results.is_empty(), "expected the weapon's own skill + slot to be usable");
        assert_eq!(results[0].weapon.as_deref(), Some("Attack Sword"));
        assert_eq!(results[0].decorations, vec!["Attack 2-Slot".to_string()]);
        // Regression: the decoration must be reported under the weapon's
        // own per-slot breakdown, not just the flat `decorations` list --
        // no armor piece has any slot capacity in this fixture.
        assert_eq!(results[0].weapon_decorations, vec!["Attack 2-Slot".to_string()]);
        assert!(results[0].head_decorations.is_empty());
    }

    /// Regression test for a real issue found via a live browser run: every
    /// result picked the exact same weapon, because the outer weapon loop
    /// tried candidates in order and exhausted the whole `max_results`
    /// budget on the first one before any other weapon was ever tried.
    /// With two equally-relevant weapons and more than one valid armor
    /// combo available for each, requesting enough results must surface
    /// more than one weapon, not just whichever came first.
    #[test]
    fn results_are_not_dominated_by_a_single_weapon_when_alternatives_exist() {
        let head_a = armor("Head A", 50, 0, vec![]);
        let head_b = armor("Head B", 60, 0, vec![]);
        let plain = armor("Plain", 50, 0, vec![]);
        let weapon = |name: &str| WeaponData {
            name: name.into(),
            job: Job::Both,
            sex: Sex::Both,
            rare: 5,
            elemental: Elemental { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
            levels: vec![LevelEntry {
                level: 1,
                def: None,
                atk: Some(100),
                slot: 0,
                cost: Cost { money: 0, cost_type: Some(CostType::Create), items: vec![] },
            }],
            abilities: vec![],
            skills: vec![SkillContribution { skill_name: "Attack".into(), point: 10 }],
        };
        let data = GameData {
            head: vec![head_a, head_b],
            body: vec![plain.clone()],
            arm: vec![plain.clone()],
            waist: vec![plain.clone()],
            leg: vec![plain],
            weapons: vec![weapon("Sword A"), weapon("Sword B")],
            jewels: vec![],
            skill_cuffs: vec![],
            skill_base: vec![attack_skill_base()],
            teni_skill_base: vec![],
            ability_types: labels(),
        };
        let input = SearchInput {
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 10 }],
            job: Job::Both,
            max_results: 4,
            allowed_equip_types: vec![],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
        let distinct_weapons: std::collections::HashSet<_> = results.iter().filter_map(|r| r.weapon.as_deref()).collect();
        assert!(
            distinct_weapons.len() > 1,
            "expected more than one weapon across results, got only: {distinct_weapons:?}"
        );
    }

    /// Regression test: `active_skills` must list the requested targets
    /// first, in the order the caller gave them -- not whatever order a
    /// `HashMap` iteration happens to produce (which is meaningless and, in
    /// a live browser run, put unrelated skills in the UI's "Skill 1"
    /// column instead of the skill the user actually searched for).
    #[test]
    fn active_skills_lists_requested_targets_first_in_request_order() {
        fn skill_base(name: &str) -> SkillBaseEntry {
            SkillBaseEntry {
                no: 1,
                id: "0001".into(),
                name: name.into(),
                category: "Test".into(),
                skill_rank: false,
                options: vec![SkillOption { name: format!("{name} +1"), point: 10 }],
            }
        }
        // One piece grants all three skills; the target list deliberately
        // requests them in the opposite order from how they're defined
        // below, so a correct implementation can't pass by accident.
        let loaded_head = armor("Loaded Head", 50, 0, vec![("Attack", 10), ("Health", 10), ("Stealth", 10)]);
        let plain = armor("Plain", 50, 0, vec![]);
        let data = GameData {
            head: vec![loaded_head],
            body: vec![plain.clone()],
            arm: vec![plain.clone()],
            waist: vec![plain.clone()],
            leg: vec![plain],
            weapons: vec![],
            jewels: vec![],
            skill_cuffs: vec![],
            skill_base: vec![skill_base("Attack"), skill_base("Health"), skill_base("Stealth")],
            teni_skill_base: vec![],
            ability_types: labels(),
        };
        let input = SearchInput {
            targets: vec![
                SearchTarget { skill_name: "Health".into(), min_point: 10 },
                SearchTarget { skill_name: "Attack".into(), min_point: 10 },
            ],
            job: Job::Both,
            max_results: 1,
            allowed_equip_types: vec![],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
        assert_eq!(results.len(), 1);
        let names: Vec<&str> = results[0].active_skills.iter().map(|s| s.skill_name.as_str()).collect();
        assert_eq!(&names[0..2], &["Health", "Attack"], "targets must come first, in request order: {names:?}");
        assert!(names.contains(&"Stealth"), "the incidental bonus skill should still be listed: {names:?}");
    }

    /// A preset armor piece must be used in every result (the search never
    /// substitutes a different head piece), and its preset decoration must
    /// consume that piece's own capacity -- a 3-capacity preset piece with
    /// one 2-slot decoration already fitted has only 1 capacity left, so
    /// only a 1-slot filler can be added on top of it.
    #[test]
    fn preset_armor_piece_is_locked_and_its_decoration_consumes_capacity() {
        let preset_head = armor("Preset Head", 50, 3, vec![]);
        let other_head = armor("Other Head", 999, 3, vec![]); // higher defense, must NOT be chosen
        let plain = armor("Plain", 50, 0, vec![]);
        let data = GameData {
            head: vec![preset_head, other_head],
            body: vec![plain.clone()],
            arm: vec![plain.clone()],
            waist: vec![plain.clone()],
            leg: vec![plain],
            weapons: vec![],
            jewels: vec![jewel("Attack 2-Slot", 2, vec![("Attack", 10)]), jewel("Attack 1-Slot", 1, vec![("Attack", 5)])],
            skill_cuffs: vec![],
            skill_base: vec![attack_skill_base()],
            teni_skill_base: vec![],
            ability_types: labels(),
        };
        let input = SearchInput {
            // 10 (preset 2-slot) + 5 (auto-filled 1-slot) = 15, enough for
            // the "Attack +1" tier (10pts) but only reachable this way since
            // no piece grants Attack directly.
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 10 }],
            job: Job::Both,
            max_results: 5,
            allowed_equip_types: vec![],
            presets: SearchPresets {
                head: Some(PiecePreset { name: "Preset Head".into(), decorations: vec!["Attack 2-Slot".into()] }),
                ..Default::default()
            },
        };
        let results = search(&data, &input).unwrap();
        assert!(!results.is_empty(), "expected the preset head + one more 1-slot jewel to reach Attack+10");
        for r in &results {
            assert_eq!(r.head, "Preset Head", "the preset piece must be used, not substituted");
            assert!(r.decorations.contains(&"Attack 2-Slot".to_string()), "the preset decoration must appear in the result");
            let two_slot_count = r.decorations.iter().filter(|d| *d == "Attack 2-Slot").count();
            assert_eq!(two_slot_count, 1, "the preset decoration must not be duplicated");
            // Only 1 capacity remains after the preset 2-slot decoration, so
            // no second 2-slot jewel can be auto-added.
            assert!(
                r.decorations.iter().filter(|d| *d == "Attack 1-Slot").count() <= 1,
                "only a 1-slot filler fits in the remaining capacity: {:?}",
                r.decorations
            );
            // Both the preset decoration and any auto-filled one belong to
            // the head slot specifically -- they're all on the same piece.
            assert_eq!(r.head_decorations.len(), r.decorations.len());
        }
    }

    /// Same idea as the armor preset test, for the weapon slot: a preset
    /// weapon must be used in every result instead of the search choosing
    /// among candidates.
    #[test]
    fn preset_weapon_is_locked_across_all_results() {
        let plain = armor("Plain", 50, 0, vec![]);
        let weapon = |name: &str, atk: i32| WeaponData {
            name: name.into(),
            job: Job::Both,
            sex: Sex::Both,
            rare: 5,
            elemental: Elemental { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
            levels: vec![LevelEntry {
                level: 1,
                def: None,
                atk: Some(atk),
                slot: 0,
                cost: Cost { money: 0, cost_type: Some(CostType::Create), items: vec![] },
            }],
            abilities: vec![],
            skills: vec![SkillContribution { skill_name: "Attack".into(), point: 10 }],
        };
        let data = GameData {
            head: vec![plain.clone()],
            body: vec![plain.clone()],
            arm: vec![plain.clone()],
            waist: vec![plain.clone()],
            leg: vec![plain],
            weapons: vec![weapon("Preset Sword", 50), weapon("Other Sword", 999)],
            jewels: vec![],
            skill_cuffs: vec![],
            skill_base: vec![attack_skill_base()],
            teni_skill_base: vec![],
            ability_types: labels(),
        };
        let input = SearchInput {
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 10 }],
            job: Job::Both,
            max_results: 5,
            allowed_equip_types: vec![],
            presets: SearchPresets { weapon: Some(PiecePreset { name: "Preset Sword".into(), decorations: vec![] }), ..Default::default() },
        };
        let results = search(&data, &input).unwrap();
        assert!(!results.is_empty());
        for r in &results {
            assert_eq!(r.weapon.as_deref(), Some("Preset Sword"));
        }
    }

    #[test]
    fn preset_decorations_exceeding_piece_capacity_return_an_error() {
        let data = two_skill_test_data();
        let input = SearchInput {
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 10 }],
            job: Job::Both,
            max_results: 5,
            allowed_equip_types: vec![],
            presets: SearchPresets {
                // "Head Geared" (from two_skill_test_data) has 1 capacity;
                // two 1-slot jewels need 2.
                head: Some(PiecePreset {
                    name: "Head Geared".into(),
                    decorations: vec!["Attack Jewel".into(), "Attack Jewel".into()],
                }),
                ..Default::default()
            },
        };
        let err = search(&data, &input).expect_err("decorations exceeding the piece's own capacity must be rejected");
        assert!(err.contains("Head Geared"), "error should name the offending piece: {err}");
    }

    #[test]
    fn unknown_preset_piece_name_returns_an_error() {
        let data = two_skill_test_data();
        let input = SearchInput {
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 10 }],
            job: Job::Both,
            max_results: 5,
            allowed_equip_types: vec![],
            presets: SearchPresets { head: Some(PiecePreset { name: "Nonexistent Head".into(), decorations: vec![] }), ..Default::default() },
        };
        let err = search(&data, &input).expect_err("an unknown preset piece name must be rejected");
        assert!(err.contains("Nonexistent Head"));
    }

    /// `allowed_equip_types` must restrict which armor pieces the search is
    /// free to choose for non-preset slots -- a high-defense piece of a
    /// disallowed type must never appear even though it would otherwise win
    /// on relevance/defense.
    #[test]
    fn equip_type_filter_restricts_armor_candidates_the_search_chooses() {
        let mut allowed_type_piece = armor("Allowed Type Head", 50, 0, vec![]);
        allowed_type_piece.equip_type = "G Rank Armour".into();
        let mut disallowed_type_piece = armor("Disallowed Type Head", 999, 0, vec![]);
        disallowed_type_piece.equip_type = "Zenith".into();
        let plain = armor("Plain", 50, 0, vec![]);
        let data = GameData {
            head: vec![allowed_type_piece, disallowed_type_piece],
            body: vec![plain.clone()],
            arm: vec![plain.clone()],
            waist: vec![plain.clone()],
            leg: vec![plain],
            weapons: vec![],
            jewels: vec![],
            skill_cuffs: vec![],
            skill_base: vec![attack_skill_base()],
            teni_skill_base: vec![],
            ability_types: labels(),
        };
        let input = SearchInput {
            targets: vec![],
            job: Job::Both,
            max_results: 10,
            allowed_equip_types: vec!["G Rank Armour".into()],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
        assert!(!results.is_empty());
        for r in &results {
            assert_eq!(r.head, "Allowed Type Head", "a disallowed-type piece must never be chosen: {:?}", r.head);
        }
    }

    /// Regression test for a real false-negative bug found via a live
    /// preset search (reported by the user: presetting a real, directly
    /// relevant head piece into a multi-target search returned "no sets
    /// found" in under 50ms -- far too fast for genuine node-budget
    /// exhaustion). Root cause: `remaining_decoration_capacity`'s bound
    /// only counted a generous `3 * slots not yet chosen` estimate for
    /// armor, dropping both the *already-chosen* pieces' real capacity and
    /// the weapon's own capacity entirely -- making the bound shrink to
    /// near-zero deep in the recursion and incorrectly prune reachable
    /// targets.
    ///
    /// This fixture needs the bug at a specific depth: head and the weapon
    /// each have 3 slots; every other armor piece has 0. Reaching Attack+30
    /// via decorations alone needs all 6 available slots (3+3) filled with
    /// +5 jewels. By the time the old bound was evaluated before choosing
    /// the 5th (leg) slot, it only credited 3 units of future armor
    /// capacity (leg's generous estimate) plus zero for the already-chosen
    /// head and the weapon -- 15 points of reachable decoration value
    /// against a 30-point deficit -- an incorrect prune of a real solution.
    #[test]
    fn decoration_capacity_bound_counts_already_chosen_and_weapon_slots() {
        let three_slot_head = armor("Three Slot Head", 50, 3, vec![]);
        let no_slot_piece = armor("No Slot Piece", 50, 0, vec![]);
        let weapon_with_slots = WeaponData {
            name: "Three Slot Weapon".into(),
            job: Job::Both,
            sex: Sex::Both,
            rare: 5,
            elemental: Elemental { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
            levels: vec![LevelEntry {
                level: 1,
                def: None,
                atk: Some(100),
                slot: 3,
                cost: Cost { money: 0, cost_type: Some(CostType::Create), items: vec![] },
            }],
            abilities: vec![],
            skills: vec![],
        };
        let data = GameData {
            head: vec![three_slot_head],
            body: vec![no_slot_piece.clone()],
            arm: vec![no_slot_piece.clone()],
            waist: vec![no_slot_piece.clone()],
            leg: vec![no_slot_piece],
            weapons: vec![weapon_with_slots],
            jewels: vec![jewel("Attack 1-Slot", 1, vec![("Attack", 5)])],
            skill_cuffs: vec![],
            // A custom skill base with a tier reachable at exactly 30 raw
            // points -- attack_skill_base()'s highest option tops out at
            // 20, which would cap the activated skill below the 30-point
            // target regardless of the bound fix being tested here.
            skill_base: vec![SkillBaseEntry {
                no: 1,
                id: "0001".into(),
                name: "Attack".into(),
                category: "Offense and Adren".into(),
                skill_rank: false,
                options: vec![SkillOption { name: "Attack +3".into(), point: 30 }],
            }],
            teni_skill_base: vec![],
            ability_types: labels(),
        };
        let input = SearchInput {
            // Only reachable by filling all 6 available slots (head's 3 +
            // weapon's 3) with +5 jewels: 6 * 5 = 30.
            targets: vec![SearchTarget { skill_name: "Attack".into(), min_point: 30 }],
            job: Job::Both,
            max_results: 5,
            allowed_equip_types: vec![],
            presets: SearchPresets::default(),
        };
        let results = search(&data, &input).unwrap();
        assert!(!results.is_empty(), "expected Attack+30 to be reachable via 6 decorations split across head and weapon");
        assert_eq!(results[0].decorations.len(), 6);
    }
}

