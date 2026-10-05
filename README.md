# MHFZ Set Searcher (web rewrite)

A modern, client-side rewrite of `MHSX2G.exe` ("MHFZ Set Searcher for GX and
Zeniths"), an abandonware Windows tool for Monster Hunter Frontier Z
armor/skill combinatorial searching. Reads the same community `dat/*.xml`
data files. No backend — runs entirely in the browser, with a Rust/
WebAssembly core for the search engine.

See `../.claude/plans/cd-users-dariush-downloads-mhfz-set-sear-glistening-wave.md`
(or ask Claude) for the full implementation plan and phase breakdown.

## Layout

- `rust-core/` — Rust crate (`mhfz-core`), compiled to WebAssembly via
  `wasm-pack`. Holds the domain schema, the loadout evaluator
  (`src/evaluator.rs`), and the armor-set search engine (`src/search.rs`) —
  the performance-critical hot path (~1–150ms per search against the full
  real dataset, run synchronously on the main thread; see `app/src/search.ts`
  for why a Web Worker isn't needed here).
- `app/` — Vite + TypeScript app shell: the XML data importers
  (`src/data/`), the search-tab and data-browser UI (`src/ui/`), and the
  Favorites/Skill Sets storage layer (`src/ui/skillGroups.ts`, backed by
  `localStorage`).
- `docs/rules-spec.md` — the game-logic rules extracted from the original
  app's decompiled source. This is the spec the Rust evaluator/search code
  is implemented against — nothing in `rust-core/src/evaluator.rs` or
  `search.rs` should be written without a citation back to this document.
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
                  # the WASM module needs a real HTTP origin to fetch from
npm run build    # production build to app/dist/
```

### Default data

The app always supports **File > Load Data Folder…** (select the original
app's root folder, the one containing `dat/` and `conf/` directly) to load
data for that session. `app/public/default-data/` bundles a copy of this
community data so the app auto-loads on startup with no manual step — it's
committed to the repo and ships with both local builds and the GitHub Pages
deploy. To refresh it with a newer `dat/`/`conf/` revision, overwrite the
files in place matching this layout:

```
app/public/default-data/
├── dat/EquipHead.xml, EquipBody.xml, EquipArm.xml, EquipWst.xml, EquipLeg.xml,
│   Weapon.xml, Jewel.xml, SkillCuff.xml, SkillBase.xml, TeniSkillBase.xml
└── conf/Define.xml
```

If this folder is ever absent (e.g. a fork that removes it), the app just
falls back to the manual folder picker with no error.

### Diagnostics

`app/scripts/diagnose.mjs` drives a real headless Chromium (via the
`playwright` dev dependency) through the app end-to-end — folder loading,
the skill tree, search, and the results grid — and reports console errors
plus screenshots to `/tmp/screenshot-*.png`. Useful for catching bugs that
only show up in a real browser (file-serving permissions, WASM init timing,
etc.) that `vitest`'s jsdom-based tests can't. Run with:

```sh
cd app && node scripts/diagnose.mjs            # folder loading, skill tree, search, results grid
cd app && node scripts/diagnose-newfeatures.mjs # equip presets, armor-type filter, item tags
```

## Status

Working end-to-end: folder loading (manual or auto via default-data), the
skill category tree (real categories from `dat/SkillBase.xml`, Favorites,
and saved Skill Sets), the Rust/WASM search engine, a results grid with
master-detail drill-down, and a data browser.

Also working: **preset equipment** (fix a specific piece — and up to 3 of
its own decorations — for any of the 6 equip slots; the search fills the
rest), an **armor-type filter** (Exotic/G Rank Armour/GS Armour/Origin/
Tower/Zenith/Zenith (ZP), built from whatever's actually loaded), and
**item tags** ("already have" tags on any armor/weapon/jewel/skill-cuff row
in the Data Browser, with a "only use items tagged…" filter on the Search
tab). All three are localStorage-backed like Favorites/Skill Sets.

`setting.xml`/`tag/*.xml`/`allows.xml`/`ignore.xml` round-trip import/export
exists in the data layer (`app/src/data/`) but isn't wired into any UI yet
(the item-tags feature above is a separate, simpler localStorage-backed
tagging system, not that round-trip layer). See the plan file for the full
phase breakdown and what's still deferred.
