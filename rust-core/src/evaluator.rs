//! Single-loadout evaluator — the oracle called by both the search engine's
//! inner loop and the UI's single-set inspector.
//!
//! BLOCKED on docs/rules-spec.md (Phase 0 of the project plan): the ability-
//! type effect rules, the MAX_SKILL_LIMIT_UP capping behavior, no-count-skill
//! exclusion, and Teni/Senyu stacking order all come from the decompiled
//! `MHSX2.SearchClass` source, not from the XML data, and must not be
//! guessed. Implement `evaluate_loadout` only once that document's relevant
//! sections are written and reviewed.

use crate::schema::{EquipData, JewelData, SkillCuffData, SkillName, WeaponData};
use std::collections::HashMap;

pub struct Loadout<'a> {
    pub weapon: &'a WeaponData,
    pub head: &'a EquipData,
    pub body: &'a EquipData,
    pub arm: &'a EquipData,
    pub waist: &'a EquipData,
    pub leg: &'a EquipData,
    pub decorations: Vec<&'a JewelData>,
    pub skill_cuffs: Vec<&'a SkillCuffData>,
    // TODO(Phase 0): clothes, Teni choices, Senyu choices — shape depends on
    // rules-spec findings for how those layers apply.
}

pub struct EvaluationResult {
    pub active_skills: HashMap<SkillName, i32>,
    pub total_defense: i32,
    pub resistances: crate::schema::Elemental,
    pub slot_usage: (u8, u8), // (used, available) — placeholder shape
}

/// TODO(Phase 0 -> Phase 3): implement once docs/rules-spec.md exists.
pub fn evaluate_loadout(_loadout: &Loadout) -> EvaluationResult {
    unimplemented!(
        "evaluate_loadout is blocked on docs/rules-spec.md — see Phase 0 of the project plan"
    )
}
