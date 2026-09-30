# MHSX2 Search Engine — Reimplementation Rules Spec

This document is the single source-of-truth for every piece of MHSX2 (MHFZ Set Searcher)
game/search logic that is *not* recoverable from the XML data files alone — i.e. logic that
lives in code, not data. It is written from the real decompiled C# source in `decompiled/MHSX2/`
(ilspycmd output of the original .NET Framework WinForms app, namespace `MHSX2`) and is meant to
be the spec a from-scratch Rust/WASM reimplementation is built against. Every claim below is
backed by a short cited excerpt of the actual decompiled source (file + line range); excerpts are
intentionally short — enough to verify the claim, not a copy of the method. Where something named
in the original research prompt could not be located under that exact name, or could not be
confirmed at all, this is stated plainly rather than guessed.

All file paths below are relative to `decompiled/MHSX2/` unless otherwise noted. Line numbers refer
to the ilspycmd-decompiled files as they exist in this repository at the time of writing.

## 1. Ability-type effects (`ABILITY_TYPE_*`)

The seven ability-type constants are loaded at runtime from `conf/Define.xml` (cross-referenced
here from `/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths/conf/Define.xml`):

```xml
<ABILITY_TYPE_GCLASS_EFFECT>Ｇ級効果</ABILITY_TYPE_GCLASS_EFFECT>
<ABILITY_TYPE_SKILL_UP>スキルUP</ABILITY_TYPE_SKILL_UP>
<ABILITY_TYPE_ACTIVATE_SKILL>スキル発動</ABILITY_TYPE_ACTIVATE_SKILL>
<ABILITY_TYPE_ATTACHABLE_SPJEWELS>ＳＰ装飾品装着可能</ABILITY_TYPE_ATTACHABLE_SPJEWELS>
<ABILITY_TYPE_SKILL_LIMIT_UP>Skill Slots Up</ABILITY_TYPE_SKILL_LIMIT_UP>
<ABILITY_TYPE_SKILL_UPGRADE>スキル強化</ABILITY_TYPE_SKILL_UPGRADE>
<ABILITY_TYPE_NOCOUNT_SKILL>スキル枠消費なし</ABILITY_TYPE_NOCOUNT_SKILL>
<MAX_SKILL_LIMIT_UP>7</MAX_SKILL_LIMIT_UP>
```

Note that `ABILITY_TYPE_SKILL_LIMIT_UP`'s *value* is the literal English string `"Skill Slots Up"`,
not a Japanese label — this is a real constant compared by string equality (`Ability.Name ==
Context.Define.ABILITY_TYPE_SKILL_LIMIT_UP`), so any reimplementation must match on this exact
string.

Per-type effects, as consumed in code:

- **Ｇ級効果 (`ABILITY_TYPE_GCLASS_EFFECT`)** — `EquipmentDataTag.HasGRankEffect` is true iff the
  equipment's `Abilities` list contains this ability (`EquipmentDataTag.cs:99-113`). `SearchClass.
  CountGRankEffect` (`SearchClass.cs:2995-3006`) counts how many of the 6 equip slots have this
  flag, and `GetMaxActiveSkillCount` (`SearchClass.cs:3021-3035`) uses that count as a **step
  function**, not a linear one:
  ```csharp
  int num = 10;
  switch (CountGRankEffect(edata)) { case 3: case 4: num++; break; case 5: num += 2; break; }
  return num + CountSkillLimitUpEffect(edata, jdata);
  ```
  i.e. base active-skill cap is 10; having exactly 3 or 4 G-rank-effect pieces adds +1; having all
  5 (of the 5 armor slots — Head/Body/Arm/Waist/Leg) adds +2; 0–2 pieces add nothing. This is a
  non-obvious threshold table, not "N pieces = N bonus".

- **スキルUP (`ABILITY_TYPE_SKILL_UP`)** — `EquipmentDataTag.HasSkillUp` mirrors the same
  Contains-check pattern (`EquipmentDataTag.cs:83-97`). `SearchClass.HasRankChangeEffect`
  (`SearchClass.cs:2990-2993`) is true if *any* of the 6 equip tags `HasSkillUp`. When true, the
  search loop applies a precomputed rank-change point delta to every skill-point-condition entry
  before searching (`SearchClass.cs:538-544`, delta table built at `SearchClass.cs:273-282` via
  `SkillOption.TryRankUp`/`hasPrev()`). In effect: wearing *any* piece with this ability shifts
  every trackable skill's required point threshold by one tier (skill "rank changes" up, e.g. a
  Lv1 effect becomes the Lv2 effect threshold), applied set-wide, not per piece.

- **スキル発動 (`ABILITY_TYPE_ACTIVATE_SKILL`)** — used exclusively for "Senyu" (遷悠) armor. An
  ability of this type carries a `SkillOption` tag directly (not a point value to be summed).
  `EquipmentData.GetSenyuSkills()` (`EquipmentData.cs:250-255`) returns these as already-active
  skill options. `SenyuSkillCondition.Evaluate` (`SenyuSkillCondition.cs:53-56`) just checks
  `data.GetSenyuSkills().Contains(so)`. See item 4 for how these interact with the point-summation
  system (they are pre-satisfied and removed from search rather than summed).

- **ＳＰ装飾品装着可能 (`ABILITY_TYPE_ATTACHABLE_SPJEWELS`)** — this string constant is only ever
  passed to `AbilityManager.Create` at startup (`AbilityManager.cs:18-21`); no other decompiled
  file checks `Ability.Name == ABILITY_TYPE_ATTACHABLE_SPJEWELS` directly. The actual "is this an
  SP slot" behavior in the search/equip code is driven by a separate boolean field,
  `EquipmentData.isSP` / `JewelryData.Type == JewelryType.SP` (see `Equipment.cs:96-123,163-204`,
  `SearchClass.cs:604-615,1085-1128`), which is presumably set from this ability during data
  loading (`BaseData.cs`) but the ability-name check itself was not found reused elsewhere.
  **Confidence: partially verified** — the SP-slot mechanic itself (isSP flag) is fully verified;
  the direct code path from this specific ability string to setting `isSP` was not pinned down
  (see item list of unresolved items at the end).

- **Skill Slots Up (`ABILITY_TYPE_SKILL_LIMIT_UP`)** — see item 2. Also doubles as one of the two
  ability types that make up "Teni" skill entries (see item 4).

- **スキル強化 (`ABILITY_TYPE_SKILL_UPGRADE`)** — the other of the two ability types that make up
  "Teni" skill entries (see item 4). Notably, unlike `SKILL_LIMIT_UP`, abilities of this type do
  **not** contribute to `SkillLimitUpCount` — `EquipmentDataTag.SkillLimitUpAbilities` filters
  strictly on `ab.Name == Context.Define.ABILITY_TYPE_SKILL_LIMIT_UP` (`EquipmentDataTag.cs:143-
  157`), never on `SKILL_UPGRADE`. So the two ability types both appear as "Teni skill" options in
  the UI (`TeniSkillSelectionForm.cs:48-53` unions `Find(SKILL_LIMIT_UP)` and
  `Find(SKILL_UPGRADE)`), but only `SKILL_LIMIT_UP` entries raise the active-skill-count cap.

- **スキル枠消費なし (`ABILITY_TYPE_NOCOUNT_SKILL`)** — see item 2 ("no-count skills").

- **天刻印装着可能** — this string appears in the equipment XML data (e.g.
  `dat/EquipLeg.xml`, `dat/EquipHead.xml`) as an `Ability Type="天刻印装着可能"` value, but a
  repo-wide grep of `decompiled/` for the literal string `天刻印` returns **zero matches** — there
  is no `Define.xml` constant and no code anywhere that special-cases this ability by name. It is
  loaded into an equipment's generic `Abilities` list (same generic Ability-parsing path as any
  other unrecognized ability type) but has no known effect on search behavior; it may simply be
  informational/cosmetic in the original data, or its behavior was cut/never implemented in this
  build. **Confidence: verified as inert/unhandled** — confirmed absent from all code paths that
  key off ability-type strings; do not implement special logic for it beyond storing/displaying it.

**Confidence: verified from decompiled source**, except the SP-jewel-ability wiring noted above.

## 2. Skill point summation / activation math

Skill totals are tracked as running `SkillPoint[]` arrays indexed in parallel with a
`SortedList<SkillBase, SkillPointCondition>` ("SkillPointConditionTable"), one slot per skill the
user has a condition for. `SkillPointCondition.isIgnore` marks a condition as an **exclusion**
("this skill must not reach this level") rather than a requirement; `SubFunc.CompairSgin`
(`SubFunc.cs:8-11`, `return (a ^ b) >= 0;`) is the same-sign check used everywhere to decide whether
an actual point total moves in the required direction relative to the condition's signed
threshold.

Activation is **not** "total points ≥ threshold" — it is a **tiered lookup**:
```csharp
// SkillBase.cs:22-40 (GetOption)
int num2 = ((point >= 0) ? 1 : (-1));
foreach (SkillOption item in OptionTable) {
    if ((num2 < 0 || item.Point >= 0) && (num2 >= 0 || item.Point < 0)) {
        int num3 = num2 * (point - item.Point);
        if (num3 < num && num3 >= 0) { num = num3; result = item; }
    }
}
```
This finds the highest-tier `SkillOption` in the skill's `OptionTable` whose `Point` threshold is
reached without being exceeded past the next tier (nearest tier at or below the actual total, same
sign side). A skill is "active" iff `GetOption(totalPoints) != null`. `SkillInfo.IsSatisfied`
(`SkillInfo.cs:93-100`) additionally requires the option's absolute point value be ≥ the
condition's absolute threshold and that no `UpperPoint` cap is set on the condition.

Equipment, fixed jewels, senyu skills, and pig-clothes (skill cuff base) skill points are summed
into the running per-skill `SkillPoint.Point` in `SearchClass.Search()` (`SearchClass.cs:300-424`)
by iterating each ordered equip's `SkillPointList`, `GetFixedJewelys()`, and
`GetSenyuSkills()` — senyu skills are added with a `×10` multiplier as a sentinel/large weight
(`SearchClass.cs:379-384`, `array3[num12].Point -= senyuSkill.Point * 10;`) rather than the raw
per-level point value, because senyu skills are pre-verified as satisfied and simply need to
guarantee the running total clears the threshold (see item 4).

**`MAX_SKILL_LIMIT_UP` (=7) is a cap on the "Skill Slots Up"/"スキル強化" point contribution to
the active-skill-count cap — it is not a cap on total active skills, and not on skill-slot
consumption.** Exact code:
```csharp
// SearchClass.cs:3008-3013 (CountSkillLimitUpEffect)
int num = edata?.Sum((EquipmentDataTag ed) => ed.SkillLimitUpCount) ?? 0;
int num2 = jdata?.Cast<SkillCuffData>().Sum((SkillCuffData cd) => cd.SkillLimitUpCount) ?? 0;
return Math.Min(num + num2, MAX_SKILL_LIMIT);
```
This combined, capped value is *added* to the G-rank-effect-derived base (10/11/12, see item 1) in
`GetMaxActiveSkillCount` to produce the actual active-skill-count ceiling for the current
equipment+cuff combination.

**"No-count" skills** (`スキル枠消費なし` / `ABILITY_TYPE_NOCOUNT_SKILL`) are skills that are
exempt from counting against the active-skill-count cap, but they are **not simply subtracted from
a global total** — they are tracked as a *distinct-skill-name allowance*:
```csharp
// SearchClass.cs:3015-3019 (CountNoCountSkills)
return jdata?.Cast<SkillCuffData>().SelectMany((SkillCuffData cd) => cd.NoCountSkills).Distinct().Count() ?? 0;
```
and consumed via `GetSatisfiedCount`/the `num19 - satisfiedCount - num17 - num18 > maxActiveSkillCount`
pruning check (`SearchClass.cs:531-534,577-585`) and again inside the decoration-combination
scorer (`SearchClass.cs:975-1000`, `2364-2392`): when more than 10 candidate active skills exist,
the code sorts skills and walks the first `num30` (= max active count) entries *plus* however many
of those first N entries happen to be no-count skills (`num66`/`num34` computed by counting
`NoCountSkillBase.ContainsKey(key)` hits within the truncated window), effectively giving no-count
skills "free" slots in the window used to decide how many of the *required* conditions are
satisfied. This is a fairly intricate mechanism — the no-count exemption is applied per-search-node
based on which skill cuffs are currently selected (`AddNoCountSkill`, `SearchClass.cs:1430-1449`
clears and rebuilds `NoCountSkillBase` every time a skill-cuff combination changes), not a static
global exemption list.

`GetSatisfiedCount` (`SearchClass.cs:3037-3048`) — used for the "already satisfied by senyu skill"
pruning bound — counts how many *non-ignored* skill-point-conditions are already met purely by the
ordered/fixed equipment's senyu skills, independent of the search variables.

**Confidence: verified from decompiled source.**

## 3. Slot/jewel/skill-cuff combinatorics

Three parallel decoration mechanisms exist, unified through `SlotInfo` (`MHSX2.Engine/SlotInfo.cs`)
which tracks counts of free slots by size (index 1/2/3, plus a special index 0 for SP slots) and
supports `Divide(from, to...)` (e.g. split one 3-slot into a 1-slot + 2-slot) and `DivideAll`.

- **Skill cuffs** (`PotentialSkillCuffTagArrayArray[2][]`, indices 0=slot1, 1=slot2, plus "Hiden"
  category cuffs occupying index 0) are enumerated combinatorially up front via
  `CreateSkillCuffUseCountList` (`SearchClass.cs:1451-1560`), producing every valid
  count-assignment across cuff slots given the pig-clothes' available cuff-slot layout — this list
  is walked once per candidate equipment combination in the main search loop
  (`SearchClass.cs:571-1149`).

- **"Plus" jewels** (regular decorations with more than one copy available, grouped per skill by
  `PlusJewelryListTag`) are the ones searched combinatorially by `FindEligibleJewelryUseCount`
  (`SearchClass.cs:1984-2412`) and its mirror `FindEligibleJewelryUseCount_UpperCheck`
  (`SearchClass.cs:2497-2938`, used only when an upper-bound/exclusion cap is in play for some
  skill). Both are the same recursive branch-and-bound combine/remove state machine
  (`CombineState.init/append/remove`), walking one `PlusJewelryListTag` (one skill) at a time and
  trying decreasing counts of its best-fit jewel.

  - **Eligibility** of a specific jewel for placement at a given step requires: its slot size fits
    a remaining slot bucket (`SlotTypeNumArray[slot-1] != 0`), its point contribution has the
    correct sign relative to the remaining requirement (`SubFunc.CompairSgin`), and it is not
    dominated (`ExistsSuperior`, below).
  - **`ExistsSuperior(skillIndex, index, useCount)`** (`SearchClass.cs:2446-2457`) is a precomputed
    dominance/pruning table (`PlusJewelryIneffectivePrefix`, built once at setup time by
    `MHSX2Form.CreateIneffectivePrefix`, `MHSX2Form.cs:1890-…`): it returns true if a jewel that is
    strictly no-worse (same or better points-per-slot in this position) is already in use, meaning
    trying the dominated jewel here is redundant — confirms this is dominance-based combinatorial
    pruning, not correctness-affecting filtering.
  - **`PossibleUseCount(subj, CurrentRestPoint, sumEmpSlot, init, start)`** (`SearchClass.cs:2459-
    2488`) computes the maximum count of a candidate jewel usable *without* later making some
    other still-unsatisfied skill's requirement mathematically unreachable, by comparing
    slot-efficiency ratios across all remaining (not-yet-visited) `PlusJewelryListTag`s — this is
    a **look-ahead feasibility bound**, distinct from the `PrunedByRestSlot` admissible bound below.
  - **`PrunedByRestSlot(CurrentRestPoint, Slots, start, end)`** (`SearchClass.cs:2427-2444`) is the
    admissible branch-and-bound pruning function:
    ```csharp
    int num = Slots[0] + Slots[1] * 2 + Slots[2] * 3; // total slot "capacity" in points-of-slots
    for (i = start; i <= end; i++) {
        var pjlt = PlusJewelyDataTags[i];
        if (!SkillPointConditionTable.Values[pjlt.SkillIndex].isIgnore) {
            int rest = CurrentRestPoint[pjlt.SkillIndex];
            if (rest > 0 && pjlt.MaxEfficiency * num < rest) return true; // prune
        }
    }
    return false;
    ```
    i.e. for every still-required (non-ignored) skill with unmet positive remaining points, if
    **even using every remaining slot at that skill's single best points-per-slot ratio
    (`MaxEfficiency`, precomputed in `PlusJewelryListTag`'s constructor,
    `PlusJewelryListTag.cs:33-44`) could not cover the remaining requirement**, the whole branch is
    infeasible and is pruned. This is a true admissible (never-false-prune) bound because
    `MaxEfficiency` is the best ratio available for *that* skill across *all* candidate jewels, and
    `num` is the absolute best-case total slot capacity (as if every slot were the largest usable
    size) — so it never underestimates what's achievable, only ever confirms true infeasibility.
    A reimplementation must replicate exactly this bound (not a tighter or looser one) or it risks
    silently missing valid results.

- **"Single" plus-jewels** (`SinglePlusJewelryDataTags`, jewels that grant a fixed named skill and
  have only one copy/definition to consider) are filled first, directly inline in the reserved-slot
  walk of the main search loop (`SearchClass.cs:659-724`), not via the branch-and-bound function —
  each is either usable (compute exact count needed, `num36/plusJewelryDataTag2.SpecificPoint.Point`,
  rounded up) or zeroed out.

- **`SPJewelryDataTags`** (SP-slot-only decorations) are handled by a separate simple counter
  redistribution loop (`SearchClass.cs:1081-1128`) that shifts SP-jewel use-counts between tiers to
  try alternate combinations, independent of the normal 3-slot-size jewel system.

- **`CutUnUseJewelry`** (`SearchClass.cs:2940-2988`) is a post-hoc cleanup pass applied after a
  candidate jewel/decoration assignment is found: for each jewel type with a nonzero use count, it
  computes the maximum number of copies that could be removed while the running skill points still
  clear (or stay within, for capped/`UpperPoint` skills) every requirement, and removes that many —
  i.e. it strips wasted/superfluous decoration copies from a found solution so the reported result
  uses the minimum jewel count that still satisfies all conditions. It is applied repeatedly
  (`do { ... } while (flag7/flag4/flag5)`) until no further reduction is possible.

**Confidence: verified from decompiled source.** Method names in the original prompt
(`FindEligibleJewelryUseCount`, `CreateSkillCuffUseCountList`, `CalcCuffLimitUpCount`,
`CalcMaxCuffSkillUpperCount`, `PossibleUseCount`, `CutUnUseJewelry`, `ExistsSuperior`,
`PrunedByRestSlot`) all exist verbatim in `SearchClass.cs`.

## 4. Teni (辿異) / Senyu skill math

**Senyu (遷悠) skills are a fixed pre-search layer, not part of the point-summation system.** A
piece of equipment with an `ABILITY_TYPE_ACTIVATE_SKILL` ability directly grants an already-active
named `SkillOption` (`EquipmentData.GetSenyuSkills`, `EquipmentData.cs:250-255`). Before search
starts, `MHSX2Form.MakeSenyuSkills` (`MHSX2Form.cs:1533-1549`) scans only the **ordered/fixed**
equipment slots for senyu skills that satisfy an active skill-point condition, and those skill
conditions are then **removed from the search's `SkillPointConditionTable` entirely**
(`MHSX2Form.cs:1407-1416`, `searchCondition.SkillPointConditionTable.Remove(item)`), i.e. they are
treated as already-guaranteed and dropped from the combinatorial search rather than "stacked" with
normal equipment skill points at search time. During search itself, if a piece being tried
dynamically has a senyu skill matching a still-tracked condition, its contribution is added with a
`×10` sentinel weight (`SearchClass.cs:374-385`, `InitializeEnvironment` mirror at
`SearchClass.cs:1870-1881`) purely to force that skill's running total past its threshold — this is
a mechanism to guarantee "instantly satisfied", not a real point value meant to be summed alongside
normal equipment points at their true weight.

**Teni (辿異) skills are implemented as a subset of the ordinary ability/skill-point system, layered
on top of it — not a separate stacking mechanism with its own math.** A Teni-tree entry is just an
`Ability` of type `ABILITY_TYPE_SKILL_LIMIT_UP` ("Skill Slots Up") or `ABILITY_TYPE_SKILL_UPGRADE`
(スキル強化) whose `Tag` is a `SkillOption` (`EquipmentData.GetTeniSkills`, `EquipmentData.cs:272-
284`; identical pattern for skill cuffs in `SkillCuffData.GetTeniSkills`, `SkillCuffData.cs:125-
137`). `TeniSkillCondition.Evaluate` (`TeniSkillCondition.cs:93-126`) just checks whether the named
skill appears in `GetTeniSkills()`, for either equipment (`ConditionTarget.EquipAndCuff`, since Teni
skills can also come from skill cuffs — `TeniSkillCondition.cs:44`). Crucially:
- Only the `SKILL_LIMIT_UP`-tagged half of Teni entries feed into `SkillLimitUpCount`
  (`EquipmentDataTag.cs:143-169`, `SkillCuffData.cs:67-111`), which raises the active-skill-count
  cap (item 2). The `SKILL_UPGRADE`-tagged half does **not** raise the cap — this is a real,
  non-obvious functional split between two ability types that otherwise look identical in the UI's
  Teni-skill picker (`TeniSkillSelectionForm.cs:48-53`, which unions both ability-type searches
  into one combined checklist with no visible distinction).
- Teni skill points themselves are **not** added into the running `SkillPoint` totals used for
  ordinary skill activation at all in the reviewed code paths — `GetTeniSkills()` is only consulted
  by `TeniSkillCondition.Evaluate` (a set/subset-membership predicate, "does this piece have Teni
  skill X") and by `SkillLimitUpCount` (a slot-cap-raising side effect). No code path was found that
  sums Teni `SkillOption.Point` values into the regular skill-point-condition arrays (`array3`/
  `array5`/`array6`/`array7` in `SearchClass.Search`). **This strongly suggests Teni skill levels do
  not stack additively with normal equipment skill points** — a Teni entry is evaluated purely as a
  named-skill membership condition plus (conditionally) a cap-raising side effect, not as
  contributing its `Point` value to any skill's point total.

**Confidence: verified from decompiled source** for the mechanism and the cap-raising split;
**inferred with high confidence but not 100% proven** for "Teni points never stack additively" —
this is an absence-of-evidence conclusion (no summation call site was found across
`SearchClass.cs`, `MHSX2Form.cs`, `EquipmentData.cs`, `SkillCuffData.cs`); a targeted search of the
remaining ~180 unread files (in particular `EquipSetSkillView.cs`/`EquipSetView.cs`, which render
final skill totals to the UI) would be needed to fully rule out a UI-only summation path that has no
bearing on the search algorithm itself.

## 5. The search/backtracking algorithm itself

The real method is `SearchClass.Search()` (private, called from `Run()`), `SearchClass.cs:162-
1358` — by far the largest method in the codebase (~1200 lines). There is no separately named
"Run" search method beyond the thin `Run()` wrapper that just calls `Search()` inside
try/catch for thread-abort handling (`SearchClass.cs:136-160`).

**Outer loop structure:** the outer `while (true)` loop (`SearchClass.cs:505-1350`) is a manual
odometer over the **non-ordered** equip slots (`isOrderd[i] == false`), each slot's current index
held in `NowSearching[i]` and bounded by `SearchBeginPoint[i]`/`SearchEndPoint[i]` (which are the
per-thread partition boundaries — see item 7). Ordered/fixed slots are skipped (their equipment was
chosen by the user and is constant for the whole search). For each equipment combination visited:
1. `InitializeEnvironment` recomputes remaining skill points and running slot/def totals for the
   fixed part of the set (`SearchClass.cs:1850-1892`).
2. Cheap set-level pruning checks run first: total defense vs. `defence_lower`
   (`num22 = SelectedEquipDef < num6`), any `EquipOnly` `EquipSetCondition` failing
   (`flag5`), and — only when `option.CountRequiredSkillCount` is set and there are >10 tracked
   skills — an admissible bound comparing how many conditions could possibly still be satisfied
   against `maxActiveSkillCount` (`flag6`, `SearchClass.cs:526-534`).
3. If none of those prune the branch, the code walks every candidate **skill-cuff use-count
   combination** (`list`, from `CreateSkillCuffUseCountList`) for the current pig-clothes/cuff-slot
   layout, and for each, walks every combination of **reserved jewels** (jewels that must be worn
   because they're pinned to a "dummy"/ordered slot — `ReservedJewelryDataTags`) split across slot
   sizes via `SlotInfo.Divide`, and for each of *those*, calls `FindEligibleJewelryUseCount` to
   solve the remaining decoration assignment (item 3).
4. Any solution found is scored and compared against the *best found so far for this equipment
   combination* using a lexicographic ordering: **(a) number of satisfied non-ignored skill
   conditions** (`num65`/`num33`, highest is better) **(b) total slots used by jewels** (`num54`,
   lowest is better) **(c) SP-jewel slots used** (`num55`, lowest) **(d) skill-cuff slots used**
   (`num56`, lowest)** — see `SearchClass.cs:1005-1046`. This is the actual "is this better than
   the best-so-far for this exact equipment combo" comparator.
5. If a winning combination was found and its total defense falls in
   `[defence_lower, defence_upper]`, `MakeEquipSet` (`SearchClass.cs:1612-1717`) materializes an
   `EquipSet` (assigns jewels/cuffs back onto specific armor pieces) and it is appended (under
   lock) to `parent.AddEquipSetList` — this is "a valid result was found".

**Memoized tree-walk mode (`flag`/`EquipTagTreeNode`):** once the *first* result (or "UpperBlocked"
dead-end, an unmet-upper-cap condition) is found for the current prefix of equip slots, and only if
`parent.setting.OptimizeEquip == false`, the search switches from the plain odometer to a cached
tree walk (`EquipTagTreeNode`/`array11`/`array12`, `SearchClass.cs:1158-1230`). This tree's nodes
are chained by the dominance relation computed once at setup time
(`EquipmentDataTag.BackwardEquips`, populated by `MHSX2Form.OptimizeEquipList`,
`MHSX2Form.cs:2199-2333`, see item 6) — walking `Child` explores dominated/inferior equivalents of
an already-successful choice, walking `Next`/`Prev` moves along siblings at the same slot depth, and
`FindNextTreeNode(node, findInferior)` (`SearchClass.cs:1562-1586`) decides whether to descend into
dominated variants (`findInferior == true`, only when the parent was itself successful or blocked)
or skip them. When `OptimizeEquip == true` (the default), this whole tree-cache mechanism is never
entered and the search stays in the plain nested odometer the whole time — dominated equipment was
already permanently removed from the candidate arrays by `OptimizeEquipList` before search started,
so there is nothing left to walk.

**`MakeEquipSet`** (`SearchClass.cs:1612-1717`) turns the abstract "which jewel/cuff use-counts"
result into a concrete `EquipSet`: copies ordered equipment's own fixed jewels, then places reserved
jewels, then "plus" jewels (largest slot size first, `for (num = 3; num > 0; num--)`), then single
plus-jewels, then SP jewels (found by scanning for an SP-capable equipped piece with enough rest
slot), then skill cuffs onto the `PigClothes` object (largest cuff slot first) — throwing if a cuff
can't actually be attached (`"想定外のエラー スキルカフ"`, an internal-consistency assertion, not a
user-facing rule).

**`EquipSetKey`'s equality is *not* a full-result dedup key.** `EquipSetKey` (`EquipSetKey.cs`)
wraps a prefix of the `EquipmentDataTag[]` array (`Set`, length = `depth`) and its `Equals`
(`EquipSetKey.cs:53-67`) compares `Set[i] != other.Set[i]` — i.e. **reference identity** of the
`EquipmentDataTag` objects (no `==`/`Equals` override was found on `EquipmentDataTag` itself, so C#
falls back to `object.ReferenceEquals`), not value-equality of skill points or jewelry. It is used
purely as the memoization key for the `array11[depth]` dictionaries in the tree-cache mode above —
"have I already built a tree node for this exact prefix of (reference-identical) equipment tags" —
and has nothing to do with de-duplicating final search results shown to the user. No explicit
"is this EquipSet the same as an already-found one" dedup logic was found in `SearchClass.cs`;
result de-duplication (if any) would need to be traced through
`MHSX2Form.AddEquipSetList`/`equipSetListView_result.AddEquipSet` (not fully read in this pass —
flag as unresolved below if exact dedup semantics for the results list matter to the
reimplementation).

**Confidence: verified from decompiled source** for the algorithm structure, `MakeEquipSet`, and
`EquipSetKey` semantics. **Not fully resolved:** whether the results ListView (`equipSetListView_
result`) applies any dedup on top of raw `AddEquipSetList` entries — needs further investigation in
`EquipSetListView.cs` if exact-duplicate-suppression semantics matter for the Rust port.

## 6. Heuristic/optimization flags

- **`OptimizeEquip`** (`Settings.cs:20`, default `true`) — read directly as `parent.setting.
  OptimizeEquip` inside `SearchClass.Search()` (`SearchClass.cs:1158`), *not* passed through
  `SearchClassOption`. Independently, `MHSX2Form.OptimizeEquipList` (`MHSX2Form.cs:2199-2333`) is
  **always** called when building the per-slot candidate equipment arrays (not gated by this flag)
  and permanently removes any `EquipmentDataTag` that is strictly dominated by another candidate for
  the same slot (`EquipmentDataTag.IsSuperiorTo`, `EquipmentDataTag.cs:198-251`: same or higher
  slot size, same or higher stat values per the active `EquipCompareOption`, and every skill-point
  delta ≥ 0) *and* which agrees on every enabled `EquipSetCondition`'s truth value
  (`MHSX2Form.cs:2230-2242`) and on senyu-skill-satisfaction and `HasSkillLimitUp`
  (`MHSX2Form.cs:2243-2256`) — dominated entries are moved into the winner's `BackwardEquipsTmp`/
  `BackwardEquips` list rather than discarded outright. **What the boolean actually controls**, per
  `SearchClass.cs:1158`, is whether the live search *also* explores those dominated `BackwardEquips`
  variants via the `EquipTagTreeNode` tree-cache (see item 5): `OptimizeEquip == true` (default)
  means dominated equipment is never tried at all (fastest, fewest but Pareto-optimal results);
  `OptimizeEquip == false` means the search additionally walks dominated variants once a slot-prefix
  has already produced a hit, surfacing equipment choices that are strictly worse on paper but which
  the user might still want to see (e.g. a lower-defense piece with cosmetic/tag differences the
  dominance check couldn't account for). This is the reverse of what the name suggests at first
  glance — "optimize" here means "restrict to the optimized/pruned set", and disabling it means
  "search more exhaustively, including dominated equipment".

- **`OptimizeJewelry`** (`Settings.cs:22`, default `true`) — gates `MHSX2Form.OptimizeJewelryList`
  (`MHSX2Form.cs:1714-1717`, `1848-…`), a pre-search dominance-pruning pass over the "plus jewel"
  candidate lists per skill (mirrors `RemoveInferiorJewely`/`ComperJewelry` logic used elsewhere).
  When true, strictly-dominated decoration choices for a given skill are removed from the candidate
  arrays before search, shrinking the branch-and-bound search space in `FindEligibleJewelryUseCount`.
  `OptimizeJewelrySearchOrder` (`MHSX2Form.cs:1843-1846`, sorts `PlusJewelryListTag`s by candidate
  count ascending) always runs regardless of this flag.

- **`OptimizeJewelryCombination`** (`Settings.cs:24`, default `true`) — controls whether
  `CreateIneffectivePrefix` (`MHSX2Form.cs:1890-…`) computes the full pairwise-combination dominance
  table (`PlusJewelryIneffectivePrefix`, used by `ExistsSuperior`, item 3) or only a trivial
  identity/init-only table (`initOnly: true`), per `MHSX2Form.cs:1770-1789`:
  ```csharp
  bool flag2 = setting.OptimizeJewelryCombination;
  if (flag2) { foreach (var item4 in list3) if (item4.jd.Slot > 1) { flag2 = false; break; } }
  if (flag2) searchClassParameter.PlusJewelryIneffectivePrefix = CreateIneffectivePrefix(list8, sortedList);
  else searchClassParameter.PlusJewelryIneffectivePrefix = CreateIneffectivePrefix(list8, sortedList, initOnly: true);
  ```
  Note it is also force-disabled (`flag2 = false`) whenever any reserved jewel occupies more than a
  1-size slot, regardless of the setting — i.e. the full combination-dominance table is skipped
  automatically in that case even if the user enabled it.

- **`AcceptFirstFoundSkillCuffCombination`** (`SearchClassOption`, default `true`) — inside the
  per-equipment-combination loop, after a skill-cuff-combination iteration produces any winning
  jewel assignment, `if (flag4 && option.AcceptFirstFoundSkillCuffCombination) break;`
  (`SearchClass.cs:1145-1148`) stops trying further skill-cuff combinations for this equipment
  combo as soon as one succeeds, instead of evaluating all cuff combinations and keeping the best.
  When false, every cuff combination in `list` is tried and the lexicographic comparator
  (item 5, step 4) picks the best overall.

- **`AcceptFirstFoundDecorationCombination`** (`SearchClassOption`, default `true`) — inside
  `FindEligibleJewelryUseCount`, once a feasible decoration assignment is found:
  ```csharp
  if (option.AcceptFirstFoundDecorationCombination && (!option.EnsureActiveSkillCount || num33 == RowRequiredSkillCount)) {
      // clear working arrays and break out of the branch-and-bound search early
  }
  ```
  (`SearchClass.cs:2399-2406`) — stops searching for a better decoration assignment as soon as one
  is found, **unless** `EnsureActiveSkillCount` is also set and the found assignment doesn't yet
  satisfy every originally-requested skill count (`RowRequiredSkillCount`), in which case the search
  keeps looking for a strictly-better one even with this flag on.

- **`EnsureActiveSkillCount`** (`SearchClassOption`, default `true`) — as shown above, this flag
  only matters in combination with `AcceptFirstFoundDecorationCombination`: it forces the
  decoration search to keep looking (not stop at the first feasible answer) until the number of
  satisfied *originally requested* (`RowSkillPointConditionTable`) conditions reaches
  `RowRequiredSkillCount`, rather than accepting any feasible-but-partial decoration assignment.

- **`CountRequiredSkillCount`** (`SearchClassOption`, default `false`) — gates an extra admissible
  pruning bound, only activated when there are more than 10 tracked skill conditions (an explicit
  optimization for large skill-condition sets, since the "top 10" truncation logic elsewhere in the
  file — see item 2 — only kicks in above that count too):
  ```csharp
  bool flag3 = option.CountRequiredSkillCount && num19 > 10; // SearchClass.cs:501
  ...
  flag6 = num19 - satisfiedCount - num17 - num18 > maxActiveSkillCount; // SearchClass.cs:531-534
  ```
  i.e. it estimates the maximum number of conditions that could *possibly* still be satisfied
  (total non-ignored trackable conditions minus already-satisfied minus best-possible cuff bonuses)
  and prunes the branch outright if even that best case can't fit under the active-skill-count cap.

**Confidence: verified from decompiled source**, except that `SearchClassOption` (the class
actually passed into `SearchClass`) only carries `CountRequiredSkillCount`,
`AcceptFirstFoundSkillCuffCombination`, `AcceptFirstFoundDecorationCombination`, and
`EnsureActiveSkillCount` (`SearchClassOption.cs`) — `OptimizeEquip`, `OptimizeJewelry`, and
`OptimizeJewelryCombination` live only on `Settings` and are consumed either directly via
`parent.setting.*` inside `SearchClass` (`OptimizeEquip`) or entirely at parameter-build time in
`MHSX2Form` before any `SearchClass` exists (`OptimizeJewelry`, `OptimizeJewelryCombination`) —
this is a real architectural asymmetry worth preserving or deliberately flattening in the port.

## 7. ThreadNum / StopSearchCount

**`ThreadNum`** (`Settings.cs:16`, default `Math.Max(Environment.ProcessorCount - 2, 1)`,
`Settings.cs:180`) determines how many `SearchClass` instances are constructed
(`MHSX2Form.cs:1432-1446`), each a real OS thread (`SearchClass.Start()` → `new Thread(Run)`,
`SearchClass.cs:115-119`). Partitioning is **not** a full multi-dimensional split — only **one**
equip-slot dimension is split into contiguous ranges:
```csharp
// MHSX2Form.cs:1448-1481
for (equipKind2 = Weapon; equipKind2 < NumOfEquipKind; equipKind2++) {
    if (array[(int)equipKind2]) continue; // ordered/fixed slot, skip
    if (!flag && PotentialEquipTagArrayArray[equipKind2].Length >= setting.ThreadNum) {
        flag = true;
        // split this slot's candidate range into ThreadNum contiguous [begin,end) chunks
    } else {
        // every other slot: full [0, Length) range for every thread
    }
}
if (!flag) SearchClasses = new SearchClass[1] { SearchClasses[0] }; // fall back to 1 thread
```
i.e. the **first** non-ordered equip slot (in Weapon→Head→Body→Arm→Waist→Leg order) that has at
least `ThreadNum` candidates gets its candidate index range divided into `ThreadNum` contiguous,
near-equal chunks (remainder distributed to the first chunks), one chunk per thread
(`SearchBeginPoint[k]`/`SearchEndPoint[k]`); every other non-ordered slot is searched in full by
every thread. If no slot has enough candidates to split, the whole multi-thread setup collapses to
exactly one `SearchClass` instance. Threads that finish their assigned range early request
**work redistribution** from a still-searching thread (`RequestRedistribution`/`DoRedistribution`,
`SearchClass.cs:1749-1822,1894-1914`), which re-slices the *donor* thread's remaining range across
itself and any waiting idle threads, rather than only splitting once at the start — this is a
dynamic work-stealing scheme, not a fixed static partition.

**`StopSearchCount`** (`Settings.cs:18`, default `10000`) is a **post-hoc UI-thread cap on results
returned, not a mid-search hard stop inside `SearchClass`.** It is checked once per UI timer tick
(`timer1_Tick`, `MHSX2Form.cs:2695-2722`), *after* moving buffered results out of the
worker-threads' shared `AddEquipSetList` into the results ListView:
```csharp
equipSetListView_result.AddEquipSet(secondAddEquipSet, flag: true);
if (equipSetListView_result.filterableList.Original.Count >= setting.StopSearchCount) {
    StopSearching();
    DialogUtil.ShowInformationMessage("The search results exceeded " + setting.StopSearchCount + ...);
    return;
}
```
So worker threads may keep producing and buffering results between timer ticks past the nominal
cap; the cap is enforced approximately, at UI-timer granularity, by calling `StopSearching()` (which
presumably aborts/joins the search threads — not read in this pass) once the *displayed* result
count reaches the threshold, rather than being consulted from inside the hot search loop itself.

**Confidence: verified from decompiled source.**

## 8. EquipSetConditions predicate semantics

All condition classes derive from `EquipSetCondition` (`EquipSetCondition.cs`), which defines:
- `Lower`/`Upper` — inclusive count bounds ("this many of the 5/6 pieces must/may match").
- `Enabled` — a condition is completely dropped from the search's active condition list before
  search starts: `searchCondition.EquipSetConditions = setting.EquipSetConditions.Where(cond =>
  cond.Enabled).ToList();` (`MHSX2Form.cs:1097`). **`Enabled == false` conditions are never
  evaluated at all** — this exactly matches the prompt's expectation.
- `Excluded => Upper == 0` (`EquipSetCondition.cs:23`) — a *different* mechanism from `Enabled`.
  Conditions with `Upper == 0` (meaning "this must occur zero times", i.e. a "not contains" rule)
  are **not** evaluated per-candidate during the hot search loop; instead they are used to
  permanently strip matching equipment/jewelry/cuffs out of the candidate pool entirely at
  parameter-build time (`SearchCondition.cs:126,538` — `Where(cond => cond.Excluded).Any(cond =>
  cond.Evaluate(...))` → `continue`, i.e. skip adding to the candidate list). Conversely, non-
  excluded (`Upper > 0`, "must contain between Lower and Upper") conditions are evaluated live,
  combinatorially, during search (`SearchClass.cs:502-503,872`, `Where(cond => !cond.Excluded)`).
  So: **`Excluded` is a pre-filter optimization for pure exclusion rules, not a UI-facing toggle —
  it is derived purely from `Upper == 0`, and both excluded and non-excluded *enabled* conditions
  are active; only `Enabled == false` fully disables a condition.**

Per-subclass predicate semantics (all in `MHSX2/`):

- **`EquipTypeCondition`** — `Evaluate(EquipmentData d) => Types.Any(type => data.Type.Equals(
  type))` (`EquipTypeCondition.cs:66-69`) — **exact string equality** (`string.Equals`, not
  `Contains`), case-sensitive (default `Equals` overload), against one or more literal type
  strings. `Target = EquipOnly`.

- **`SenyuSkillCondition`** — `Evaluate(EquipmentData d) => data.GetSenyuSkills().Contains(so)`
  (`SenyuSkillCondition.cs:53-56`) where `so` is resolved once via `AbilityManager.Get(
  ABILITY_TYPE_ACTIVATE_SKILL, SenyuSkillName)` — an **exact object/name match** against a
  specific senyu `SkillOption`, not a substring or point-threshold comparison. `Target = EquipOnly`.

- **`TeniSkillCondition`** — `Evaluate` compares `so.Name` strings via `TeniSkillNames.Any(name =>
  teniSkillNames.Contains(name))` (`TeniSkillCondition.cs:93-98`) — **exact string membership**,
  not substring. Uniquely among these conditions, it defines `Evaluate(JewelryData_base)` for real
  (cuffs can carry Teni skills too) and has `Target = EquipAndCuff` (`TeniSkillCondition.cs:44,100-
  106`).

- **`EquipNameCondition`** — `Evaluate(EquipmentData d) => data.Name.Contains(EquipName)`
  (`EquipNameCondition.cs:37-40`) — **substring match** (`string.Contains`), the one condition type
  that is not exact-match. `Target = EquipOnly`.

- **`EquipAbirityCondition`** (sic — typo preserved from source, "Abirity") — `Evaluate(
  EquipmentData d) => data.Abilities.Any(ab => ab.Name.Equals(AbirityName))`
  (`EquipAbirityCondition.cs:36-39`) — **exact string equality** against the ability's `Name`
  (i.e. the ability *type*, e.g. matches any ability of a given type-string, not a specific
  leveled option). Also defines `Evaluate(JewelryData_base)` for skill cuffs
  (`EquipAbirityCondition.cs:41-44`) and `Target = EquipAndCuff`.

- **`EquipTagCondition`** — `Evaluate(EquipmentData d) => data.Tags.Any(t => t.Name.Equals(
  TagName))` (`EquipTagCondition.cs:38-41`) — **exact string equality** against user-defined
  equipment tags (`MHSX2.Tag.TagList`). `Target = EquipOnly`; throws on cuff evaluation (tags are
  armor-only).

- **`ElementalResistanceCondition`** — the odd one out: it does **not** implement per-piece
  `Evaluate(EquipmentData)` meaningfully (`return false;`, `ElementalResistanceCondition.cs:64-67`)
  — it is only meaningful at the **set level**: `Evaluate(EquipmentData[] data)` sums a specific
  element's resistance across all pieces and compares to `Lower` (no `Upper` bound is used — the
  constructor hardcodes `base(under, 100)`, `ElementalResistanceCondition.cs:58-62`), or, if
  `ElementType == All`, requires **every** one of the 5 elements to independently sum to at least
  `Lower` across the set (`ElementalResistanceCondition.cs:74-81`). `Target = EquipOnly`; throws on
  cuff evaluation.

**`Lower`/`Upper` application**: for the per-piece-count conditions (`EquipTypeCondition`,
`SenyuSkillCondition`, `TeniSkillCondition`, `EquipAbirityCondition`, `EquipTagCondition`,
`EquipNameCondition`), the array-level `Evaluate(EquipmentData[] data[, JewelryData_base[] jdata])`
overload counts how many individual pieces (and, for `EquipAndCuff`-target conditions, cuffs too)
satisfy the per-piece predicate, then returns `count >= Lower && count <= Upper` — a **closed
interval on the count of matching pieces across the whole set**, evaluated fresh for every
candidate equipment+cuff combination in the search loop. `Excluded` conditions (`Upper == 0`) thus
reduce to "zero matching pieces allowed", enforced instead by removing matching candidates from the
pool up front (see above) rather than by this count check (though the same math would still hold if
it were evaluated live).

**Confidence: verified from decompiled source.**

## 9. Defense/rarity/resistance totals

Per-`EquipSet` totals are simple sums with two notable special cases, both in `EquipSet.cs`:

```csharp
// EquipSet.cs:90-101 (UpdateTotalDef)
foreach (Equipment equipment in Equips) {
    if (equipment.isChecked && equipment.EquipData.Kind != 0) { TotalDef += equipment.Def; }
}
```
```csharp
// EquipSet.cs:103-140 (UpdateData)
if (equipment.EquipData.Kind != 0) { TotalElement += equipment.EquipData.Element; }
...
if (0 < equipment.Level && equipment.Level <= equipment.EquipData.LevelList.Count + 1) {
    int getableHR = equipment.EquipData.LevelList[equipment.Level - 1].GetableHR;
    if (TotalGettableHR < getableHR) { TotalGettableHR = getableHR; } // MAX, not sum
}
```

- **Defense** (`TotalDef`) and **elemental resistance** (`TotalElement`, via `Elemental`'s `+=`
  operator, not independently re-verified in this pass but used consistently as a per-element sum)
  are plain sums across the 6 `Equipment` slots, **excluding the weapon slot** — `EquipKind.Weapon
  == 0` (`EquipKind.cs`), and both totals explicitly gate on `equipment.EquipData.Kind != 0`. A
  weapon's own `Def`/`Element` values (if populated at all) never contribute to set totals.
- **Rarity** — no set-level "total rarity" field or computation was found in `EquipSet.cs`; rarity
  (`EquipmentData.Rare`) appears to be used only as a per-piece filter bound
  (`SearchCondition.rare_lower`/`rare_upper`, `SearchCondition.cs:110-113`), not summed or
  aggregated into the result set. Flag as **not found** if a "total rarity" figure is expected
  anywhere in the reimplementation's result display — it was not located.
- **"Gettable HR"** (`TotalGettableHR`, the hunter-rank/gear-rank requirement to obtain the full
  set) is a **maximum across pieces**, not a sum — the highest single piece's rank requirement gates
  the whole set, which matches real-world intuition (you need to be at least the rank of your
  hardest-to-get single item) but is worth calling out explicitly since every other total in this
  file is a sum.

**Confidence: verified from decompiled source** for Def/Element/GettableHR; **not found** for any
"total rarity" aggregate — searched `EquipSet.cs` fully, no such field/method exists.

---

## Items not fully resolved

1. **`ABILITY_TYPE_ATTACHABLE_SPJEWELS` wiring** (item 1) — the SP-slot mechanic (`isSP`) is fully
   verified in behavior, but the exact code path that sets `EquipmentData.isSP`/`JewelryData.Type
   == SP` from this specific ability string during XML loading was not located in the files read
   (likely in `BaseData.cs`, which is large and was only grepped, not fully read).
2. **Teni skill points "never stack additively"** (item 4) — verified by absence of any summation
   call site across all files read, but not exhaustively proven across the full 202-file codebase
   (in particular `EquipSetSkillView.cs`/`EquipSetView.cs`, the result-display views, were not read
   in full).
3. **Final-result de-duplication semantics** (item 5) — `EquipSetKey`'s reference-equality-based
   dedup is confirmed to be an internal search-tree memoization key only; whether
   `EquipSetListView`/`FilterableList` applies any separate dedup to the final displayed result set
   was not confirmed (`EquipSetListView.cs` was not read in this pass).
4. **`StopSearching()`'s exact effect on already-running worker threads** (item 7) — confirmed that
   `StopSearchCount` is a UI-timer-granularity post-hoc cap, but the implementation of
   `StopSearching()` itself (thread abort vs. cooperative stop) was not read.
