//! Ad-hoc integration test against the *real* community dat/ data, loaded
//! from a local JSON fixture (see `../fixtures/`, gitignored — regenerate
//! with `npx vitest run scripts/_dumpFixture.test.ts` from `app/`). Marked
//! `#[ignore]` so a normal `cargo test` (which may not have the fixture)
//! skips it; run explicitly with `cargo test -- --ignored` to sanity-check
//! the search engine against the full real dataset, not just the small
//! synthetic fixtures in `src/search.rs`'s unit tests.

use mhfz_core::schema::{GameData, Job};
use mhfz_core::search::{search, SearchInput, SearchTarget};
use std::fs;

#[test]
#[ignore]
fn finds_valid_sets_for_a_real_two_skill_target() {
    let json = fs::read_to_string("fixtures/real_game_data.json")
        .expect("run app/scripts/dumpFixture.manual.ts first (see its own header comment)");
    let data: GameData = serde_json::from_str(&json).expect("fixture should deserialize as GameData");

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
