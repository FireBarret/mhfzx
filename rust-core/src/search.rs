//! Armor-set search engine: branch-and-bound over the 5 armor slots +
//! bounded subset-sum/DP fill for decorations and skill cuffs, parallelized
//! across a Worker pool on the JS side.
//!
//! BLOCKED on docs/rules-spec.md (Phase 0) and on `evaluator::evaluate_loadout`
//! (Phase 3) existing first — the bound function here must be validated
//! against the evaluator before it's trusted to prune anything, per the
//! project plan's Phase 4 ("never prune a true positive").

use crate::schema::GameData;

pub struct SearchTargets {
    pub skill_targets: Vec<(crate::schema::SkillName, i32)>,
    // TODO(Phase 0): EquipSetConditions (EquipTypeCondition, SenyuSkillCondition,
    // TeniSkillCondition, EquipNameCondition, EquipAbirityCondition,
    // EquipTagCondition, ElementalResistanceCondition) once their exact
    // match predicates are extracted.
}

/// TODO(Phase 4): implement once evaluate_loadout exists and the
/// PrunedByRestSlot / ExistsSuperior bound logic has been extracted and
/// validated for admissibility.
pub fn search(_data: &GameData, _targets: &SearchTargets) -> Vec<()> {
    unimplemented!(
        "search is blocked on the evaluator (Phase 3) and the extracted pruning \
         bound (Phase 0 / Phase 4) — see the project plan"
    )
}
