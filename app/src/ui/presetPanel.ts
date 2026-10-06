// The "Preset Equipment" panel: fixes a piece (and up to 3 of its own
// decorations) for any of the 6 equip slots, plus a skill-cuffs preset
// (clothes item + up to 2 cuffs) -- the search fills in everything else.
// Shared between the Search tab and the Data Browser tab (mounted twice,
// once per tab, kept in sync): the Data Browser is where double-clicking a
// weapon/armor/skill-cuff/decoration row "slots it in" to whichever preset
// is the current target, so this module owns all of the preset state and
// both tabs' views of it, rather than searchView.ts owning state that
// dataBrowserView.ts would need to reach into.
//
// Each row also has an on/off tick (mirrors a feature in the original):
// unticking a row keeps its piece/decorations stored but excludes it from
// the SearchPresets sent to the search, so that slot goes back to being
// freely searched -- a quick way to compare "with this fixed" vs "let the
// search pick" without retyping anything.

import type { EquipData, GameData, WeaponData } from '../data/schema'
import { appState } from './appState'
import type { SearchPresets } from '../search'
import { getItemNamesForTag, getTags } from './itemTags'

export type PresetSlot = 'weapon' | 'head' | 'body' | 'arm' | 'waist' | 'leg'
export const PRESET_SLOTS: { key: PresetSlot; label: string }[] = [
  { key: 'weapon', label: 'Weapon' },
  { key: 'head', label: 'Head' },
  { key: 'body', label: 'Body' },
  { key: 'arm', label: 'Arm' },
  { key: 'waist', label: 'Waist' },
  { key: 'leg', label: 'Leg' },
]

/** The sentinel row shown at the top of the Data Browser's Weapon/Head/
 * Body/Arm/Waist/Leg tables -- double-clicking it clears that preset slot
 * (mirrors the original's "仮装備"/`EquipmentData.DEFAULT_WEAPONS[0]` dummy
 * equip concept: an explicit "nothing equipped here" choice, not just an
 * absence). Never a real item name, so it can't collide with the dataset. */
export const BLANK_ITEM_NAME = '(blank)'

const MAX_DECORATIONS_PER_PIECE = 3
const MAX_CUFFS = 2

export interface PresetEntry {
  name: string
  decorations: string[]
  /** Unticking keeps `name`/`decorations` stored but excludes this slot
   * from the built SearchPresets -- see this module's header comment. */
  enabled: boolean
}

export interface CuffsEntry {
  clothesName: string
  cuffNames: string[]
  enabled: boolean
}

let presets: Partial<Record<PresetSlot, PresetEntry>> = {}
let cuffsPreset: CuffsEntry | undefined = undefined

/** Which preset row a Data Browser decoration double-click appends to --
 * set by clicking a preset row in either tab's instance of this panel. */
let selectedTarget: PresetSlot | null = null

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

interface Mounted {
  root: HTMLElement
  instanceId: string
}
const mounted: Mounted[] = []
let onChanged: (() => void) | null = null

/** Registered once by searchView.ts so every preset mutation (from either
 * tab) persists the session the same way every other search-state mutation
 * already does -- this module doesn't own job/targets/etc, so it can't call
 * persistSearchSession itself. */
export function setOnPresetsChanged(cb: () => void): void {
  onChanged = cb
}

const changeListeners: (() => void)[] = []

/** Lets other views (e.g. the Data Browser's defense summary) react to any
 * preset mutation, from either tab, without owning the preset state. */
export function onPresetsChange(cb: () => void): void {
  changeListeners.push(cb)
}

function notifyChanged(): void {
  for (const { root, instanceId } of mounted) renderPresetsBody(root, instanceId)
  onChanged?.()
  for (const cb of changeListeners) cb()
}

export function getPresetsState(): {
  presets: Partial<Record<PresetSlot, PresetEntry>>
  cuffsPreset: CuffsEntry | undefined
} {
  return { presets, cuffsPreset }
}

export function restorePresetsState(saved: {
  presets?: Partial<Record<PresetSlot, PresetEntry>>
  cuffsPreset?: CuffsEntry
}): void {
  presets = { ...(saved.presets ?? {}) }
  cuffsPreset = saved.cuffsPreset ? { ...saved.cuffsPreset } : undefined
}

/** Only enabled rows (see this module's header comment) become part of the
 * actual search request -- a disabled row's data stays stored and visible,
 * but that slot/the cuffs preset goes back to being freely searched. */
export function buildSearchPresets(): SearchPresets | undefined {
  const entries = Object.entries(presets).filter(
    ([, v]) => v && v.enabled && v.name.trim().length > 0,
  ) as [PresetSlot, PresetEntry][]
  const hasCuffs = cuffsPreset && cuffsPreset.enabled && cuffsPreset.clothesName.trim().length > 0
  if (entries.length === 0 && !hasCuffs) return undefined
  const result: SearchPresets = {}
  for (const [slot, preset] of entries) result[slot] = { name: preset.name, decorations: preset.decorations }
  if (hasCuffs) result.cuffs = { clothesName: cuffsPreset!.clothesName, cuffNames: cuffsPreset!.cuffNames }
  return result
}

export function clearAllPresets(): void {
  presets = {}
  cuffsPreset = undefined
  selectedTarget = null
  notifyChanged()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function armorPoolFor(gameData: GameData, slot: PresetSlot): (EquipData | WeaponData)[] {
  switch (slot) {
    case 'head': return gameData.head
    case 'body': return gameData.body
    case 'arm': return gameData.arm
    case 'waist': return gameData.waist
    case 'leg': return gameData.leg
    case 'weapon': return gameData.weapons
  }
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

// --- Mutations (called from this panel's own inputs, and from
// dataBrowserView.ts's double-click handlers) ---

/** Sets (or, for `BLANK_ITEM_NAME`/empty, clears) the piece fixed into
 * `slot`, preserving whatever decorations/enabled state were already set
 * there. A freshly-set piece always starts enabled. */
export function setPresetPiece(slot: PresetSlot, name: string): void {
  if (!name || name === BLANK_ITEM_NAME) {
    delete presets[slot]
  } else {
    presets[slot] = { name, decorations: presets[slot]?.decorations ?? [], enabled: presets[slot]?.enabled ?? true }
  }
  notifyChanged()
}

export function setPresetDecoration(slot: PresetSlot, index: number, name: string): void {
  const decorations = [...(presets[slot]?.decorations ?? [])]
  while (decorations.length <= index) decorations.push('')
  decorations[index] = name
  const trimmed = decorations.map((d) => d.trim()).filter((d) => d.length > 0)
  if (presets[slot]) presets[slot]!.decorations = trimmed
  else if (trimmed.length > 0) presets[slot] = { name: '', decorations: trimmed, enabled: true }
  notifyChanged()
}

export function setPresetEnabled(slot: PresetSlot, enabled: boolean): void {
  if (presets[slot]) presets[slot]!.enabled = enabled
  notifyChanged()
}

/** Appends `jewelName` to the currently-selected preset row's decorations
 * (used by a Data Browser double-click) -- a no-op (returning a message for
 * the caller to surface) when nothing's selected or that slot's already at
 * the real 3-decoration cap. */
export function addDecorationToSelectedTarget(jewelName: string): string | null {
  if (!selectedTarget) return 'Click a preset row first to choose where this decoration goes.'
  const current = presets[selectedTarget]?.decorations ?? []
  if (current.length >= MAX_DECORATIONS_PER_PIECE) return `${PRESET_SLOTS.find((s) => s.key === selectedTarget)?.label} already has 3 decorations.`
  presets[selectedTarget] = {
    name: presets[selectedTarget]?.name ?? '',
    decorations: [...current, jewelName],
    enabled: presets[selectedTarget]?.enabled ?? true,
  }
  notifyChanged()
  return null
}

export function setCuffsClothes(name: string): void {
  if (!name) {
    cuffsPreset = undefined
  } else {
    cuffsPreset = { clothesName: name, cuffNames: cuffsPreset?.cuffNames ?? [], enabled: cuffsPreset?.enabled ?? true }
  }
  notifyChanged()
}

export function setCuffName(index: number, name: string): void {
  const cuffNames = [...(cuffsPreset?.cuffNames ?? [])]
  while (cuffNames.length <= index) cuffNames.push('')
  cuffNames[index] = name
  const trimmed = cuffNames.map((c) => c.trim()).filter((c) => c.length > 0)
  if (cuffsPreset) cuffsPreset.cuffNames = trimmed
  else if (trimmed.length > 0) cuffsPreset = { clothesName: '', cuffNames: trimmed, enabled: true }
  notifyChanged()
}

export function setCuffsEnabled(enabled: boolean): void {
  if (cuffsPreset) cuffsPreset.enabled = enabled
  notifyChanged()
}

/** Appends `cuffName` to the cuffs preset (used by a Data Browser
 * double-click on a skill-cuff row) -- there's only one cuffs slot, so
 * unlike decorations this never needs a "selected target". */
export function addCuff(cuffName: string): string | null {
  const current = cuffsPreset?.cuffNames ?? []
  if (current.length >= MAX_CUFFS) return 'Already have 2 skill cuffs attached.'
  cuffsPreset = { clothesName: cuffsPreset?.clothesName ?? '', cuffNames: [...current, cuffName], enabled: cuffsPreset?.enabled ?? true }
  notifyChanged()
  return null
}

export function selectTarget(slot: PresetSlot): void {
  selectedTarget = selectedTarget === slot ? null : slot
  for (const { root, instanceId } of mounted) renderPresetsBody(root, instanceId)
}

// --- Rendering ---

function datalistId(base: string, instanceId: string): string {
  return `${base}-${instanceId}`
}

/** The fieldset's static shell -- the rows themselves (and their datalist
 * `list="..."` ids, which need an instanceId suffix since that attribute
 * resolves document-wide, not scoped to an ancestor) are filled in by
 * `mountPresetsPanel`/`renderPresetsBody` right after this is inserted. */
export function presetsPanelMarkup(): string {
  return `
    <fieldset class="presets-fieldset">
      <legend>Preset Equipment (optional — fixes a piece and its decorations, search fills the rest)
        <button type="button" class="preset-clear-all-btn" title="Clear every preset slot">Clear All</button>
      </legend>
      <div class="presets-tag-filter" class="equip-type-filter"></div>
      <div class="table-scroll" style="max-height:220px;">
        <table>
          <thead><tr><th>On</th><th>Slot</th><th>Piece</th><th>Deco 1</th><th>Deco 2</th><th>Deco 3</th><th></th></tr></thead>
          <tbody class="presets-body"></tbody>
        </table>
      </div>
      <div class="presets-datalists"></div>
      <div class="skill-tier-note">Click a row to pick it as the target for decorations double-clicked in the Data Browser. Untick a row to keep it saved but let the search pick that slot freely.</div>
    </fieldset>
  `
}

function rebuildDatalists(root: HTMLElement, instanceId: string): void {
  const datalists = root.querySelector<HTMLDivElement>('.presets-datalists')!
  const gameData = appState.gameData
  if (!gameData) {
    datalists.innerHTML = ''
    return
  }
  const pieceDatalists = PRESET_SLOTS.map(({ key }) => {
    const pool = armorPoolFor(gameData, key)
    const allowed = presetAllowedNames(pool.map((p) => p.name))
    const filtered = allowed ? pool.filter((p) => allowed.has(p.name)) : pool
    return `<datalist id="${datalistId(`preset-piece-list-${key}`, instanceId)}">${filtered.map((p) => `<option value="${escapeHtml(p.name)}">`).join('')}</datalist>`
  }).join('')
  const jewelAllowed = presetAllowedNames(gameData.jewels.map((j) => j.name))
  const filteredJewels = jewelAllowed ? gameData.jewels.filter((j) => jewelAllowed.has(j.name)) : gameData.jewels
  const jewelDatalist = `<datalist id="${datalistId('preset-jewel-list', instanceId)}">${filteredJewels.map((j) => `<option value="${escapeHtml(j.name)}">`).join('')}</datalist>`

  const clothesDatalist = `<datalist id="${datalistId('preset-clothes-list', instanceId)}">${gameData.clothes.map((c) => `<option value="${escapeHtml(c.name)}">`).join('')}</datalist>`
  const cuffAllowed = presetAllowedNames(gameData.skillCuffs.map((c) => c.name))
  const filteredCuffs = cuffAllowed ? gameData.skillCuffs.filter((c) => cuffAllowed.has(c.name)) : gameData.skillCuffs
  const cuffDatalist = `<datalist id="${datalistId('preset-cuff-list', instanceId)}">${filteredCuffs.map((c) => `<option value="${escapeHtml(c.name)}">`).join('')}</datalist>`

  datalists.innerHTML = pieceDatalists + jewelDatalist + clothesDatalist + cuffDatalist
}

export function renderPresetTagFilter(root: HTMLElement, instanceId: string): void {
  const el = root.querySelector<HTMLDivElement>('.presets-tag-filter')!
  const tagNames = Array.from(new Set(getTags().map((t) => t.name))).sort((a, b) => a.localeCompare(b))
  if (tagNames.length === 0) {
    el.innerHTML = '<span class="skill-tier-note">Tag items in the Data Browser to filter these pickers to what you already have.</span>'
    rebuildDatalists(root, instanceId)
    return
  }
  el.innerHTML = [
    '<span>Only show tagged:</span>',
    ...tagNames.map(
      (t) =>
        `<label class="equip-type-option"><input type="checkbox" class="preset-tag-checkbox" value="${escapeHtml(t)}" ${presetTagFilter.has(t) ? 'checked' : ''}> ${escapeHtml(t)}</label>`,
    ),
    `<label class="equip-type-option"><input type="checkbox" class="preset-include-untagged" ${presetIncludeUntagged ? 'checked' : ''}> + untagged</label>`,
  ].join('')
  el.querySelectorAll<HTMLInputElement>('.preset-tag-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) presetTagFilter.add(cb.value)
      else presetTagFilter.delete(cb.value)
      for (const m of mounted) rebuildDatalists(m.root, m.instanceId)
    })
  })
  rebuildDatalists(root, instanceId)
  el.querySelector<HTMLInputElement>('.preset-include-untagged')!.addEventListener('change', (e) => {
    presetIncludeUntagged = (e.target as HTMLInputElement).checked
    for (const m of mounted) rebuildDatalists(m.root, m.instanceId)
  })
}

function decoCell(slot: PresetSlot, index: number, instanceId: string): string {
  const value = presets[slot]?.decorations?.[index] ?? ''
  return `<td><input type="text" class="preset-deco-input" data-slot="${slot}" data-index="${index}" list="${datalistId('preset-jewel-list', instanceId)}" value="${escapeHtml(value)}" placeholder="—"></td>`
}

function renderPresetsBody(root: HTMLElement, instanceId: string): void {
  const body = root.querySelector<HTMLTableSectionElement>('.presets-body')!

  const armorRows = PRESET_SLOTS.map(({ key, label }) => {
    const preset = presets[key]
    const enabled = preset ? (preset.enabled ?? true) : false
    return `<tr class="preset-row ${selectedTarget === key ? 'selected' : ''} ${preset && !enabled ? 'preset-disabled' : ''}" data-slot="${key}">
      <td><input type="checkbox" class="preset-enabled-toggle" data-slot="${key}" ${enabled ? 'checked' : ''} ${preset ? '' : 'disabled'} title="Include this preset in the search"></td>
      <td>${label}</td>
      <td><input type="text" class="preset-piece-input" data-slot="${key}" list="${datalistId(`preset-piece-list-${key}`, instanceId)}" value="${escapeHtml(preset?.name ?? '')}" placeholder="(search picks)"></td>
      ${decoCell(key, 0, instanceId)}
      ${decoCell(key, 1, instanceId)}
      ${decoCell(key, 2, instanceId)}
      <td><button type="button" class="preset-clear-btn" data-slot="${key}" title="Clear this preset">✕</button></td>
    </tr>`
  }).join('')

  // Skill Cuffs: a "clothes" item (the layered outfit granting 2 cuff
  // slots) plus up to 2 cuffs to attach to it -- a separate row shape from
  // the armor/weapon rows above since it's a two-part preset (Rust-side
  // validates count/category/capacity/series restrictions; see
  // resolve_cuffs_preset's doc comment). Not a decoration-double-click
  // target, so not selectable like the armor/weapon rows.
  const cuffsEnabled = cuffsPreset ? (cuffsPreset.enabled ?? true) : false
  const cuffsRow = `<tr class="${cuffsPreset && !cuffsEnabled ? 'preset-disabled' : ''}">
    <td><input type="checkbox" class="preset-cuffs-enabled-toggle" ${cuffsEnabled ? 'checked' : ''} ${cuffsPreset ? '' : 'disabled'} title="Include this preset in the search"></td>
    <td>Skill Cuffs</td>
    <td><input type="text" class="preset-clothes-input" list="${datalistId('preset-clothes-list', instanceId)}" value="${escapeHtml(cuffsPreset?.clothesName ?? '')}" placeholder="clothes item"></td>
    <td><input type="text" class="preset-cuff-input" data-index="0" list="${datalistId('preset-cuff-list', instanceId)}" value="${escapeHtml(cuffsPreset?.cuffNames?.[0] ?? '')}" placeholder="—"></td>
    <td><input type="text" class="preset-cuff-input" data-index="1" list="${datalistId('preset-cuff-list', instanceId)}" value="${escapeHtml(cuffsPreset?.cuffNames?.[1] ?? '')}" placeholder="—"></td>
    <td></td>
    <td><button type="button" class="preset-cuffs-clear-btn" title="Clear this preset">✕</button></td>
  </tr>`

  body.innerHTML = armorRows + cuffsRow

  body.querySelectorAll<HTMLTableRowElement>('.preset-row').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('input, button')) return
      selectTarget(tr.dataset.slot as PresetSlot)
    })
  })
  body.querySelectorAll<HTMLInputElement>('.preset-enabled-toggle').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation())
    cb.addEventListener('change', () => setPresetEnabled(cb.dataset.slot as PresetSlot, cb.checked))
  })
  body.querySelectorAll<HTMLInputElement>('.preset-piece-input').forEach((input) => {
    input.addEventListener('change', () => setPresetPiece(input.dataset.slot as PresetSlot, input.value.trim()))
  })
  body.querySelectorAll<HTMLInputElement>('.preset-deco-input').forEach((input) => {
    input.addEventListener('change', () =>
      setPresetDecoration(input.dataset.slot as PresetSlot, Number(input.dataset.index), input.value.trim()),
    )
  })
  body.querySelectorAll<HTMLButtonElement>('.preset-clear-btn').forEach((btn) => {
    btn.addEventListener('click', () => setPresetPiece(btn.dataset.slot as PresetSlot, ''))
  })

  body.querySelector<HTMLInputElement>('.preset-cuffs-enabled-toggle')!.addEventListener('change', (e) => {
    setCuffsEnabled((e.target as HTMLInputElement).checked)
  })
  body.querySelector<HTMLInputElement>('.preset-clothes-input')!.addEventListener('change', (e) => {
    setCuffsClothes((e.target as HTMLInputElement).value.trim())
  })
  body.querySelectorAll<HTMLInputElement>('.preset-cuff-input').forEach((input) => {
    input.addEventListener('change', () => setCuffName(Number(input.dataset.index), input.value.trim()))
  })
  body.querySelector<HTMLButtonElement>('.preset-cuffs-clear-btn')!.addEventListener('click', () => {
    cuffsPreset = undefined
    notifyChanged()
  })
}

/** Mounts (or re-mounts after a container's innerHTML was replaced) one
 * instance of the panel into `root` -- call once per tab. Safe to call
 * again for the same root (e.g. on a full tab re-render); it won't
 * double-register. */
export function mountPresetsPanel(root: HTMLElement, instanceId: string): void {
  if (!mounted.some((m) => m.root === root && m.instanceId === instanceId)) {
    mounted.push({ root, instanceId })
  }
  const clearAllBtn = root.querySelector<HTMLButtonElement>('.preset-clear-all-btn')!
  clearAllBtn.addEventListener('click', (e) => {
    e.preventDefault() // inside a <legend>
    clearAllPresets()
  })
  renderPresetTagFilter(root, instanceId)
  renderPresetsBody(root, instanceId)
}

/** Call when tags change (Data Browser edits) or gameData loads/changes,
 * to refresh every mounted instance's tag-filter options and datalists. */
export function refreshAllPresetPanels(): void {
  for (const { root, instanceId } of mounted) {
    renderPresetTagFilter(root, instanceId)
    renderPresetsBody(root, instanceId)
  }
}
