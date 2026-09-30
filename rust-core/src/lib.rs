//! mhfz-core: loadout evaluator + armor-set search engine, compiled to
//! WebAssembly and consumed by both the Rust search loop (native, in-process)
//! and the TypeScript UI/test harness (via wasm-bindgen), so there is exactly
//! one implementation of the game logic — see the project plan, Phase 3.
//!
//! `evaluator` and `search` are intentionally left as stubs: per Phase 0 of
//! the plan, no evaluator or search logic is written until docs/rules-spec.md
//! (the decompiled-source rules extraction) exists and has been reviewed.

pub mod schema;
pub mod evaluator;
pub mod search;

use wasm_bindgen::prelude::*;

/// Smoke-test export confirming the wasm-bindgen build pipeline works
/// end-to-end (Rust -> wasm32 -> JS glue). Not part of the app's real API.
#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
