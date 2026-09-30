# MHFZ Set Searcher (web rewrite)

A modern, client-side rewrite of `MHSX2G.exe` ("MHFZ Set Searcher for GX and
Zeniths"), an abandonware Windows tool for Monster Hunter Frontier Z
armor/skill combinatorial searching. Reads the same community `dat/*.xml`
data files; round-trips personal `setting.xml`/`tag/*.xml`/`allows.xml`/
`ignore.xml` so you can still switch back to the original app. No backend —
runs entirely in the browser, with a Rust/WebAssembly core for the search
engine.

See `../.claude/plans/cd-users-dariush-downloads-mhfz-set-sear-glistening-wave.md`
(or ask Claude) for the full implementation plan and phase breakdown.

## Layout

- `rust-core/` — Rust crate (`mhfz-core`), compiled to WebAssembly via
  `wasm-pack`. Holds the domain schema, the loadout evaluator, and the
  armor-set search engine. This is the performance-critical hot path.
- `app/` — Vite + TypeScript app shell. Data import/export, IndexedDB
  caching, and the UI live here; the search itself is delegated to
  `rust-core`'s compiled WASM (loaded in Web Workers once the search engine
  exists).
- `docs/rules-spec.md` — the game-logic rules extracted from the original
  app's decompiled source (see "Decompiling", below). This is the spec the
  Rust evaluator/search code is implemented against — nothing in
  `rust-core/src/evaluator.rs` or `search.rs` should be written without a
  citation back to this document.
- `decompiled/` — **not committed** (see `.gitignore`). Local-only decompiled
  C# source from the original `MHSX2G.exe`, kept for reference while writing
  `docs/rules-spec.md`. Regenerate with `ilspycmd` if needed; never commit it
  or redistribute it.

## Building

```sh
# 1. Build the Rust core to WebAssembly (run this first, and again after any
#    change under rust-core/src/):
cd rust-core
wasm-pack build --target web

# 2. Install/build the app (picks up rust-core/pkg via a local file dependency):
cd ../app
npm install
npm run dev      # dev server — do NOT open dist/index.html via file://,
                  # the Worker + WASM setup requires a real HTTP origin
npm run build    # production build to app/dist/
```

## Status

Early scaffolding only — see the plan's phase breakdown. The Rust
evaluator and search engine are intentionally unimplemented stubs
(`unimplemented!()`) until `docs/rules-spec.md` is written and reviewed.
