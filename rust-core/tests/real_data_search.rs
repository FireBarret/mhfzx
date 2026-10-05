//! Ad-hoc integration tests against the *real* community dat/ data, loaded
//! from a local JSON fixture (see `../fixtures/`, gitignored — regenerate
//! per `app/scripts/dumpFixture.manual.ts`'s own header comment). Marked
//! `#[ignore]` so a normal `cargo test` (which may not have the fixture)
//! skips them; run explicitly with `cargo test -- --ignored` to sanity-check
//! the search engine against the full real dataset, not just the small
//! synthetic fixtures in `src/search.rs`'s unit tests.

use mhfz_core::schema::{GameData, Job};
use mhfz_core::search::{search, PiecePreset, SearchInput, SearchPresets, SearchTarget};
use std::fs;

fn load_real_game_data() -> GameData {
    let json = fs::read_to_string("fixtures/real_game_data.json")
        .expect("run app/scripts/dumpFixture.manual.ts first (see its own header comment)");
    serde_json::from_str(&json).expect("fixture should deserialize as GameData")
}

#[test]
#[ignore]
fn finds_valid_sets_for_a_real_two_skill_target() {
    let data = load_real_game_data();

    eprintln!(
        "loaded: {} heads, {} bodies, {} jewels, {} skill_base entries",
        data.head.len(),
        data.body.len(),
        data.jewels.len(),
        data.skill_base.len()
    );

    let input = SearchInput {
        targets: vec![
            SearchTarget { skill_name: "Attack".into(), min_point: 10 },
            SearchTarget { skill_name: "Health".into(), min_point: 10 },
        ],
        job: Job::Both,
        max_results: 5,
        allowed_equip_types: vec![],
        presets: Default::default(),
    };

    let start = std::time::Instant::now();
    let results = search(&data, &input).expect("search should succeed with no presets");
    eprintln!("search took {:?}, found {} sets", start.elapsed(), results.len());

    assert!(!results.is_empty(), "expected at least one valid set for Attack+Health on real data");

    for r in &results {
        eprintln!(
            "  def={} head={} body={} arm={} waist={} leg={} decos={:?}",
            r.total_defense, r.head, r.body, r.arm, r.waist, r.leg, r.decorations
        );
        let attack = r.active_skills.iter().find(|s| s.skill_name == "Attack");
        let health = r.active_skills.iter().find(|s| s.skill_name == "Health");
        assert!(attack.is_some_and(|s| s.point >= 10), "Attack must be active at >=10");
        assert!(health.is_some_and(|s| s.point >= 10), "Health must be active at >=10");
    }
}

/// Regression test for a real user-reported bug: presetting "Fins ZP Head"
/// (a real head piece granting +5 Strong Attack, Skill Slots Up+1, and 3
/// decoration slots -- directly relevant, not a dead-weight piece) into a
/// search for Determination + Strong Attack+6 returned "no sets found" in
/// under 50ms. Root cause (see src/search.rs's
/// `remaining_decoration_capacity` doc comment and the synthetic unit test
/// `decoration_capacity_bound_counts_already_chosen_and_weapon_slots`): the
/// branch-and-bound pruning heuristic undercounted future decoration
/// capacity once pieces were already chosen, incorrectly treating a
/// reachable target as impossible. This test exercises the exact reported
/// scenario against the real dataset, not just the synthetic fixture.
#[test]
#[ignore]
fn fins_zp_head_preset_reaches_determination_and_strong_attack() {
    let data = load_real_game_data();

    let input = SearchInput {
        targets: vec![
            SearchTarget { skill_name: "Determination".into(), min_point: 10 },
            SearchTarget { skill_name: "Strong Attack".into(), min_point: 50 },
        ],
        job: Job::Both,
        max_results: 20,
        allowed_equip_types: vec![],
        presets: SearchPresets {
            head: Some(PiecePreset { name: "Fins ZP Head".into(), decorations: vec![] }),
            ..Default::default()
        },
    };

    let start = std::time::Instant::now();
    let results = search(&data, &input).expect("search should succeed with the Fins ZP Head preset");
    eprintln!("search took {:?}, found {} sets", start.elapsed(), results.len());

    assert!(!results.is_empty(), "expected at least one valid set with Fins ZP Head preset");
    for r in &results {
        assert_eq!(r.head, "Fins ZP Head");
    }
}

/// The user's exact original report: the "Adren Base" default Skill Set
/// (see app/src/ui/skillGroups.ts's DEFAULT_SKILL_SETS, seeded from the
/// original app's own setting.xml) at its real per-skill point thresholds,
/// with a Fins ZP Head preset -- 9 simultaneous targets, not the smaller
/// 2-target reproduction above. Also doubles as a perf check: the looser
/// (correct) bound visits more nodes than the old inadmissible one, so this
/// confirms that cost stays well within budget even at this scale.
#[test]
#[ignore]
fn fins_zp_head_preset_with_full_adren_base_skill_set() {
    let data = load_real_game_data();
    let targets = vec![
        SearchTarget { skill_name: "Determination".into(), min_point: 10 },
        SearchTarget { skill_name: "Strong Attack".into(), min_point: 50 },
        SearchTarget { skill_name: "Furious".into(), min_point: 10 },
        SearchTarget { skill_name: "Thunder Clad".into(), min_point: 10 },
        SearchTarget { skill_name: "Rush".into(), min_point: 10 },
        SearchTarget { skill_name: "Sword God".into(), min_point: 20 },
        SearchTarget { skill_name: "Ceaseless".into(), min_point: 10 },
        SearchTarget { skill_name: "Crit Conversion".into(), min_point: 10 },
        SearchTarget { skill_name: "Vampirism".into(), min_point: 20 },
    ];
    let input = SearchInput {
        targets,
        job: Job::Both,
        max_results: 20,
        allowed_equip_types: vec![],
        presets: SearchPresets {
            head: Some(PiecePreset { name: "Fins ZP Head".into(), decorations: vec![] }),
            ..Default::default()
        },
    };
    let start = std::time::Instant::now();
    let results = search(&data, &input).expect("search should succeed");
    let elapsed = start.elapsed();
    eprintln!("9-target Adren Base w/ Fins ZP Head preset: took {elapsed:?}, found {} sets", results.len());
    assert!(!results.is_empty(), "expected the full Adren Base set to be reachable with Fins ZP Head preset");
    assert!(elapsed.as_secs() < 5, "search took unexpectedly long: {elapsed:?}");
}
