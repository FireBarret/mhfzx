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
  `CountGRankEffect` (`SearchClass.cs:2995-3006`) loops `for (i = 0; i < 6; i++)` over **all 6**
  `EquipmentDataTag` slots — **the weapon slot (index 0) is included in the count**, it is not
  restricted to the 5 armor slots. So the exact rule is: count G-rank-effect pieces across all 6
  equipped items (weapon + 5 armor); a count of 3 or 4 adds +1 to the base-10 cap; a count of
  exactly 5 adds +2; a count of 0, 1, 2, **or 6** (falls through to the switch's implicit default)
  adds +0. A weapon with this ability therefore both counts toward, and can push the count past,
  the bonus-granting range in either direction — a reimplementation that only scans the 5 armor
  slots will compute a different (and sometimes wrong) cap.

- **スキルUP (`ABILITY_TYPE_SKILL_UP`)** — `EquipmentDataTag.HasSkillUp` mirrors the same
  Contains-check pattern (`EquipmentDataTag.cs:83-97`). `SearchClass.HasRankChangeEffect`
  (`SearchClass.cs:2990-2993`) is true if *any* of the 6 equip tags `HasSkillUp`. When true, the
  search loop subtracts a precomputed per-skill delta array (`array4`) from the running requirement
  (`SearchClass.cs:538-544`). That delta is **not** computed for every tracked skill — it is built
  once per skill-point-condition entry (`SearchClass.cs:273-282`) and is only nonzero when **all**
  of the following hold for that specific skill:
  ```csharp
  if (skillPointCondition.SBase.CanRankChange) {              // SkillRank == 1 only
      SkillOption skillOption = skillPointCondition.SBase.GetOption(skillPointCondition.Point + num5);
      if (skillOption != null && skillOption.Point == skillPointCondition.Point + num5 && skillOption.hasPrev()) {
          array4[num3] = num4 * Math.Abs(skillOption.Point - skillOption.Prev.Point);
      }
  }
  ```
  i.e. the skill must be a rank-changeable skill (`SkillRank == 1`), the condition's threshold must
  land *exactly* on an existing tier boundary (`skillOption.Point == condition.Point [+/-1 for the
  ignore case]`), and that tier must have a previous tier (`hasPrev()`) to compute a step size from.
  Skills that don't meet all three get `array4[i] == 0` and are completely unaffected. So: wearing
  any スキルUP piece shifts *only the rank-changeable skills whose requested threshold sits exactly
  on a tier boundary* down by one tier's worth of points — not a blanket shift of every tracked
  skill.

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

**`MAX_SKILL_LIMIT_UP` (=7) caps the "Skill Slots Up" contribution to the active-skill-count cap —
it is not a cap on total active skills, not on skill-slot consumption, and (this matters) it is
applied to equipment and to skill cuffs **separately**, not to their combined total.** Exact code:
```csharp
// SearchClass.cs:3008-3013 (CountSkillLimitUpEffect)
int num = edata?.Sum((EquipmentDataTag ed) => ed.SkillLimitUpCount) ?? 0;
int num2 = jdata?.Cast<SkillCuffData>().Sum((SkillCuffData cd) => cd.SkillLimitUpCount) ?? 0;
return Math.Min(num + num2, MAX_SKILL_LIMIT);
```
`CountSkillLimitUpEffect` itself does cap `num + num2` together — but the two call sites in
`Search()` never pass both `edata` and `jdata` at once. `GetMaxActiveSkillCount` calls it as
`CountSkillLimitUpEffect(edata, jdata)` where `jdata` is passed as `null` from its only call site
(`SearchClass.cs:526`, `GetMaxActiveSkillCount(EquipDataTags, null)`), so this call caps **only the
equipment contribution** at 7. Separately, `CalcCuffLimitUpCount` (`SearchClass.cs:1370-1378`) calls
`CountSkillLimitUpEffect(null, skillCuffs[i])` **per skill-cuff combination**, capping **only that
combination's cuff contribution** at 7 independently. The two capped values are then added together
per candidate:
```csharp
// SearchClass.cs:496,499,575
int num17 = CalcMaxCuffSkillUpperCount(list);          // used only for an early admissible bound
int[] array17 = CalcCuffLimitUpCount(skillCuffs);      // per-cuff-combo capped cuff bonus
...
int maxActiveSkillCount = GetMaxActiveSkillCount(EquipDataTags, null); // 10 + Grank bonus + min(equip SLU, 7)
...
int num30 = maxActiveSkillCount + array17[num29];      // + min(this cuff combo's SLU, 7)
```
So the real effective active-skill-count ceiling for a given equipment+cuff-combo pair is
`10 + GRankBonus(0/1/2) + min(equipmentSkillLimitUp, 7) + min(cuffSkillLimitUp, 7)` — up to
`12 + 7 + 7 = 26` in the extreme, **not** a single combined value capped at 7. A reimplementation
that sums equipment+cuff `SkillLimitUpCount` first and caps once at 7 will under-count the true cap
whenever both equipment and cuffs contribute skill-limit-up abilities simultaneously.

**"No-count" skills** (`スキル枠消費なし` / `ABILITY_TYPE_NOCOUNT_SKILL`) are skills that are
exempt from counting against the active-skill-count cap, but they are **not simply subtracted from
a global total** — they are tracked as a *distinct-skill-name allowance*:
```csharp
// SearchClass.cs:3015-3019 (CountNoCountSkills)
return jdata?.Cast<SkillCuffData>().SelectMany((SkillCuffData cd) => cd.NoCountSkills).Distinct().Count() ?? 0;
```
and consumed via `GetSatisfiedCount`/the `num19 - satisfiedCount - num17 - num18 > maxActiveSkillCount`
pruning check (`SearchClass.cs:531-534,577-585`) and again inside the decoration-combination
scorer (`SearchClass.cs:975-1000`, and a near-duplicate at `2364-2392`): when more than 10 candidate
active skills exist, the code **sorts the candidate `SkillBase` list** (`list2.Sort()` /
`list.Sort()` on a plain `List<SkillBase>`, which resolves to `SkillBase.CompareTo`,
`SkillBase.cs:47-51` — **ascending by `SkillId`**, ties broken by nothing else) and walks the first
`num30` (= the dynamic `maxActiveSkillCount + cuffLimitUp` cap for this candidate, see above)
entries of that SkillId-ordered list *plus* however many of those first N entries happen to be
no-count skills (`num66` counting `NoCountSkillBase.ContainsKey(key)` hits within the truncated
window), effectively giving no-count skills "free" slots in the window used to decide how many of
the *required* conditions are satisfied. **Which skills survive the &gt;10 truncation is therefore
determined by `SkillId` order, not by relevance or by the order skills were requested** — a
reimplementation must replicate the same `SkillId` ordinal ordering or it can decide a different
subset of skills counts toward satisfaction whenever more than 10 candidate skills are active
simultaneously. This is a fairly intricate mechanism — the no-count exemption is applied
per-search-node based on which skill cuffs are currently selected (`AddNoCountSkill`,
`SearchClass.cs:1430-1449` clears and rebuilds `NoCountSkillBase` every time a skill-cuff
combination changes), not a static global exemption list.

**The twin function `FindEligibleJewelryUseCount_UpperCheck` (used when some skill has an
`UpperPoint` cap in play, see item 3) computes this same &gt;10-truncation scoring differently, not
identically**, at `SearchClass.cs:2906-2926`:
```csharp
if (list.Count > 10) {
    list.Sort();
    for (int num35 = 0; num35 < list.Count && num35 < 10; num35++) {   // hardcoded 10, no cuff bonus, no no-count extension
        SkillBase skillBase = list[num35];
        foreach (SkillPointCondition value in SkillPointConditionTable.Values) {  // live/reduced table, not RowSkillPointConditionTable
            if (!value.isIgnore && skillBase == value.SBase) { num34++; break; }
        }
    }
} else { num34 = OrderdSkillNum; }
```
Differences from the main version: the truncation window is a hardcoded `10` (not the dynamic
`num30` active-skill cap, and not extended for no-count skills at all), and the final match is
counted against `SkillPointConditionTable` (the live, already-reduced-by-pre-satisfied-skill-
removal condition table — see item 4/6) rather than `RowSkillPointConditionTable` (the original,
unreduced table). A reimplementation must keep these two scoring paths distinct rather than
factoring them into one shared helper with a parameter, or it will silently change which candidate
decoration assignment is judged "best" in the upper-bound-checking branch of the search.

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

  - **`Efficiency` is computed with truncating integer division, not true points-per-slot** — this
    is the single most important correctness detail in this section, because `Efficiency` is the
    basis for every bound below:
    ```csharp
    // PlusJewelryDataTag.cs:19-31 (constructor)
    Efficiency = pt.Point / jdt.jd.Slot;   // both operands int -> int division, THEN widened to double
    ```
    `Efficiency` is declared `double` (`PlusJewelryDataTag.cs:11`), but `pt.Point` and
    `jdt.jd.Slot` are both `int`, so the division happens in integer arithmetic and truncates
    toward zero *before* the result is implicitly converted to `double`. A 3-slot decoration worth
    +5 points gets `Efficiency = 1` (not `1.666...`), not `1` because of any deliberate flooring
    design — it is a plain C# integer-division artifact. This value feeds `PlusJewelryListTag.
    MaxEfficiency`/`MinEfficiency` (`PlusJewelryListTag.cs:33-44`), `PossibleUseCount`, the
    `nextJewelryCantSatisfy` greedy check, `SearchClass.cs:2074`'s efficiency comparison, and
    `PlusJewelryDataTag.CompareTo`'s sort order — i.e. essentially the entire jewel-placement
    heuristic layer is built on floor-divided ratios, not exact ones.

  - **`PrunedByRestSlot(CurrentRestPoint, Slots, start, end)`** (`SearchClass.cs:2427-2444`) is the
    branch-and-bound pruning function used as the primary feasibility gate:
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
    In exact real-number arithmetic this would be a true admissible (never-false-prune) bound: for
    every still-required skill with unmet positive remaining points, if even using every remaining
    slot at that skill's single best points-per-slot ratio couldn't cover the requirement, the
    branch is infeasible. **But because `MaxEfficiency` is itself built from the truncated
    `Efficiency` values above, it is a systematic *underestimate* of the true best ratio whenever a
    jewel's point value isn't an exact multiple of its slot size** — so this bound can be *stricter*
    than the true admissible bound and can prune branches that a correctly-rounded (or exact
    rational) computation would keep. **A reimplementation must decide, deliberately, whether to
    bit-for-bit replicate this integer-truncation behavior (to match the original tool's result set
    exactly, including its blind spots) or to use true/rational efficiency (which will find a
    superset of the original's results, some of which the original silently misses).** This is
    likely the single highest-impact behavioral quirk in the whole search engine for anyone porting
    it and expecting identical output.

  - **`PossibleUseCount(subj, CurrentRestPoint, sumEmpSlot, init, start)`** (`SearchClass.cs:2459-
    2488`) computes the maximum count of a candidate jewel usable *without* later making some
    other still-unsatisfied skill's requirement mathematically unreachable, by comparing the same
    (truncated) `MaxEfficiency` ratios across all remaining (not-yet-visited)
    `PlusJewelryListTag`s — a look-ahead feasibility bound, subject to the same truncation caveat.

  - **`ExistsSuperior(skillIndex, index, useCount)`** (`SearchClass.cs:2446-2457`) is a lookup
    against a precomputed **pairwise** dominance table, not a single-jewel dominance check:
    ```csharp
    int[] array = PlusJewelryIneffectivePrefix[skillIndex][index];
    foreach (int num in array) { if (useCount[num] > 0) return true; }
    return false;
    ```
    The table (`PlusJewelryIneffectivePrefix`, built once by `MHSX2Form.CreateIneffectivePrefix`,
    `MHSX2Form.cs:1890-1976`) is built per skill by enumerating every pair of candidate-jewel
    indices `(j, i)` with `j <= i` (including `j == i`, modeling "two copies of the same jewel"),
    constructing a `JewelryCombination` for each pair, and comparing pairs against each other with
    `JewelryCombination.IsSuperiorTo` (`JewelryCombination.cs:42-76`, a per-skill-point dominance
    check that also respects any `UpperPoint` cap). For index `i`, `PlusJewelryIneffectivePrefix
    [skillIndex][i]` ends up holding every earlier index `j` such that the pair `(j, i)` was found
    to be dominated by some *other* pair. `ExistsSuperior(skillIndex, i, useCount)` then returns
    true if any such `j` already has a nonzero use count in the current partial jewel assignment —
    i.e. "don't bother trying jewel `i` now, because pairing it with the jewel already chosen at
    index `j` is a combination we already know is dominated by a better pair." **This table is only
    built (non-trivially) when `OptimizeJewelryCombination` is enabled** — see item 6 — and is
    otherwise built with every cell empty (`CreateIneffectivePrefix(..., initOnly: true)`,
    `MHSX2Form.cs:1905-1959,1960-1972`: the `!initOnly` block that ever sets a table entry is
    skipped entirely, so every `PlusJewelryIneffectivePrefix[skillIndex][index]` array stays empty
    and **`ExistsSuperior` always returns `false`** in that mode — correctness-neutral, purely a
    performance dial).

  - **A separate, non-admissible, *average*-based heuristic prune gates the whole decoration search,
    and is easy to miss** (it was not named in the original research prompt):
    ```csharp
    // SearchClass.cs:775-778, inside the main search loop, before calling FindEligibleJewelryUseCount
    if (num20 <= (slotInfo2.Total + 1) * JewelrySkillPointAverage) {
        array18 = FindEligibleJewelryUseCount(array, array5, num26, ref UpperBlocked, array15, null, ref dictionary, num30, NoCountSkillBase);
    }
    ```
    where `num20` is the sum of all still-positive remaining skill-point requirements
    (`SearchClass.cs:766-770`, `num20 += array5[i].Point > 0 ? array5[i].Point : 0`), and
    `JewelrySkillPointAverage` is computed once at setup time as the **average total skill points
    per surviving candidate jewel, rounded, plus one**:
    ```csharp
    // MHSX2Form.cs:1790-1791
    IEnumerable<int> source = list2.Select(jdt => jdt.SkillPointTags.Sum(spt => spt.Point));
    searchClassParameter.JewelrySkillPointAverage = (int)Math.Round(source.Average()) + 1;
    ```
    (`list2` here is the full non-SP jewelry candidate list — built from `cond.MakeJewelryArray`,
    then dominance-pruned by `RemoveInferiorJewely`, then had SP-type jewels split out — not the
    reserved-jewelry list.) **If the sum of still-needed points exceeds `(free slot count + 1) ×
    average points-per-jewel`, `FindEligibleJewelryUseCount` is skipped for this reserved-jewel/
    cuff-combination branch entirely** (`array18` stays `null`, treated as infeasible) — even though
    an *above-average*-efficiency jewel combination might still satisfy the requirement. This is a
    genuinely non-admissible bound (unlike `PrunedByRestSlot`, which uses a *best-case* ratio): it
    can and does cause the original tool to silently skip achievable decoration assignments. A
    faithful port must replicate this exact average-based gate (including the `+1` and the
    `Total + 1` slot-count fudge) to match the original's result set; an "improved" max-based
    version will find results the original does not.

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
  Here `list3` is **not** the reserved-jewel list — it is the deduplicated, one-representative-
  per-equivalence-group list of *normal*-type candidate jewels built a few lines earlier via a
  `DataTagGroupTree` (`MHSX2Form.cs:1644-1648`, `list3 = dataTagGroupTree.Nodes.Select(n =>
  n.Member[0]).ToList()`), i.e. the same representative jewels used to build the per-skill
  `PlusJewelryDataTag` candidate lists in the first place. So the setting is force-disabled
  (`flag2 = false`) whenever **any** candidate normal-jewel representative has slot size > 1,
  regardless of the user's setting — the pairwise-combination dominance table in
  `CreateIneffectivePrefix` implicitly assumes 1-slot jewels (it reasons about pairs of *jewel
  picks*, not pairs of *slot units*), so it is silently skipped whenever any 2- or 3-slot candidate
  jewel exists for any tracked skill. Reserved jewels are unrelated to this check.

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
  satisfied *originally requested, non-ignored* conditions (`num33`, counted only against
  non-`isIgnore` entries — `SearchClass.cs:991-998`) reaches `RowRequiredSkillCount`. **This
  comparison target is subtler than it looks**: `RowRequiredSkillCount = rc.Count`
  (`SearchClass.cs:107`, a raw, *unfiltered* `.Count` — it does **not** exclude `isIgnore`
  entries), and `rc` is `SearchedCondition.SkillPointConditionTable`
  (`MHSX2Form.cs:1435`), which is cloned at `MHSX2Form.cs:1301` — **before** the later removal of
  skills already satisfied by senyu skills or by ordered equipment (`MHSX2Form.cs:1407-1416`,
  which mutates a *different* variable, `searchCondition.SkillPointConditionTable`) and before the
  "ignore skill" additions at `MHSX2Form.cs:1302-1378`. So `RowRequiredSkillCount` is simply the
  **total count of skill conditions as the user originally entered them, exclusions included, with
  none of the pre-satisfied ones stripped** — while `num33` only ever counts non-`isIgnore`
  matches. **Whenever the user has entered at least one exclusion (`isIgnore`) condition,
  `num33 == RowRequiredSkillCount` can never be true**, because `num33`'s ceiling is
  `RowRequiredSkillCount` minus however many entries are `isIgnore`. In that situation
  `EnsureActiveSkillCount`'s "exact match" branch is unreachable and the decoration search behaves
  as if `AcceptFirstFoundDecorationCombination` were simply off (it keeps searching for a better
  assignment, never taking the early-exit) — a materially different behavior from what the flag
  name and the "accept first vs. keep searching" framing suggest, and something a reimplementation
  should reproduce deliberately (e.g. by counting `RowRequiredSkillCount` the same unfiltered way)
  rather than "fixing" it to only count non-ignored entries.

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
  weapon's own `Def`/`Element` values (if populated at all) never contribute to *this*
  post-hoc `EquipSet` total.
- **The live search's own running defense bound is not consistent with the above — it includes the
  weapon.** `defence_lower`/`defence_upper` pruning inside `SearchClass.Search()` is computed by
  subtracting **all 6** ordered slots' `Def` (weapon included, loop starts at `num7 = 0` with no
  `Kind != 0` guard) from `condition.defence_lower` (`SearchClass.cs:284-292`), and
  `InitializeEnvironment`'s per-slot `SelectedEquipDef` accumulation likewise loops `j = 0..5`
  with no weapon exclusion (`SearchClass.cs:1858-1891`). So during search, a weapon's `Def` counts
  toward the defense-range filter, while the exact same figure would be excluded from
  `EquipSet.TotalDef`. In practice this is very likely moot: `dat/Weapon.xml` in the shipped data
  contains **no `Def` field at all** (confirmed by grep — zero matches for `Def` in that file), so
  `EquipmentData.Def` for every weapon resolves to the type's default (`0`). A reimplementation
  should still replicate both code paths exactly as split above rather than assuming they're
  equivalent, in case a future data file ever gives a weapon a nonzero `Def`.
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
3. **Final-result de-duplication semantics** (item 5) — mostly resolved structurally, not fully
   confirmed at the UI layer. `EquipSetKey`'s reference-equality dedup is confirmed to be an
   internal search-tree memoization key only. Structurally, true duplicates should be rare by
   construction: (a) for a given equipment combination, the lexicographic comparator
   (`SearchClass.cs:1005-1046`) keeps only the single best jewel/cuff assignment, so at most one
   `EquipSet` is emitted per equipment combination visited; (b) per-thread search ranges are
   disjoint (item 7), so no two threads visit the same equipment combination; (c) the
   `EquipTagTreeNode` tree-cache mode never touches the weapon slot (`SearchClass.cs:1161`, the
   loop starts at `num74 = 1`, i.e. Head..Leg only), so weapon variation is always driven by the
   plain odometer, not the dominated-variant tree walk. Whether `EquipSetListView`/`FilterableList`
   additionally applies any dedup on top of this (or whether it's needed) was not confirmed
   (`EquipSetListView.cs` was not read in this pass).
4. **`StopSearching()`'s exact effect on already-running worker threads** (item 7) — confirmed that
   `StopSearchCount` is a UI-timer-granularity post-hoc cap, but the implementation of
   `StopSearching()` itself (thread abort vs. cooperative stop) was not read.
