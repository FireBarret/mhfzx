// The Data Browser tab: category tabs (mirroring the original's per-slot
// equipment lists) each showing a searchable table of the loaded data.

import type { EquipData, JewelData, SkillCuffData, WeaponData } from '../data/schema'
import { appState } from './appState'

type Category = 'Head' | 'Body' | 'Arm' | 'Waist' | 'Leg' | 'Weapon' | 'Jewel' | 'SkillCuff'
const CATEGORIES: Category[] = ['Head', 'Body', 'Arm', 'Waist', 'Leg', 'Weapon', 'Jewel', 'SkillCuff']

let activeCategory: Category = 'Head'
let filterText = ''

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function skillsText(skills: { skillName: string; point: number }[]): string {
  return skills.map((s) => `${s.skillName} ${s.point > 0 ? '+' : ''}${s.point}`).join(', ')
}

function equipRows(items: EquipData[], filter: string): string {
  const lower = filter.toLowerCase()
  return items
    .filter((d) => filter === '' || d.name.toLowerCase().includes(lower))
    .map((d) => {
      const best = d.levels[d.levels.length - 1]
      return `<tr>
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.class)}</td>
        <td>${escapeHtml(d.job)}</td>
        <td>${escapeHtml(d.sex)}</td>
        <td>${d.rare}</td>
        <td>${best?.def ?? '—'}</td>
        <td>${best?.slot ?? 0}</td>
        <td>${escapeHtml(skillsText(d.skills))}</td>
      </tr>`
    })
    .join('')
}

function weaponRows(items: WeaponData[], filter: string): string {
  const lower = filter.toLowerCase()
  return items
    .filter((d) => filter === '' || d.name.toLowerCase().includes(lower))
    .map((d) => {
      const best = d.levels[d.levels.length - 1]
      return `<tr>
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.job)}</td>
        <td>${escapeHtml(d.sex)}</td>
        <td>${d.rare}</td>
        <td>${best?.atk ?? '—'}</td>
        <td>${best?.slot ?? 0}</td>
        <td>${escapeHtml(skillsText(d.skills))}</td>
      </tr>`
    })
    .join('')
}

function jewelRows(items: JewelData[], filter: string): string {
  const lower = filter.toLowerCase()
  return items
    .filter((d) => filter === '' || d.name.toLowerCase().includes(lower))
    .map(
      (d) => `<tr>
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.class ?? '—')}</td>
        <td>${escapeHtml(d.job)}</td>
        <td>${d.rare}</td>
        <td>${d.slot}</td>
        <td>${escapeHtml(skillsText(d.skills))}</td>
        <td>${d.sources.length > 0 ? escapeHtml(d.sources.map((s) => s.equipName).join(', ')) : '—'}</td>
      </tr>`,
    )
    .join('')
}

function skillCuffRows(items: SkillCuffData[], filter: string): string {
  const lower = filter.toLowerCase()
  return items
    .filter((d) => filter === '' || d.name.toLowerCase().includes(lower))
    .map(
      (d) => `<tr>
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.family)}</td>
        <td>${escapeHtml(d.class)}</td>
        <td>${d.rare}</td>
        <td>${d.slot}</td>
        <td>${escapeHtml(skillsText(d.skills))}</td>
      </tr>`,
    )
    .join('')
}

const EQUIP_HEADER = '<th>Name</th><th>Class</th><th>Job</th><th>Sex</th><th>Rare</th><th>Def</th><th>Slot</th><th>Skills</th>'
const WEAPON_HEADER = '<th>Name</th><th>Job</th><th>Sex</th><th>Rare</th><th>Atk</th><th>Slot</th><th>Skills</th>'
const JEWEL_HEADER = '<th>Name</th><th>Class</th><th>Job</th><th>Rare</th><th>Slot</th><th>Skills</th><th>Sources</th>'
const CUFF_HEADER = '<th>Name</th><th>Family</th><th>Class</th><th>Rare</th><th>Slot</th><th>Skills</th>'

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
      <div class="table-scroll">
        <table>
          <thead><tr id="table-head"></tr></thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
    </div>
  `

  const filterInput = container.querySelector<HTMLInputElement>('#filter-input')!
  const tableHead = container.querySelector<HTMLTableRowElement>('#table-head')!
  const tableBody = container.querySelector<HTMLTableSectionElement>('#table-body')!

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

  appState.onDataLoaded(refresh)
  refresh()
}
