//! mhfz-core: loadout evaluator + armor-set search engine, compiled to
//! WebAssembly and consumed by both the Rust search loop (native, in-process)
//! and the TypeScript UI (via wasm-bindgen), so there is exactly one
//! implementation of the game logic — see the project plan, Phase 3/4.

pub mod evaluator;
pub mod schema;
pub mod search;
pub mod skill_base;

use schema::GameData;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Smoke-test export confirming the wasm-bindgen build pipeline works
/// end-to-end (Rust -> wasm32 -> JS glue). Not part of the app's real API.
#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// A JS-friendly wrapper over `search::SearchInput` — `job` is a plain
/// English string here (not the Japanese XML-data enum values `schema::Job`
/// serializes as) since this is a UI-facing request shape, not part of the
/// dat/*.xml round-trip contract those enums exist for.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub targets: Vec<search::SearchTarget>,
    /// One of `"Both"`, `"Blademaster"`, `"Gunner"`.
    pub job: String,
    pub max_results: usize,
}

fn parse_job(job: &str) -> Result<schema::Job, JsValue> {
    match job {
        "Both" => Ok(schema::Job::Both),
        "Blademaster" => Ok(schema::Job::Blademaster),
        "Gunner" => Ok(schema::Job::Gunner),
        other => Err(JsValue::from_str(&format!("unknown job \"{other}\", expected Both/Blademaster/Gunner"))),
    }
}

/// Runs the armor-set search (see `search::search`) against a `GameData`
/// object and a `SearchRequest`, both passed as plain JS objects shaped
/// exactly like `app/src/data/schema.ts`'s `GameData` and this module's
/// `SearchRequest`. Returns `search::FoundSet[]` as a plain JS array.
#[wasm_bindgen(js_name = search)]
pub fn search_wasm(game_data: JsValue, request: JsValue) -> Result<JsValue, JsValue> {
    let data: GameData = serde_wasm_bindgen::from_value(game_data)
        .map_err(|e| JsValue::from_str(&format!("invalid GameData: {e}")))?;
    let request: SearchRequest = serde_wasm_bindgen::from_value(request)
        .map_err(|e| JsValue::from_str(&format!("invalid SearchRequest: {e}")))?;
    let input = search::SearchInput {
        targets: request.targets,
        job: parse_job(&request.job)?,
        max_results: request.max_results,
    };
    let results = search::search(&data, &input);
    serde_wasm_bindgen::to_value(&results).map_err(|e| JsValue::from_str(&format!("failed to serialize results: {e}")))
}
