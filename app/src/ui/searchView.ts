// The Search tab — restructured to mirror the original MHSX2G layout: a
// search-conditions bar, a skill-target table (No/Skill/Value/Activated
// Name, like the original's grid, not free-floating rows), a search control
// bar, a dense multi-column results grid, and a master-detail pane showing
// the selected result's full per-slot equipment breakdown + active skills —
// matching the original's results-list-on-the-left/detail-on-the-right
// interaction (click a result row to inspect it).

import type { EquipData, GameData, WeaponData, SkillBaseEntry } from '../data/schema'
import { appState } from './appState'
import { runSearch, type FoundSet, type JobFilter, type PiecePreset, type SearchPresets, type SearchTarget } from '../search'
import {
  deleteSkillSet,
  getFavorites,
  getSearchSessionState,
  getSkillSets,
  maybeSeedDefaultSkillSets,
  saveSearchSessionState,
  saveSkillSet,
  toggleFavorite,
  type SkillSet,
} from './skillGroups'
import { getAllTagNames, getItemNamesForTag, getTags } from './itemTags'
import { copyImageClipToClipboard, copyTextClipToClipboard, downloadImageClip } from './equipClip'

interface TargetRow {
  skillName: string
  minPoint: number
}

type PresetSlot = 'head' | 'body' | 'arm' | 'waist' | 'leg' | 'weapon'
const PRESET_SLOTS: { key: PresetSlot; label: string }[] = [
  { key: 'head', label: 'Head' },
  { key: 'body', label: 'Body' },
  { key: 'arm', label: 'Arm' },
  { key: 'waist', label: 'Waist' },
  { key: 'leg', label: 'Leg' },
  { key: 'weapon', label: 'Weapon' },
]

let targets: TargetRow[] = []
let lastResults: FoundSet[] = []
let selectedIndex: number | null = null
let expandedGroups = new Set<string>()
let skillSearchText = ''
let allowedEquipTypes = new Set<string>()
let presets: Partial<Record<PresetSlot, { name: string; decorations: string[] }>> = {}
let tagFilter = ''
/** Restricts the preset-slot piece/decoration pickers (the <datalist>
 * options behind each preset's text input) to items tagged with any of
 * these tags -- mirrors the original's EditEquipDialog tag-checklist
 * filter (decompiled source: a multi-check ListView of tags plus an
 * "include untagged" toggle). Empty set = unfiltered (show everything),
 * matching the original's default state. Session-only, not persisted --
 * a picker convenience, not search-affecting state. */
let presetTagFilter = new Set<string>()
// Defaults to false: checking a tag should narrow the picker down to just
// that tag's items (the whole point of "only show what I already have"),
// not quietly include the rest of the untagged dataset too. "+ untagged"
// is an opt-in widen, not the default.
let presetIncludeUntagged = false

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function skillOptionsHtml(skill: SkillBaseEntry, selected: number): string {
  const positive = skill.options.filter((o) => o.point > 0).sort((a, b) => a.point - b.point)
  return positive
    .map((o) => `<option value="${o.point}" ${o.point === selected ? 'selected' : ''}>${escapeHtml(o.name)}</option>`)
    .join('')
}

// --- Skill tree: Favorites + Skill Sets + real data-driven categories
// (dat/SkillBase.xml's `<SkillType TypeName>` groups — see schema.ts's
// SkillBaseEntry.category doc comment). Mirrors the original's
// SkillBaseTreeView: double-click a skill to add it to the target list,
// double-click a Skill Set to bulk-add its skills at their saved tiers,
// click the star to favorite/unfavorite. ---

function addTargetBySkillName(skillName: string, minPoint?: number) {
  if (targets.some((t) => t.skillName === skillName)) return
  const skillBase = appState.gameData?.skillBase ?? []
  const skill = skillBase.find((s) => s.name === skillName)
  const lowestPositive = skill?.options.filter((o) => o.point > 0).sort((a, b) => a.point - b.point)[0]
  targets.push({ skillName, minPoint: minPoint ?? lowestPositive?.point ?? 1 })
}

function matchesSearch(name: string): boolean {
  if (!skillSearchText) return true
  return name.toLowerCase().includes(skillSearchText.toLowerCase())
}

function renderGroupHeader(key: string, label: string, isOpen: boolean): string {
  return `<div class="skill-group-header" data-key="${escapeHtml(key)}">${isOpen ? '▾' : '▸'} ${escapeHtml(label)}</div>`
}

function renderSkillLeaf(name: string, isFavorite: boolean): string {
  return `<div class="skill-leaf" data-skill="${escapeHtml(name)}" title="Double-click to add">
    <button class="fav-toggle" data-skill="${escapeHtml(name)}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">${isFavorite ? '★' : '☆'}</button>
    <span>${escapeHtml(name)}</span>
  </div>`
}

function renderSkillSetLeaf(set: SkillSet): string {
  return `<div class="skill-leaf skillset-leaf" data-set="${escapeHtml(set.name)}" title="Double-click to add all ${set.entries.length} skills">
    <button class="skillset-delete" data-set="${escapeHtml(set.name)}" title="Delete this set">🗑</button>
    <span>${escapeHtml(set.name)} <small>(${set.entries.length})</small></span>
  </div>`
}

function renderSkillTree(root: HTMLElement) {
  const treeEl = root.querySelector<HTMLDivElement>('#skill-tree')!
  const skillBase = appState.gameData?.skillBase ?? []
  const favorites = getFavorites()
  const skillSets = getSkillSets()

  const categoryOrder: string[] = []
  const byCategory = new Map<string, SkillBaseEntry[]>()
  for (const s of skillBase) {
    if (!byCategory.has(s.category)) {
      byCategory.set(s.category, [])
      categoryOrder.push(s.category)
    }
    byCategory.get(s.category)!.push(s)
  }

  const sections: string[] = []

  const favItems = favorites.filter(matchesSearch)
  const favKey = '__favorites__'
  const favOpen = expandedGroups.has(favKey) || (skillSearchText !== '' && favItems.length > 0)
  sections.push(renderGroupHeader(favKey, `★ Favorites (${favorites.length})`, favOpen))
  if (favOpen) {
    sections.push(
      favItems.length > 0
        ? favItems.map((name) => renderSkillLeaf(name, true)).join('')
        : '<div class="skill-leaf-empty">No favorites yet — click ☆ next to any skill.</div>',
    )
  }

  const setItems = skillSets.filter((s) => matchesSearch(s.name))
  const setsKey = '__skillsets__'
  const setsOpen = expandedGroups.has(setsKey) || (skillSearchText !== '' && setItems.length > 0)
  sections.push(renderGroupHeader(setsKey, `📁 Skill Sets (${skillSets.length})`, setsOpen))
  if (setsOpen) {
    sections.push(
      setItems.length > 0
        ? setItems.map(renderSkillSetLeaf).join('')
        : '<div class="skill-leaf-empty">No saved sets yet — build a target list below, then "Save as Skill Set".</div>',
    )
  }

  for (const category of categoryOrder) {
    const all = byCategory.get(category)!
    const matching = all.filter((s) => matchesSearch(s.name))
    if (skillSearchText !== '' && matching.length === 0) continue
    const key = `cat:${category}`
    const isOpen = expandedGroups.has(key) || (skillSearchText !== '' && matching.length > 0)
    sections.push(renderGroupHeader(key, `${category} (${all.length})`, isOpen))
    if (isOpen) {
      sections.push(matching.map((s) => renderSkillLeaf(s.name, favorites.includes(s.name))).join(''))
    }
  }

  treeEl.innerHTML = sections.join('')

  treeEl.querySelectorAll<HTMLDivElement>('.skill-group-header').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.key!
      if (expandedGroups.has(key)) expandedGroups.delete(key)
      else expandedGroups.add(key)
      renderSkillTree(root)
    })
  })
  treeEl.querySelectorAll<HTMLDivElement>('.skill-leaf:not(.skillset-leaf)').forEach((el) => {
    el.addEventListener('dblclick', () => {
      addTargetBySkillName(el.dataset.skill!)
      renderTargetTable(root)
    })
  })
  treeEl.querySelectorAll<HTMLButtonElement>('.fav-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleFavorite(btn.dataset.skill!)
      renderSkillTree(root)
    })
  })
  treeEl.querySelectorAll<HTMLDivElement>('.skillset-leaf').forEach((el) => {
    el.addEventListener('dblclick', () => {
      const set = skillSets.find((s) => s.name === el.dataset.set)
      if (!set) return
      for (const entry of set.entries) addTargetBySkillName(entry.skillName, entry.point)
      renderTargetTable(root)
    })
  })
  treeEl.querySelectorAll<HTMLButtonElement>('.skillset-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      deleteSkillSet(btn.dataset.set!)
      renderSkillTree(root)
    })
  })
}

// --- Target skill table (mirrors the original's No/Skill/Value/Activated Name grid) ---

function renderTargetTable(root: HTMLElement) {
  const body = root.querySelector<HTMLTableSectionElement>('#target-table-body')!
  const skillBase = appState.gameData?.skillBase ?? []
  const byName = new Map(skillBase.map((s) => [s.name, s]))

  body.innerHTML = targets
    .map((t, i) => {
      const skill = byName.get(t.skillName)
      const optionsHtml = skill ? skillOptionsHtml(skill, t.minPoint) : ''
      const activated = skill?.options.find((o) => o.point === t.minPoint)?.name ?? ''
      return `<tr data-index="${i}">
        <td>${i + 1}</td>
        <td>${escapeHtml(t.skillName)}</td>
        <td><select class="tier-select" data-index="${i}">${optionsHtml}</select></td>
        <td class="activated-name">${escapeHtml(activated)}</td>
        <td><button class="remove-target" data-index="${i}" title="Remove">×</button></td>
      </tr>`
    })
    .join('')

  body.querySelectorAll<HTMLSelectElement>('.tier-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const i = Number(sel.dataset.index)
      targets[i].minPoint = Number(sel.value)
      renderTargetTable(root)
    })
  })
  body.querySelectorAll<HTMLButtonElement>('.remove-target').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index)
      targets.splice(i, 1)
      renderTargetTable(root)
    })
  })

  persistSearchSession(root)
}

/** Saves the current (in-progress, not-necessarily-named) target list, job
 * filter, max-results, equip-type filter, presets, and tag filter to
 * localStorage so it survives closing and reopening the browser. Called
 * from the one place every target-list mutation already funnels through
 * (renderTargetTable), plus directly from every other input's own change
 * handler. */
function persistSearchSession(root: HTMLElement) {
  const jobSelect = root.querySelector<HTMLSelectElement>('#job-filter')
  const maxResultsInput = root.querySelector<HTMLInputElement>('#max-results')
  if (!jobSelect || !maxResultsInput) return // not yet rendered
  saveSearchSessionState({
    targets: targets.map((t) => ({ skillName: t.skillName, minPoint: t.minPoint })),
    job: jobSelect.value,
    maxResults: Number(maxResultsInput.value) || 20,
    equipTypes: Array.from(allowedEquipTypes),
    presets: { ...presets },
    tagFilter,
  })
}

// --- Equip-type filter, presets, and the "already have" tag filter ---

/** The distinct `equipType` values actually present in the loaded armor
 * data (head/body/arm/waist/leg only -- weapons have no Type field in the
 * original data), built from whatever's loaded rather than a hardcoded
 * list so a future package.xml revision's types show up automatically. */
function equipTypesInData(gameData: GameData | null): string[] {
  if (!gameData) return []
  const types = new Set<string>()
  for (const piece of [...gameData.head, ...gameData.body, ...gameData.arm, ...gameData.waist, ...gameData.leg]) {
    types.add(piece.equipType)
  }
  return Array.from(types).sort((a, b) => a.localeCompare(b))
}

function armorPoolFor(gameData: GameData, slot: PresetSlot): EquipData[] | WeaponData[] {
  switch (slot) {
    case 'head': return gameData.head
    case 'body': return gameData.body
    case 'arm': return gameData.arm
    case 'waist': return gameData.waist
    case 'leg': return gameData.leg
    case 'weapon': return gameData.weapons
  }
}

function renderEquipTypeFilter(root: HTMLElement) {
  const el = root.querySelector<HTMLDivElement>('#equip-type-filter')!
  const types = equipTypesInData(appState.gameData)
  if (types.length === 0) {
    el.innerHTML = '<span class="skill-tier-note">Load a data folder to filter by equip type.</span>'
    return
  }
  el.innerHTML = types
    .map(
      (t) =>
        `<label class="equip-type-option"><input type="checkbox" class="equip-type-checkbox" value="${escapeHtml(t)}" ${allowedEquipTypes.has(t) ? 'checked' : ''}> ${escapeHtml(t)}</label>`,
    )
    .join('')
  el.querySelectorAll<HTMLInputElement>('.equip-type-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) allowedEquipTypes.add(cb.value)
      else allowedEquipTypes.delete(cb.value)
      persistSearchSession(root)
    })
  })
}

/** Exported so main.ts can refresh the tag dropdown's option list when
 * switching back to the Search tab -- tags are added/removed from the Data
 * Browser tab, which doesn't otherwise notify this view. */
export function renderTagFilter(root: HTMLElement) {
  const select = root.querySelector<HTMLSelectElement>('#tag-filter')!
  const tagNames = getAllTagNames()
  select.innerHTML =
    '<option value="">All items</option>' + tagNames.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')
  select.value = tagFilter
}

function presetDatalistId(slot: PresetSlot): string {
  return `preset-piece-list-${slot}`
}

/** Names allowed through the preset pickers given the current tag filter,
 * or `null` when unfiltered (no tags checked) -- mirrors
 * EditEquipDialog's `(hasNullTag && item.Tags.Count==0) || item.Tags.Any(checkedTags.Contains)`
 * filter predicate from the decompiled source. */
function presetAllowedNames(allNames: string[]): Set<string> | null {
  if (presetTagFilter.size === 0) return null
  const allowed = new Set<string>()
  for (const tag of presetTagFilter) {
    for (const name of getItemNamesForTag(tag) ?? []) allowed.add(name)
  }
  if (presetIncludeUntagged) {
    const taggedAnywhere = new Set(getTags().flatMap((t) => t.itemKeys))
    for (const name of allNames) if (!taggedAnywhere.has(name)) allowed.add(name)
  }
  return allowed
}

/** Rebuilds just the preset pickers' <datalist> option sets (not the whole
 * table), so toggling the tag filter doesn't clobber whatever's already
 * typed into each preset's piece/decoration inputs. */
function rebuildPresetDatalists(root: HTMLElement) {
  const datalists = root.querySelector<HTMLDivElement>('#presets-datalists')!
  const gameData = appState.gameData
  if (!gameData) {
    datalists.innerHTML = ''
    return
  }
  const pieceDatalists = PRESET_SLOTS.map(({ key }) => {
    const pool = armorPoolFor(gameData, key) as { name: string }[]
    const allowed = presetAllowedNames(pool.map((p) => p.name))
    const filtered = allowed ? pool.filter((p) => allowed.has(p.name)) : pool
    return `<datalist id="${presetDatalistId(key)}">${filtered.map((p) => `<option value="${escapeHtml(p.name)}">`).join('')}</datalist>`
  }).join('')
  const jewelAllowed = presetAllowedNames(gameData.jewels.map((j) => j.name))
  const filteredJewels = jewelAllowed ? gameData.jewels.filter((j) => jewelAllowed.has(j.name)) : gameData.jewels
  const jewelDatalist = `<datalist id="preset-jewel-list">${filteredJewels.map((j) => `<option value="${escapeHtml(j.name)}">`).join('')}</datalist>`
  datalists.innerHTML = pieceDatalists + jewelDatalist
}

/** Exported for the same reason as `renderTagFilter`: tags change on the
 * Data Browser tab, so main.ts refreshes this when switching back. */
export function renderPresetTagFilter(root: HTMLElement) {
  const el = root.querySelector<HTMLDivElement>('#presets-tag-filter')!
  const tagNames = getAllTagNames()
  if (tagNames.length === 0) {
    el.innerHTML = '<span class="skill-tier-note">Tag items in the Data Browser to filter these pickers to what you already have.</span>'
    rebuildPresetDatalists(root)
    return
  }
  el.innerHTML = [
    '<span>Only show tagged:</span>',
    ...tagNames.map(
      (t) =>
        `<label class="equip-type-option"><input type="checkbox" class="preset-tag-checkbox" value="${escapeHtml(t)}" ${presetTagFilter.has(t) ? 'checked' : ''}> ${escapeHtml(t)}</label>`,
    ),
    `<label class="equip-type-option"><input type="checkbox" id="preset-include-untagged" ${presetIncludeUntagged ? 'checked' : ''}> + untagged</label>`,
  ].join('')
  el.querySelectorAll<HTMLInputElement>('.preset-tag-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) presetTagFilter.add(cb.value)
      else presetTagFilter.delete(cb.value)
      rebuildPresetDatalists(root)
    })
  })
  rebuildPresetDatalists(root)
  el.querySelector<HTMLInputElement>('#preset-include-untagged')!.addEventListener('change', (e) => {
    presetIncludeUntagged = (e.target as HTMLInputElement).checked
    rebuildPresetDatalists(root)
  })
}

function renderPresetsPanel(root: HTMLElement) {
  const body = root.querySelector<HTMLTableSectionElement>('#presets-body')!

  body.innerHTML = PRESET_SLOTS.map(({ key, label }) => {
    const preset = presets[key]
    return `<tr>
      <td>${label}</td>
      <td><input type="text" class="preset-piece-input" data-slot="${key}" list="${presetDatalistId(key)}" value="${escapeHtml(preset?.name ?? '')}" placeholder="(search picks)"></td>
      <td><input type="text" class="preset-deco-input" data-slot="${key}" list="preset-jewel-list" value="${escapeHtml((preset?.decorations ?? []).join(', '))}" placeholder="decoration, decoration…"></td>
      <td><button type="button" class="preset-clear-btn" data-slot="${key}" title="Clear this preset">✕</button></td>
    </tr>`
  }).join('')

  renderPresetTagFilter(root)
  rebuildPresetDatalists(root)

  body.querySelectorAll<HTMLInputElement>('.preset-piece-input').forEach((input) => {
    input.addEventListener('change', () => {
      const slot = input.dataset.slot as PresetSlot
      const name = input.value.trim()
      if (!name) {
        delete presets[slot]
      } else {
        presets[slot] = { name, decorations: presets[slot]?.decorations ?? [] }
      }
      persistSearchSession(root)
    })
  })
  body.querySelectorAll<HTMLInputElement>('.preset-deco-input').forEach((input) => {
    input.addEventListener('change', () => {
      const slot = input.dataset.slot as PresetSlot
      const decorations = input.value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      if (presets[slot]) presets[slot]!.decorations = decorations
      else if (decorations.length > 0) presets[slot] = { name: '', decorations }
      persistSearchSession(root)
    })
  })
  body.querySelectorAll<HTMLButtonElement>('.preset-clear-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      delete presets[btn.dataset.slot as PresetSlot]
      renderPresetsPanel(root)
      persistSearchSession(root)
    })
  })
}

function buildSearchPresets(): SearchPresets | undefined {
  const entries = Object.entries(presets).filter(([, v]) => v && v.name.trim().length > 0) as [PresetSlot, PiecePreset][]
  if (entries.length === 0) return undefined
  const result: SearchPresets = {}
  for (const [slot, preset] of entries) result[slot] = preset
  return result
}

/** Restricts the armor/weapon/jewel pools the search chooses from to items
 * tagged `tagName` (via itemTags.ts's localStorage-backed "already have"
 * tags) -- returns `gameData` unchanged when no tag is selected. Skill
 * cuffs, skill_base, teni_skill_base, and ability_types are left alone
 * (not part of the search's candidate pools). Note this is independent of
 * preset slots: a preset piece outside the tagged subset still resolves
 * fine on the Rust side since presets are looked up by exact name, not
 * filtered by this function. */
function applyTagFilter(gameData: GameData, tagName: string): GameData {
  const allowed = getItemNamesForTag(tagName)
  if (allowed === null) return gameData
  const allowedSet = new Set(allowed)
  return {
    ...gameData,
    head: gameData.head.filter((p) => allowedSet.has(p.name)),
    body: gameData.body.filter((p) => allowedSet.has(p.name)),
    arm: gameData.arm.filter((p) => allowedSet.has(p.name)),
    waist: gameData.waist.filter((p) => allowedSet.has(p.name)),
    leg: gameData.leg.filter((p) => allowedSet.has(p.name)),
    weapons: gameData.weapons.filter((w) => allowedSet.has(w.name)),
    jewels: gameData.jewels.filter((j) => allowedSet.has(j.name)),
  }
}

// --- Results grid + master-detail selection ---

function skillCellsHtml(skills: FoundSet['activeSkills']): string {
  const cells: string[] = []
  for (let i = 0; i < 5; i++) {
    const s = skills[i]
    cells.push(`<td>${s ? escapeHtml(s.optionName) : ''}</td>`)
  }
  return cells.join('')
}

function renderResultsTable(root: HTMLElement) {
  const body = root.querySelector<HTMLTableSectionElement>('#results-body')!
  body.innerHTML = lastResults
    .map(
      (r, i) => `<tr data-index="${i}" class="${i === selectedIndex ? 'selected' : ''}">
        <td>${i}</td>
        <td>${r.totalDefense}</td>
        <td>${r.activeSkills.length}</td>
        <td>${escapeHtml(r.weapon ?? '—')}</td>
        <td>${escapeHtml(r.head)}</td>
        <td>${escapeHtml(r.body)}</td>
        <td>${escapeHtml(r.arm)}</td>
        <td>${escapeHtml(r.waist)}</td>
        <td>${escapeHtml(r.leg)}</td>
        <td>${escapeHtml(r.decorations.join(', ') || '—')}</td>
        ${skillCellsHtml(r.activeSkills)}
      </tr>`,
    )
    .join('')

  body.querySelectorAll<HTMLTableRowElement>('tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      selectedIndex = Number(tr.dataset.index)
      renderResultsTable(root)
      renderDetailPanes(root)
    })
  })
}

function findEquip(category: EquipData[], name: string): EquipData | undefined {
  return category.find((d) => d.name === name)
}

function equipDetailRow(part: string, data: EquipData | undefined): string {
  if (!data) return `<tr><td>${part}</td><td colspan="8">—</td></tr>`
  const best = data.levels[data.levels.length - 1]
  const skillCells = Array.from({ length: 5 }, (_, i) => {
    const s = data.skills[i]
    return `<td>${s ? escapeHtml(`${s.skillName} ${s.point > 0 ? '+' : ''}${s.point}`) : ''}</td>`
  }).join('')
  return `<tr>
    <td>${part}</td>
    <td>${escapeHtml(data.name)}</td>
    <td>${escapeHtml(data.class)}</td>
    <td>${best?.def ?? '—'}</td>
    ${skillCells}
    <td>${best?.slot ?? 0}</td>
    <td>${data.rare}</td>
  </tr>`
}

function renderDetailPanes(root: HTMLElement) {
  const equipBody = root.querySelector<HTMLTableSectionElement>('#detail-equip-body')!
  const skillsBody = root.querySelector<HTMLTableSectionElement>('#detail-skills-body')!
  const decoNote = root.querySelector<HTMLDivElement>('#detail-decorations')!

  const gameData = appState.gameData
  if (selectedIndex === null || !gameData) {
    equipBody.innerHTML = ''
    skillsBody.innerHTML = ''
    decoNote.textContent = ''
    return
  }
  const r = lastResults[selectedIndex]
  const weapon = r.weapon ? gameData.weapons.find((w) => w.name === r.weapon) : undefined
  equipBody.innerHTML = [
    weapon
      ? `<tr><td>Weapon</td><td>${escapeHtml(weapon.name)}</td><td>—</td><td>${weapon.levels[weapon.levels.length - 1]?.atk ?? '—'}</td>${Array.from({ length: 5 }, (_, i) => {
          const s = weapon.skills[i]
          return `<td>${s ? escapeHtml(`${s.skillName} ${s.point > 0 ? '+' : ''}${s.point}`) : ''}</td>`
        }).join('')}<td>${weapon.levels[weapon.levels.length - 1]?.slot ?? 0}</td><td>${weapon.rare}</td></tr>`
      : `<tr><td>Weapon</td><td colspan="8">—</td></tr>`,
    equipDetailRow('Head', findEquip(gameData.head, r.head)),
    equipDetailRow('Body', findEquip(gameData.body, r.body)),
    equipDetailRow('Arm', findEquip(gameData.arm, r.arm)),
    equipDetailRow('Waist', findEquip(gameData.waist, r.waist)),
    equipDetailRow('Leg', findEquip(gameData.leg, r.leg)),
  ].join('')

  skillsBody.innerHTML = r.activeSkills
    .map((s, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(s.skillName)}</td><td>${s.point}</td><td>${escapeHtml(s.optionName)}</td></tr>`)
    .join('')

  decoNote.textContent = r.decorations.length > 0 ? `Decorations used: ${r.decorations.join(', ')}` : 'No decorations used.'
}

function setResultsSummary(root: HTMLElement, text: string) {
  root.querySelector<HTMLDivElement>('#results-summary')!.textContent = text
}

export function renderSearchView(container: HTMLElement) {
  container.innerHTML = `
    <div class="mhfz-layout">
      <fieldset class="search-conditions-bar">
        <legend>Search Conditions</legend>
        <div class="conditions-row">
          <label>Job
            <select id="job-filter">
              <option value="Both">Both</option>
              <option value="Blademaster">Blademaster</option>
              <option value="Gunner">Gunner</option>
            </select>
          </label>
          <label>Max Results <input id="max-results" type="number" value="20" min="1" max="500"></label>
          <label>Only use items tagged
            <select id="tag-filter"><option value="">All items</option></select>
          </label>
          <button id="run-search-btn" class="primary">Start Search</button>
        </div>
        <div class="conditions-row">
          <span>Armor Type</span>
          <div id="equip-type-filter" class="equip-type-filter"></div>
        </div>
      </fieldset>

      <div class="skill-pick-row">
        <fieldset class="skill-pick-fieldset">
          <legend>Skills</legend>
          <input id="skill-search" type="text" placeholder="Search skills…">
          <div id="skill-tree" class="skill-tree"></div>
          <div class="skill-tier-note">Double-click a skill (or a Skill Set) to add it. Click ☆ to favorite.</div>
        </fieldset>
        <fieldset class="target-table-fieldset">
          <legend>Target Skills <button id="save-skillset-btn" class="save-set-btn">Save as Skill Set…</button></legend>
          <div class="table-scroll" style="max-height:140px;">
            <table>
              <thead><tr><th>No.</th><th>Skill</th><th>Value</th><th>Activated Skill</th><th></th></tr></thead>
              <tbody id="target-table-body"></tbody>
            </table>
          </div>
        </fieldset>
      </div>

      <fieldset class="presets-fieldset">
        <legend>Preset Equipment (optional — fixes a piece and its decorations, search fills the rest)</legend>
        <div id="presets-tag-filter" class="equip-type-filter"></div>
        <div class="table-scroll" style="max-height:170px;">
          <table>
            <thead><tr><th>Slot</th><th>Piece</th><th>Decorations (comma-separated)</th><th></th></tr></thead>
            <tbody id="presets-body"></tbody>
          </table>
        </div>
        <div id="presets-datalists"></div>
      </fieldset>

      <div class="results-summary" id="results-summary">Load a data folder, then add target skills and start a search.</div>

      <div class="table-scroll results-scroll">
        <table>
          <thead><tr>
            <th>No.</th><th>Def</th><th>#Sk</th><th>Weapon</th><th>Head</th><th>Body</th><th>Arm</th><th>Waist</th><th>Leg</th><th>Decorations</th>
            <th>Skill 1</th><th>Skill 2</th><th>Skill 3</th><th>Skill 4</th><th>Skill 5</th>
          </tr></thead>
          <tbody id="results-body"></tbody>
        </table>
      </div>

      <div class="detail-panes">
        <fieldset class="detail-equip-fieldset">
          <legend>Selected Set — Equipment
            <button type="button" id="clip-copy-text-btn" class="save-set-btn" title="Copy this set as text">Copy as Text</button>
            <button type="button" id="clip-copy-image-btn" class="save-set-btn" title="Copy this set as an image">Copy as Image</button>
            <button type="button" id="clip-save-image-btn" class="save-set-btn" title="Save this set as a .png">Save as PNG…</button>
          </legend>
          <div class="table-scroll" style="max-height:170px;">
            <table>
              <thead><tr>
                <th>Part</th><th>Name</th><th>Class</th><th>Def/Atk</th>
                <th>Skill 1</th><th>Skill 2</th><th>Skill 3</th><th>Skill 4</th><th>Skill 5</th>
                <th>Slot</th><th>Rare</th>
              </tr></thead>
              <tbody id="detail-equip-body"></tbody>
            </table>
          </div>
          <div id="detail-decorations" class="skill-tier-note"></div>
          <div id="clip-status" class="skill-tier-note"></div>
        </fieldset>
        <fieldset class="detail-skills-fieldset">
          <legend>Selected Set — Active Skills</legend>
          <div class="table-scroll" style="max-height:170px;">
            <table>
              <thead><tr><th>No.</th><th>Skill</th><th>Value</th><th>Activated Skill</th></tr></thead>
              <tbody id="detail-skills-body"></tbody>
            </table>
          </div>
        </fieldset>
      </div>
    </div>
  `

  const runBtn = container.querySelector<HTMLButtonElement>('#run-search-btn')!
  const jobSelect = container.querySelector<HTMLSelectElement>('#job-filter')!
  const maxResultsInput = container.querySelector<HTMLInputElement>('#max-results')!
  const tagFilterSelect = container.querySelector<HTMLSelectElement>('#tag-filter')!
  const skillSearchInput = container.querySelector<HTMLInputElement>('#skill-search')!
  const saveSkillSetBtn = container.querySelector<HTMLButtonElement>('#save-skillset-btn')!

  // Restore whatever search state was left over from a previous browser
  // session, before the first render of anything below reads `targets`/
  // the job/max-results inputs.
  const savedSession = getSearchSessionState()
  if (savedSession) {
    targets = savedSession.targets.map((t) => ({ skillName: t.skillName, minPoint: t.minPoint }))
    jobSelect.value = savedSession.job
    maxResultsInput.value = String(savedSession.maxResults)
    allowedEquipTypes = new Set(savedSession.equipTypes ?? [])
    presets = { ...(savedSession.presets ?? {}) }
    tagFilter = savedSession.tagFilter ?? ''
  }

  skillSearchInput.addEventListener('input', () => {
    skillSearchText = skillSearchInput.value
    renderSkillTree(container)
  })

  jobSelect.addEventListener('change', () => persistSearchSession(container))
  maxResultsInput.addEventListener('change', () => persistSearchSession(container))
  tagFilterSelect.addEventListener('change', () => {
    tagFilter = tagFilterSelect.value
    persistSearchSession(container)
  })

  saveSkillSetBtn.addEventListener('click', (e) => {
    e.preventDefault() // it's inside a <legend>; don't let it toggle any ancestor <details>-like behavior
    if (targets.length === 0) return
    const name = window.prompt('Name this skill set:')
    if (!name) return
    const skillBase = appState.gameData?.skillBase ?? []
    const entries = targets.map((t) => {
      const skill = skillBase.find((s) => s.name === t.skillName)
      const optionName = skill?.options.find((o) => o.point === t.minPoint)?.name ?? t.skillName
      return { skillName: t.skillName, point: t.minPoint, optionName }
    })
    saveSkillSet(name, entries)
    renderSkillTree(container)
  })

  const clipCopyTextBtn = container.querySelector<HTMLButtonElement>('#clip-copy-text-btn')!
  const clipCopyImageBtn = container.querySelector<HTMLButtonElement>('#clip-copy-image-btn')!
  const clipSaveImageBtn = container.querySelector<HTMLButtonElement>('#clip-save-image-btn')!

  function setClipStatus(text: string) {
    container.querySelector<HTMLDivElement>('#clip-status')!.textContent = text
  }

  function selectedResultOrWarn(): FoundSet | null {
    if (selectedIndex === null || !appState.gameData) {
      setClipStatus('Select a result row first.')
      return null
    }
    return lastResults[selectedIndex]
  }

  ;[clipCopyTextBtn, clipCopyImageBtn, clipSaveImageBtn].forEach((btn) => btn.addEventListener('click', (e) => e.preventDefault()))

  clipCopyTextBtn.addEventListener('click', async () => {
    const result = selectedResultOrWarn()
    if (!result) return
    try {
      await copyTextClipToClipboard(result, appState.gameData!, jobSelect.value as JobFilter)
      setClipStatus('Copied as text.')
    } catch (err) {
      setClipStatus(`Copy failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  clipCopyImageBtn.addEventListener('click', async () => {
    const result = selectedResultOrWarn()
    if (!result) return
    try {
      await copyImageClipToClipboard(result, appState.gameData!, jobSelect.value as JobFilter)
      setClipStatus('Copied as image.')
    } catch (err) {
      setClipStatus(`Copying as an image isn't supported in this browser (${err instanceof Error ? err.message : String(err)}) — try "Save as PNG…" instead.`)
    }
  })

  clipSaveImageBtn.addEventListener('click', async () => {
    const result = selectedResultOrWarn()
    if (!result) return
    try {
      await downloadImageClip(result, appState.gameData!, jobSelect.value as JobFilter)
      setClipStatus('Saved as PNG.')
    } catch (err) {
      setClipStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  runBtn.addEventListener('click', () => {
    const gameData = appState.gameData
    selectedIndex = null
    if (!gameData) {
      lastResults = []
      renderResultsTable(container)
      renderDetailPanes(container)
      setResultsSummary(container, 'Load a data folder first.')
      return
    }
    if (!appState.wasmReady) {
      setResultsSummary(container, 'The search engine is still starting up — wait a moment and try again.')
      return
    }
    if (targets.length === 0) {
      setResultsSummary(container, 'Add at least one target skill.')
      return
    }
    const request = {
      targets: targets.map((t): SearchTarget => ({ skillName: t.skillName, minPoint: t.minPoint })),
      job: jobSelect.value as JobFilter,
      maxResults: Number(maxResultsInput.value) || 20,
      equipTypes: Array.from(allowedEquipTypes),
      presets: buildSearchPresets(),
    }
    const searchData = applyTagFilter(gameData, tagFilter)
    const start = performance.now()
    try {
      lastResults = runSearch(searchData, request)
    } catch (err) {
      console.error('Search failed:', err)
      lastResults = []
      renderResultsTable(container)
      renderDetailPanes(container)
      setResultsSummary(container, `Search failed: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    const ms = (performance.now() - start).toFixed(1)
    renderResultsTable(container)
    renderDetailPanes(container)
    setResultsSummary(
      container,
      lastResults.length > 0
        ? `${lastResults.length} set${lastResults.length === 1 ? '' : 's'} found (${ms}ms) — click a row to inspect it.`
        : `No sets found matching those targets (${ms}ms). Try lower thresholds or fewer skills.`,
    )
  })

  appState.onDataLoaded(() => {
    maybeSeedDefaultSkillSets(appState.gameData?.skillBase ?? [])
    renderSkillTree(container)
    renderTargetTable(container)
    renderEquipTypeFilter(container)
    renderPresetsPanel(container)
  })
  maybeSeedDefaultSkillSets(appState.gameData?.skillBase ?? [])
  renderSkillTree(container)
  renderTargetTable(container)
  renderResultsTable(container)
  renderDetailPanes(container)
  renderEquipTypeFilter(container)
  renderTagFilter(container)
  renderPresetsPanel(container)
}
