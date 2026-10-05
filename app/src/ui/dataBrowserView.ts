// The Data Browser tab: category tabs (mirroring the original's per-slot
// equipment lists) each showing a searchable table of the loaded data.

import type { EquipData, JewelData, SkillCuffData, WeaponData } from '../data/schema'
import { appState } from './appState'
import { getTagNamesForItem, setTagsForItem } from './itemTags'
import {
  addCuff,
  addDecorationToSelectedTarget,
  BLANK_ITEM_NAME,
  mountPresetsPanel,
  presetsPanelMarkup,
  refreshAllPresetPanels,
  setPresetPiece,
  type PresetSlot,
} from './presetPanel'

type Category = 'Head' | 'Body' | 'Arm' | 'Waist' | 'Leg' | 'Weapon' | 'Jewel' | 'SkillCuff'
const CATEGORIES: Category[] = ['Weapon', 'Head', 'Body', 'Arm', 'Waist', 'Leg', 'Jewel', 'SkillCuff']

/** Categories where a row double-click "slots in" the piece as a preset --
 * the single-slot armor/weapon categories only (Jewel/SkillCuff attach to
 * whichever preset is already selected / the cuffs preset, handled
 * separately in the double-click handler below, not via this map). */
const CATEGORY_TO_PRESET_SLOT: Partial<Record<Category, PresetSlot>> = {
  Weapon: 'weapon',
  Head: 'head',
  Body: 'body',
  Arm: 'arm',
  Waist: 'waist',
  Leg: 'leg',
}

let activeCategory: Category = 'Head'
let filterText = ''
let doubleClickStatus = ''

/** The "already have" tags column, appended to every category's row —
 * a text input showing this item's current tags (comma-separated),
 * committed on blur/Enter via setTagsForItem. Shared across all four row
 * builders below rather than duplicated per category. */
function tagsCellHtml(itemName: string): string {
  const current = getTagNamesForItem(itemName).join(', ')
  return `<td><input type="text" class="tags-input" data-item="${escapeHtml(itemName)}" value="${escapeHtml(current)}" placeholder="untagged"></td>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function skillsText(skills: { skillName: string; point: number }[]): string {
  return skills.map((s) => `${s.skillName} ${s.point > 0 ? '+' : ''}${s.point}`).join(', ')
}

/** The "(blank)" sentinel row, always first and unaffected by the name
 * filter -- double-clicking it clears whichever preset slot this category
 * maps to. See presetPanel.ts's BLANK_ITEM_NAME doc comment. */
function blankRow(colCount: number): string {
  return `<tr class="data-row blank-row" data-name="${escapeHtml(BLANK_ITEM_NAME)}" title="Double-click to clear this slot's preset">
    <td>${escapeHtml(BLANK_ITEM_NAME)}</td>${'<td>—</td>'.repeat(colCount - 2)}<td></td>
  </tr>`
}

function equipRows(items: EquipData[], filter: string): string {
  const lower = filter.toLowerCase()
  return (
    blankRow(9) +
    items
      .filter((d) => filter === '' || d.name.toLowerCase().includes(lower))
      .map((d) => {
        const best = d.levels[d.levels.length - 1]
        return `<tr class="data-row" data-name="${escapeHtml(d.name)}" title="Double-click to slot into a preset">
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.class)}</td>
        <td>${escapeHtml(d.job)}</td>
        <td>${escapeHtml(d.sex)}</td>
        <td>${d.rare}</td>
        <td>${best?.def ?? '—'}</td>
        <td>${best?.slot ?? 0}</td>
        <td>${escapeHtml(skillsText(d.skills))}</td>
        ${tagsCellHtml(d.name)}
      </tr>`
      })
      .join('')
  )
}

function weaponRows(items: WeaponData[], filter: string): string {
  const lower = filter.toLowerCase()
  return (
    blankRow(8) +
    items
      .filter((d) => filter === '' || d.name.toLowerCase().includes(lower))
      .map((d) => {
        const best = d.levels[d.levels.length - 1]
        return `<tr class="data-row" data-name="${escapeHtml(d.name)}" title="Double-click to slot into a preset">
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.job)}</td>
        <td>${escapeHtml(d.sex)}</td>
        <td>${d.rare}</td>
        <td>${best?.atk ?? '—'}</td>
        <td>${best?.slot ?? 0}</td>
        <td>${escapeHtml(skillsText(d.skills))}</td>
        ${tagsCellHtml(d.name)}
      </tr>`
      })
      .join('')
  )
}

function jewelRows(items: JewelData[], filter: string): string {
  const lower = filter.toLowerCase()
  return items
    .filter((d) => filter === '' || d.name.toLowerCase().includes(lower))
    .map(
      (d) => `<tr class="data-row" data-name="${escapeHtml(d.name)}" title="Double-click to add to the selected preset row's decorations">
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.class ?? '—')}</td>
        <td>${escapeHtml(d.job)}</td>
        <td>${d.rare}</td>
        <td>${d.slot}</td>
        <td>${escapeHtml(skillsText(d.skills))}</td>
        <td>${d.sources.length > 0 ? escapeHtml(d.sources.map((s) => s.equipName).join(', ')) : '—'}</td>
        ${tagsCellHtml(d.name)}
      </tr>`,
    )
    .join('')
}

function skillCuffRows(items: SkillCuffData[], filter: string): string {
  const lower = filter.toLowerCase()
  return items
    .filter((d) => filter === '' || d.name.toLowerCase().includes(lower))
    .map(
      (d) => `<tr class="data-row" data-name="${escapeHtml(d.name)}" title="Double-click to attach to the skill cuffs preset">
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.family)}</td>
        <td>${escapeHtml(d.class)}</td>
        <td>${d.rare}</td>
        <td>${d.slot}</td>
        <td>${escapeHtml(skillsText(d.skills))}</td>
        ${tagsCellHtml(d.name)}
      </tr>`,
    )
    .join('')
}

const EQUIP_HEADER = '<th>Name</th><th>Class</th><th>Job</th><th>Sex</th><th>Rare</th><th>Def</th><th>Slot</th><th>Skills</th><th>Tags</th>'
const WEAPON_HEADER = '<th>Name</th><th>Job</th><th>Sex</th><th>Rare</th><th>Atk</th><th>Slot</th><th>Skills</th><th>Tags</th>'
const JEWEL_HEADER = '<th>Name</th><th>Class</th><th>Job</th><th>Rare</th><th>Slot</th><th>Skills</th><th>Sources</th><th>Tags</th>'
const CUFF_HEADER = '<th>Name</th><th>Family</th><th>Class</th><th>Rare</th><th>Slot</th><th>Skills</th><th>Tags</th>'

function headerFor(cat: Category): string {
  if (cat === 'Weapon') return WEAPON_HEADER
  if (cat === 'Jewel') return JEWEL_HEADER
  if (cat === 'SkillCuff') return CUFF_HEADER
  return EQUIP_HEADER
}

function rowsFor(cat: Category, filter: string): string {
  const gd = appState.gameData
  if (!gd) return ''
  switch (cat) {
    case 'Head': return equipRows(gd.head, filter)
    case 'Body': return equipRows(gd.body, filter)
    case 'Arm': return equipRows(gd.arm, filter)
    case 'Waist': return equipRows(gd.waist, filter)
    case 'Leg': return equipRows(gd.leg, filter)
    case 'Weapon': return weaponRows(gd.weapons, filter)
    case 'Jewel': return jewelRows(gd.jewels, filter)
    case 'SkillCuff': return skillCuffRows(gd.skillCuffs, filter)
  }
}

function countFor(cat: Category): number {
  const gd = appState.gameData
  if (!gd) return 0
  switch (cat) {
    case 'Head': return gd.head.length
    case 'Body': return gd.body.length
    case 'Arm': return gd.arm.length
    case 'Waist': return gd.waist.length
    case 'Leg': return gd.leg.length
    case 'Weapon': return gd.weapons.length
    case 'Jewel': return gd.jewels.length
    case 'SkillCuff': return gd.skillCuffs.length
  }
}

export function renderDataBrowserView(container: HTMLElement) {
  container.innerHTML = `
    <div class="data-browser-layout">
      <div class="data-browser-toolbar">
        <div class="category-tabs">
          ${CATEGORIES.map((c) => `<button class="category-tab" data-cat="${c}">${c} (<span data-count="${c}">0</span>)</button>`).join('')}
        </div>
        <input id="filter-input" type="text" placeholder="Filter by name…" style="flex:1; max-width:300px;">
      </div>
      <div id="dblclick-status" class="skill-tier-note"></div>
      <div class="table-scroll" style="max-height:45vh;">
        <table>
          <thead><tr id="table-head"></tr></thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
      ${presetsPanelMarkup()}
    </div>
  `

  const filterInput = container.querySelector<HTMLInputElement>('#filter-input')!
  const tableHead = container.querySelector<HTMLTableRowElement>('#table-head')!
  const tableBody = container.querySelector<HTMLTableSectionElement>('#table-body')!
  const statusEl = container.querySelector<HTMLDivElement>('#dblclick-status')!

  function setStatus(text: string) {
    doubleClickStatus = text
    statusEl.textContent = text
  }

  function refresh() {
    tableHead.innerHTML = headerFor(activeCategory)
    if (!appState.gameData) {
      tableBody.innerHTML = ''
      return
    }
    tableBody.innerHTML = rowsFor(activeCategory, filterText)
    container.querySelectorAll<HTMLButtonElement>('.category-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.cat === activeCategory)
      const countEl = btn.querySelector<HTMLSpanElement>('span')!
      countEl.textContent = String(countFor(btn.dataset.cat as Category))
    })
    container.querySelectorAll<HTMLInputElement>('.tags-input').forEach((input) => {
      const commit = () => {
        setTagsForItem(input.dataset.item!, input.value.split(','))
        refreshAllPresetPanels() // the tag filter on the preset pickers depends on tag membership
      }
      input.addEventListener('change', commit)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur()
      })
    })
    statusEl.textContent = doubleClickStatus

    container.querySelectorAll<HTMLTableRowElement>('.data-row').forEach((tr) => {
      tr.addEventListener('dblclick', () => {
        const name = tr.dataset.name!
        const presetSlot = CATEGORY_TO_PRESET_SLOT[activeCategory]
        if (presetSlot) {
          setPresetPiece(presetSlot, name)
          setStatus(name === BLANK_ITEM_NAME ? `Cleared the ${activeCategory} preset.` : `Set ${activeCategory} preset to "${name}".`)
        } else if (activeCategory === 'SkillCuff') {
          const warning = addCuff(name)
          setStatus(warning ?? `Added "${name}" to the skill cuffs preset.`)
        } else if (activeCategory === 'Jewel') {
          const warning = addDecorationToSelectedTarget(name)
          setStatus(warning ?? `Added "${name}" as a decoration.`)
        }
      })
    })
  }

  container.querySelectorAll<HTMLButtonElement>('.category-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat as Category
      refresh()
    })
  })
  filterInput.addEventListener('input', () => {
    filterText = filterInput.value
    refresh()
  })

  appState.onDataLoaded(() => {
    refresh()
    refreshAllPresetPanels()
  })
  refresh()
  mountPresetsPanel(container, 'browser')
}
